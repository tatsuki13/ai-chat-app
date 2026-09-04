import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.REMOTE_MIC_WS_PORT || 3010);
const PATHNAME = process.env.REMOTE_MIC_WS_PATH || "/remote-mic-ws";
const APP_ORIGIN = process.env.REMOTE_MIC_RELAY_APP_ORIGIN || "http://localhost:3000";
const HEARTBEAT_MS = Number(process.env.REMOTE_MIC_WS_HEARTBEAT_MS || 15000);
const IDLE_TIMEOUT_MS = Number(process.env.REMOTE_MIC_WS_IDLE_TIMEOUT_MS || 45000);

/** @type {Map<string, Set<Client>>} */
const rooms = new Map();
/** @type {Map<string, Client>} */
const keyedClients = new Map();

const server = http.createServer((_request, response) => {
  response.writeHead(404);
  response.end("remote mic websocket relay\n");
});

server.on("upgrade", async (request, socket) => {
  try {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    if (url.pathname !== PATHNAME) {
      rejectUpgrade(socket, 404, "not found");
      return;
    }

    const sessionId = url.searchParams.get("sessionId")?.trim() ?? "";
    const clientType = url.searchParams.get("clientType")?.trim() ?? "";
    const role = url.searchParams.get("role")?.trim() ?? "";
    const connectionRole = clientType === "subscriber" ? "subscriber" : role;

    if (
      !sessionId ||
      (clientType !== "subscriber" && clientType !== "producer") ||
      (clientType === "producer" && role !== "elder" && role !== "caregiver")
    ) {
      rejectUpgrade(socket, 400, "invalid remote mic websocket parameters");
      return;
    }

    if (!(await isActiveSession(sessionId))) {
      rejectUpgrade(socket, 409, "active session mismatch");
      return;
    }

    acceptUpgrade(request, socket);

    const key = `${sessionId}:${clientType}:${connectionRole}`;
    const existing = keyedClients.get(key);
    if (existing) {
      closeClient(existing, 4000, "replaced by newer connection");
    }

    const client = {
      key,
      sessionId,
      clientType,
      role: role || null,
      socket,
      buffer: Buffer.alloc(0),
      lastSeenAt: Date.now(),
      alive: true,
    };
    keyedClients.set(key, client);
    getRoom(sessionId).add(client);

    console.info("[remote-mic ws connected]", {
      sessionId,
      clientType,
      role: client.role,
      key,
    });

    socket.on("data", (chunk) => {
      client.lastSeenAt = Date.now();
      client.buffer = Buffer.concat([client.buffer, chunk]);
      drainFrames(client);
    });
    socket.on("close", () => removeClient(client));
    socket.on("error", () => removeClient(client));
  } catch (error) {
    console.warn("[remote-mic ws upgrade failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    socket.destroy();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const client of keyedClients.values()) {
    if (now - client.lastSeenAt > IDLE_TIMEOUT_MS) {
      closeClient(client, 4001, "idle timeout");
      continue;
    }

    sendFrame(client.socket, Buffer.alloc(0), 0x9);
  }
}, HEARTBEAT_MS).unref();

server.listen(PORT, () => {
  console.info("[remote-mic ws relay ready]", {
    port: PORT,
    path: PATHNAME,
    appOrigin: APP_ORIGIN,
  });
});

/**
 * @typedef {{
 *   key: string;
 *   sessionId: string;
 *   clientType: string;
 *   role: string | null;
 *   socket: import("node:net").Socket;
 *   buffer: Buffer;
 *   lastSeenAt: number;
 *   alive: boolean;
 * }} Client
 */

function acceptUpgrade(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    rejectUpgrade(socket, 400, "missing websocket key");
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

async function isActiveSession(sessionId) {
  const url = new URL("/api/remote-mic/fixed/active", APP_ORIGIN);
  url.searchParams.set("sessionId", sessionId);
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data.active && !data.active.endedAt);
  } catch (error) {
    console.warn("[remote-mic ws active session check failed]", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function getRoom(sessionId) {
  let room = rooms.get(sessionId);
  if (!room) {
    room = new Set();
    rooms.set(sessionId, room);
  }
  return room;
}

function drainFrames(client) {
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      const bigLength = client.buffer.readBigUInt64BE(offset);
      if (bigLength > BigInt(1024 * 1024)) {
        closeClient(client, 1009, "message too large");
        return;
      }
      length = Number(bigLength);
      offset += 8;
    }

    if (!masked) {
      closeClient(client, 1002, "client frames must be masked");
      return;
    }
    if (client.buffer.length < offset + 4 + length) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(client.buffer.subarray(offset, offset + length));
    client.buffer = client.buffer.subarray(offset + length);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    if (opcode === 0x8) {
      closeClient(client, 1000, "client closed");
      return;
    }
    if (opcode === 0x9) {
      sendFrame(client.socket, payload, 0xA);
      continue;
    }
    if (opcode === 0xA) continue;
    if (opcode !== 0x1) continue;

    handleMessage(client, payload.toString("utf8"));
  }
}

function handleMessage(client, rawMessage) {
  if (client.clientType !== "producer") {
    return;
  }

  let message;
  try {
    message = JSON.parse(rawMessage);
  } catch {
    sendJson(client.socket, {
      type: "error",
      sessionId: client.sessionId,
      role: client.role,
      transcriptId: "",
      revision: 0,
      text: "invalid json",
    });
    return;
  }

  if (!isRelayMessage(message, client)) {
    sendJson(client.socket, {
      type: "error",
      sessionId: client.sessionId,
      role: client.role,
      transcriptId: "",
      revision: 0,
      text: "invalid relay message",
    });
    return;
  }

  const room = rooms.get(client.sessionId);
  if (!room) return;
  const encoded = JSON.stringify(message);
  for (const target of room) {
    if (target.clientType !== "subscriber") continue;
    sendFrame(target.socket, Buffer.from(encoded, "utf8"));
  }

  console.info("[remote-mic ws relayed]", {
    sessionId: message.sessionId,
    role: message.role,
    type: message.type,
    transcriptId: message.transcriptId,
    revision: message.revision,
    subscriberCount: [...room].filter((entry) => entry.clientType === "subscriber")
      .length,
  });
}

function isRelayMessage(message, client) {
  return (
    message &&
    typeof message === "object" &&
    (message.type === "partial" ||
      message.type === "final" ||
      message.type === "speech_started" ||
      message.type === "error") &&
    message.sessionId === client.sessionId &&
    message.role === client.role &&
    typeof message.transcriptId === "string" &&
    Number.isInteger(message.revision) &&
    typeof message.text === "string"
  );
}

function sendJson(socket, value) {
  sendFrame(socket, Buffer.from(JSON.stringify(value), "utf8"));
}

function sendFrame(socket, payload, opcode = 0x1) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function closeClient(client, code, reason) {
  if (!client.alive) return;
  client.alive = false;
  const reasonBuffer = Buffer.from(reason);
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  try {
    sendFrame(client.socket, payload, 0x8);
  } catch {}
  client.socket.destroy();
  removeClient(client);
}

function removeClient(client) {
  if (keyedClients.get(client.key) === client) {
    keyedClients.delete(client.key);
  }
  const room = rooms.get(client.sessionId);
  if (room) {
    room.delete(client);
    if (room.size === 0) {
      rooms.delete(client.sessionId);
    }
  }
  console.info("[remote-mic ws disconnected]", {
    sessionId: client.sessionId,
    clientType: client.clientType,
    role: client.role,
    key: client.key,
  });
}

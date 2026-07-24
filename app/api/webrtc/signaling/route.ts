import { NextResponse } from "next/server";
import {
  isMicrophoneRole,
  validatePairingToken,
} from "../../../../lib/microphone-pairing";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

type SpeakerRole = "caregiver" | "elder";
type SignalPeer = "pc" | "phone";
type SignalMessageType = "offer" | "answer" | "ice" | "bye";

type SignalRow = {
  id: string;
  session_id: string;
  role: SpeakerRole;
  sender: SignalPeer;
  recipient: SignalPeer;
  message_type: SignalMessageType;
  payload: unknown;
  created_at: Date;
  expires_at: Date;
};

const SIGNAL_TTL_MS = 90 * 1000;
const MAX_PAYLOAD_CHARS = 120_000;
const MAX_POLL_MESSAGES = 80;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = requiredString(params.get("sessionId"));
    const role = parseRole(params.get("role"));
    const recipient = parsePeer(params.get("recipient"));
    const since = parseDate(params.get("since"));
    const token = requiredString(params.get("token"));

    if (!sessionId || !role || !recipient || !isValidSessionId(sessionId)) {
      return NextResponse.json(
        { error: "sessionId, role, and recipient are required" },
        { status: 400 },
      );
    }

    if (recipient === "phone") {
      const validToken = await validatePairingToken({ sessionId, role, token });
      if (!validToken) {
        return NextResponse.json(
          { error: "Invalid microphone pairing token" },
          { status: 403 },
        );
      }
    }

    const session = await findOpenSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or already ended" },
        { status: 404 },
      );
    }

    await pruneExpiredSignals();

    const rows = await prisma.$queryRaw<SignalRow[]>`
      SELECT
        id,
        session_id,
        role,
        sender,
        recipient,
        message_type,
        payload,
        created_at,
        expires_at
      FROM web_rtc_signals
      WHERE session_id = ${sessionId}
        AND role = ${role}
        AND recipient = ${recipient}
        AND expires_at > NOW()
        AND created_at > ${since}
      ORDER BY created_at ASC
      LIMIT ${MAX_POLL_MESSAGES}
    `;

    return NextResponse.json({
      now: new Date().toISOString(),
      messages: rows.map(serializeSignal),
    });
  } catch (error) {
    console.error("Failed to poll WebRTC signals", error);

    return NextResponse.json(
      { error: "Failed to poll WebRTC signals" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const sessionId = requiredString(body?.sessionId ?? body?.session_id);
    const role = parseRole(body?.role);
    const sender = parsePeer(body?.sender);
    const recipient = parsePeer(body?.recipient);
    const messageType = parseMessageType(body?.messageType ?? body?.message_type);
    const payload = body?.payload;
    const token = requiredString(body?.token);

    if (
      !sessionId ||
      !role ||
      !sender ||
      !recipient ||
      !messageType ||
      !isValidSessionId(sessionId)
    ) {
      return NextResponse.json(
        { error: "Invalid signaling request" },
        { status: 400 },
      );
    }

    if (sender === recipient) {
      return NextResponse.json(
        { error: "sender and recipient must differ" },
        { status: 400 },
      );
    }

    if (sender === "phone") {
      const validToken = await validatePairingToken({ sessionId, role, token });
      if (!validToken) {
        return NextResponse.json(
          { error: "Invalid microphone pairing token" },
          { status: 403 },
        );
      }
    }

    if (!isSafePayload(payload)) {
      return NextResponse.json(
        { error: "Invalid signaling payload" },
        { status: 400 },
      );
    }

    const session = await findOpenSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or already ended" },
        { status: 404 },
      );
    }

    await pruneExpiredSignals();

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SIGNAL_TTL_MS);
    const payloadJson = JSON.stringify(payload);

    await prisma.$executeRaw`
      INSERT INTO web_rtc_signals (
        id,
        session_id,
        role,
        sender,
        recipient,
        message_type,
        payload,
        expires_at
      )
      VALUES (
        ${id},
        ${sessionId},
        ${role},
        ${sender},
        ${recipient},
        ${messageType},
        ${payloadJson}::jsonb,
        ${expiresAt}
      )
    `;

    return NextResponse.json({
      message: {
        id,
        sessionId,
        role,
        sender,
        recipient,
        messageType,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to post WebRTC signal", error);

    return NextResponse.json(
      { error: "Failed to post WebRTC signal" },
      { status: 500 },
    );
  }
}

function serializeSignal(row: SignalRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    sender: row.sender,
    recipient: row.recipient,
    messageType: row.message_type,
    payload: row.payload,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

async function findOpenSession(sessionId: string) {
  return prisma.session.findFirst({
    where: {
      id: sessionId,
      endedAt: null,
    },
    select: {
      id: true,
    },
  });
}

async function pruneExpiredSignals() {
  await prisma.$executeRaw`
    DELETE FROM web_rtc_signals
    WHERE expires_at <= NOW()
  `;
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseRole(value: unknown): SpeakerRole | null {
  return isMicrophoneRole(value) ? value : null;
}

function parsePeer(value: unknown): SignalPeer | null {
  return value === "pc" || value === "phone" ? value : null;
}

function parseMessageType(value: unknown): SignalMessageType | null {
  return value === "offer" ||
    value === "answer" ||
    value === "ice" ||
    value === "bye"
    ? value
    : null;
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date(Date.now() - SIGNAL_TTL_MS);
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? new Date(Date.now() - SIGNAL_TTL_MS)
    : date;
}

function isValidSessionId(value: string) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

function isSafePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  try {
    return JSON.stringify(value).length <= MAX_PAYLOAD_CHARS;
  } catch {
    return false;
  }
}

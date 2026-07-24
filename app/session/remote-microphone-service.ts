export type SpeakerRole = "caregiver" | "elder";
export type SignalPeer = "pc" | "phone";
export type SignalMessageType = "offer" | "answer" | "ice" | "bye";

export type RemoteMicrophoneStreams = Record<SpeakerRole, MediaStream | null>;

export type RemoteMicrophoneState = {
  connectionState: RTCPeerConnectionState | "new" | "closed";
  iceConnectionState: RTCIceConnectionState | "new";
  trackState: MediaStreamTrackState | "none";
  lastReceivedAt: number | null;
  error: string;
};

export type SignalMessage = {
  id: string;
  sessionId: string;
  role: SpeakerRole;
  sender: SignalPeer;
  recipient: SignalPeer;
  messageType: SignalMessageType;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
};

type SignalPayload =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit }
  | { reason?: string };

type ReceiverOptions = {
  sessionId: string;
  onStream: (role: SpeakerRole, stream: MediaStream | null) => void;
  onState: (role: SpeakerRole, state: RemoteMicrophoneState) => void;
};

type SenderOptions = {
  sessionId: string;
  role: SpeakerRole;
  token: string;
  stream: MediaStream;
  onState: (state: RemoteMicrophoneState) => void;
};

const SIGNAL_POLL_MS = 900;
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export const SPEAKER_ROLES: SpeakerRole[] = ["caregiver", "elder"];

export function createInitialRemoteMicrophoneState(): RemoteMicrophoneState {
  return {
    connectionState: "new",
    iceConnectionState: "new",
    trackState: "none",
    lastReceivedAt: null,
    error: "",
  };
}

export function createRemoteMicrophoneReceiver(options: ReceiverOptions) {
  const connections = new Map<SpeakerRole, RTCPeerConnection>();
  const seenSignals = new Set<string>();
  let stopped = false;
  let since = new Date(Date.now() - 3000).toISOString();
  let pollTimer: number | null = null;

  function start() {
    if (pollTimer !== null) return;
    void poll();
  }

  function stop() {
    stopped = true;
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    SPEAKER_ROLES.forEach((role) => {
      closeRole(role);
    });
  }

  async function poll() {
    if (stopped) return;

    try {
      for (const role of SPEAKER_ROLES) {
        const messages = await pollSignals({
          sessionId: options.sessionId,
          role,
          recipient: "pc",
          since,
        });

        for (const message of messages) {
          if (seenSignals.has(message.id)) continue;
          seenSignals.add(message.id);
          since = maxIsoDate(since, message.createdAt);
          await handleMessage(message);
        }
      }
    } catch (error) {
      SPEAKER_ROLES.forEach((role) => {
        options.onState(role, {
          ...createInitialRemoteMicrophoneState(),
          error: toErrorMessage(error),
        });
      });
    } finally {
      if (!stopped) {
        pollTimer = window.setTimeout(() => void poll(), SIGNAL_POLL_MS);
      }
    }
  }

  async function handleMessage(message: SignalMessage) {
    if (message.messageType === "offer") {
      await acceptOffer(message.role, message.payload);
      return;
    }

    if (message.messageType === "ice") {
      const connection = connections.get(message.role);
      const candidate = readCandidate(message.payload);
      if (connection && candidate) {
        await connection.addIceCandidate(candidate).catch(() => {});
      }
      return;
    }

    if (message.messageType === "bye") {
      closeRole(message.role);
    }
  }

  async function acceptOffer(role: SpeakerRole, payload: Record<string, unknown>) {
    const description = readDescription(payload);
    if (!description || description.type !== "offer") return;

    closeRole(role);

    const connection = new RTCPeerConnection(RTC_CONFIG);
    connections.set(role, connection);
    options.onState(role, createState(connection));

    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      event.track.onended = () => {
        options.onStream(role, null);
        options.onState(role, createState(connection));
      };
      options.onStream(role, stream);
      options.onState(role, createState(connection, Date.now()));
    };
    connection.onconnectionstatechange = () => {
      options.onState(role, createState(connection));
      if (isClosedState(connection.connectionState)) {
        options.onStream(role, null);
      }
    };
    connection.oniceconnectionstatechange = () => {
      options.onState(role, createState(connection));
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      void postSignal({
        sessionId: options.sessionId,
        role,
        sender: "pc",
        recipient: "phone",
        messageType: "ice",
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    await connection.setRemoteDescription(description);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await postSignal({
      sessionId: options.sessionId,
      role,
      sender: "pc",
      recipient: "phone",
      messageType: "answer",
      payload: { description: answer },
    });
  }

  function closeRole(role: SpeakerRole) {
    const connection = connections.get(role);
    connections.delete(role);
    connection?.close();
    options.onStream(role, null);
    options.onState(role, {
      ...createInitialRemoteMicrophoneState(),
      connectionState: "closed",
    });
  }

  return { start, stop };
}

export function createRemoteMicrophoneSender(options: SenderOptions) {
  const seenSignals = new Set<string>();
  const queuedCandidates: RTCIceCandidateInit[] = [];
  let connection: RTCPeerConnection | null = null;
  let stopped = false;
  let since = new Date(Date.now() - 3000).toISOString();
  let pollTimer: number | null = null;
  let hasRemoteDescription = false;

  async function start() {
    if (connection) return;

    stopped = false;
    connection = new RTCPeerConnection(RTC_CONFIG);
    options.onState(createState(connection));

    options.stream.getAudioTracks().forEach((track) => {
      connection?.addTrack(track, options.stream);
    });

    connection.onconnectionstatechange = () => {
      if (!connection) return;
      options.onState(createState(connection));
    };
    connection.oniceconnectionstatechange = () => {
      if (!connection) return;
      options.onState(createState(connection));
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      void postSignal({
        sessionId: options.sessionId,
        role: options.role,
        token: options.token,
        sender: "phone",
        recipient: "pc",
        messageType: "ice",
        payload: { candidate: event.candidate.toJSON() },
      });
    };

    const offer = await connection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await connection.setLocalDescription(offer);
    await postSignal({
      sessionId: options.sessionId,
      role: options.role,
      token: options.token,
      sender: "phone",
      recipient: "pc",
      messageType: "offer",
      payload: { description: offer },
    });
    void poll();
  }

  async function stop() {
    stopped = true;
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    await postSignal({
      sessionId: options.sessionId,
      role: options.role,
      token: options.token,
      sender: "phone",
      recipient: "pc",
      messageType: "bye",
      payload: { reason: "stopped" },
    }).catch(() => {});
    connection?.close();
    connection = null;
    hasRemoteDescription = false;
    queuedCandidates.length = 0;
    options.onState({
      ...createInitialRemoteMicrophoneState(),
      connectionState: "closed",
    });
  }

  async function poll() {
    if (stopped) return;

    try {
      const messages = await pollSignals({
        sessionId: options.sessionId,
        role: options.role,
        token: options.token,
        recipient: "phone",
        since,
      });

      for (const message of messages) {
        if (seenSignals.has(message.id)) continue;
        seenSignals.add(message.id);
        since = maxIsoDate(since, message.createdAt);
        await handleMessage(message);
      }
    } catch (error) {
      options.onState({
        ...createInitialRemoteMicrophoneState(),
        error: toErrorMessage(error),
      });
    } finally {
      if (!stopped) {
        pollTimer = window.setTimeout(() => void poll(), SIGNAL_POLL_MS);
      }
    }
  }

  async function handleMessage(message: SignalMessage) {
    if (!connection) return;

    if (message.messageType === "answer") {
      const description = readDescription(message.payload);
      if (!description || description.type !== "answer") return;
      await connection.setRemoteDescription(description);
      hasRemoteDescription = true;
      while (queuedCandidates.length > 0) {
        const candidate = queuedCandidates.shift();
        if (candidate) {
          await connection.addIceCandidate(candidate).catch(() => {});
        }
      }
      options.onState(createState(connection));
      return;
    }

    if (message.messageType === "ice") {
      const candidate = readCandidate(message.payload);
      if (!candidate) return;
      if (!hasRemoteDescription) {
        queuedCandidates.push(candidate);
        return;
      }
      await connection.addIceCandidate(candidate).catch(() => {});
    }
  }

  return { start, stop };
}

export function createStreamLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
) {
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser");
  }

  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  const buffer = new Float32Array(analyser.fftSize);
  let frameId = 0;
  let stopped = false;

  analyser.fftSize = 1024;
  source.connect(analyser);

  const tick = () => {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);
    onLevel(calculateLevel(buffer));
    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
    try {
      source.disconnect();
    } catch {}
    void context.close().catch(() => {});
  };
}

async function postSignal(input: {
  sessionId: string;
  role: SpeakerRole;
  token?: string;
  sender: SignalPeer;
  recipient: SignalPeer;
  messageType: SignalMessageType;
  payload: SignalPayload;
}) {
  const response = await fetch("/api/webrtc/signaling", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Signaling failed: ${response.status}`);
  }
}

async function pollSignals(input: {
  sessionId: string;
  role: SpeakerRole;
  token?: string;
  recipient: SignalPeer;
  since: string;
}) {
  const params = new URLSearchParams({
    sessionId: input.sessionId,
    role: input.role,
    recipient: input.recipient,
    since: input.since,
  });
  if (input.token) {
    params.set("token", input.token);
  }
  const response = await fetch(`/api/webrtc/signaling?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Signaling poll failed: ${response.status}`);
  }

  const data = (await response.json()) as { messages?: SignalMessage[] };

  return Array.isArray(data.messages) ? data.messages : [];
}

function createState(
  connection: RTCPeerConnection,
  lastReceivedAt: number | null = null,
): RemoteMicrophoneState {
  return {
    connectionState: connection.connectionState,
    iceConnectionState: connection.iceConnectionState,
    trackState: "none",
    lastReceivedAt,
    error: "",
  };
}

function readDescription(payload: Record<string, unknown>) {
  const description = payload.description;
  if (!description || typeof description !== "object") return null;

  const value = description as RTCSessionDescriptionInit;

  return value.type && value.sdp ? value : null;
}

function readCandidate(payload: Record<string, unknown>) {
  const candidate = payload.candidate;
  if (!candidate || typeof candidate !== "object") return null;

  return candidate as RTCIceCandidateInit;
}

function calculateLevel(samples: Float32Array) {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) peak = absolute;
  }

  const rms = Math.sqrt(sumSquares / samples.length);

  return Math.min(1, Math.max(rms * 8, peak));
}

function maxIsoDate(current: string, next: string) {
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}

function isClosedState(state: RTCPeerConnectionState) {
  return state === "closed" || state === "failed" || state === "disconnected";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "通信エラーが発生しました";
}

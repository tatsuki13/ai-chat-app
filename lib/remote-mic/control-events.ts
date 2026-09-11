export type RemoteMicRole = "elder" | "caregiver";
export type RemoteMicSpeechContentType = "topic" | "question";

export const REMOTE_MIC_CONTROL_ACK_TIMEOUT_MS = 3_000;
export const REMOTE_MIC_CONTROL_ACK_RETRY_COUNT = 1;
export const REMOTE_MIC_CONTROL_ACK_POLL_MS = 50;

export type LiveTranscriptEvent = {
  type: "transcript.partial" | "transcript.final";
  sessionId: string;
  role: RemoteMicRole;
  streamId: string;
  transcriptId: string;
  revision: number;
  captureEpoch: number;
  text: string;
  startedAt?: string;
  firstPartialAt?: string;
  finalizedAt?: string;
  eventId?: string;
  model?: string;
};

export type RemoteMicSpeechEvent =
  | {
      type: "mic.speech_started";
      sessionId: string;
      role: RemoteMicRole;
      streamId: string;
      transcriptId: string;
      captureEpoch: number;
      timestamp: string;
    }
  | {
      type: "mic.speech_finalized";
      sessionId: string;
      role: RemoteMicRole;
      streamId: string;
      transcriptId: string;
      captureEpoch: number;
      timestamp: string;
    };

export type TranscriptDiscardedEvent = {
  type: "transcript.discarded";
  sessionId: string;
  role: RemoteMicRole;
  streamId: string;
  transcriptId: string;
  reason: string;
};

export type AiSpeechStateEvent = {
  type: "ai_speech_snapshot" | "ai_speech_started" | "ai_speech_ended";
  sessionId: string;
  active: boolean;
  playbackId: string | null;
  activePlaybackId?: string | null;
  contentType: RemoteMicSpeechContentType | null;
  revision: number;
  startedAt?: string | null;
  expectedEndAt?: string | null;
  endedAt?: string | null;
  releaseAfter?: string | null;
  speechPhase?: "idle" | "playing" | "echo-guard";
  sessionEnded?: boolean;
  timestamp: string;
};

export type RemoteMicCaptureStateAckEvent = {
  type: "mic.capture_state";
  sessionId: string;
  role: RemoteMicRole;
  playbackId: string;
  revision: number;
  captureState: "suppressed" | "resumed";
  timestamp: string;
};

export type RemoteMicCaptureStateErrorEvent = {
  type: "mic.capture_error";
  sessionId: string;
  role: RemoteMicRole;
  playbackId: string;
  revision: number;
  captureState: "suppressed" | "resumed";
  reason: string;
  timestamp: string;
};

export type RemoteMicConnectionEvent =
  | {
      type: "mic.reconnecting";
      sessionId: string;
      role: RemoteMicRole;
      previousStreamId: string;
      attempt: number;
      reason: string;
    }
  | {
      type: "mic.reconnected";
      sessionId: string;
      role: RemoteMicRole;
      streamId: string;
      captureState: "listening" | "suppressed";
    }
  | {
      type: "mic.reconnect_failed";
      sessionId: string;
      role: RemoteMicRole;
      attempts: number;
      reason: string;
    };

export type RemoteMicRealtimeEvent =
  | LiveTranscriptEvent
  | RemoteMicSpeechEvent
  | TranscriptDiscardedEvent
  | AiSpeechStateEvent
  | RemoteMicCaptureStateAckEvent
  | RemoteMicCaptureStateErrorEvent
  | RemoteMicConnectionEvent;

export function createLiveTranscriptKey(event: {
  sessionId: string;
  role: RemoteMicRole;
  streamId: string;
  transcriptId: string;
}) {
  return [
    event.sessionId,
    event.role,
    event.streamId,
    event.transcriptId,
  ].join(":");
}

export function isRemoteMicRole(value: unknown): value is RemoteMicRole {
  return value === "elder" || value === "caregiver";
}

export function isRemoteMicSpeechContentType(
  value: unknown,
): value is RemoteMicSpeechContentType {
  return value === "topic" || value === "question";
}

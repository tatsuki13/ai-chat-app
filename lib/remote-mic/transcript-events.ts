import { getRemoteMicRuntimeStore } from "./runtime-store";

export type RemoteMicTranscriptEvent = {
  type: "partial" | "final" | "clear";
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
  utteranceGroupId: string;
  sourceGroupId: string;
  text: string;
  updatedAt: string;
  expiresAt: string;
  utterance?: {
    id: string;
    session_id: string;
    speaker: string;
    text: string;
    start_ms: number | null;
    end_ms: number | null;
    source: string | null;
    source_group_id: string | null;
    asr_provider: string | null;
    asr_model: string | null;
    analysis_version: string | null;
    created_at: string;
    updated_at: string;
  };
  audioCapturedAt?: string | null;
  speechStartedAt?: string | null;
  firstPartialAt?: string | null;
  speechEndedDetectedAt?: string | null;
  transcribedAt?: string | null;
  dbSavedAt?: string | null;
  pcPublishedAt?: string | null;
};

const TRANSCRIPT_EVENT_TTL_MS = Number(
  process.env.REMOTE_MIC_TRANSCRIPT_EVENT_TTL_MS ||
    process.env.REMOTE_MIC_PARTIAL_TRANSCRIPT_TTL_MS ||
    5000,
);

export function publishRemoteMicTranscriptEvent(input: {
  type: "partial" | "final" | "clear";
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
  utteranceGroupId: string;
  sourceGroupId?: string;
  text?: string;
  utterance?: RemoteMicTranscriptEvent["utterance"];
  audioCapturedAt?: string | null;
  speechStartedAt?: string | null;
  firstPartialAt?: string | null;
  speechEndedDetectedAt?: string | null;
  transcribedAt?: string | null;
  dbSavedAt?: string | null;
}) {
  const text = input.text?.trim() ?? input.utterance?.text?.trim() ?? "";
  if (input.type !== "clear" && !text) return;

  const sourceGroupId = input.sourceGroupId ?? input.utteranceGroupId;
  const store = getRemoteMicRuntimeStore();
  const dedupeKey = `${input.sessionId}:${input.role}:${sourceGroupId}`;

  if (input.type === "clear" || input.type === "final") {
    store.transcriptLastPartialByGroup.delete(dedupeKey);
  } else if (store.transcriptLastPartialByGroup.get(dedupeKey) === text) {
    return;
  } else {
    store.transcriptLastPartialByGroup.set(dedupeKey, text);
  }

  const now = Date.now();
  const event: RemoteMicTranscriptEvent = {
    type: input.type,
    sessionId: input.sessionId,
    role: input.role,
    streamId: input.streamId,
    utteranceGroupId: input.utteranceGroupId,
    sourceGroupId,
    text,
    utterance: input.utterance,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TRANSCRIPT_EVENT_TTL_MS).toISOString(),
    audioCapturedAt: input.audioCapturedAt ?? null,
    speechStartedAt: input.speechStartedAt ?? null,
    firstPartialAt: input.firstPartialAt ?? null,
    speechEndedDetectedAt: input.speechEndedDetectedAt ?? null,
    transcribedAt: input.transcribedAt ?? null,
    dbSavedAt: input.dbSavedAt ?? null,
    pcPublishedAt: new Date(now).toISOString(),
  };

  for (const subscriber of store.transcriptSubscribers) {
    subscriber(event);
  }
}

export function subscribeRemoteMicTranscriptEvents(
  subscriber: (event: RemoteMicTranscriptEvent) => void,
) {
  const store = getRemoteMicRuntimeStore();
  store.transcriptSubscribers.add(subscriber as (event: unknown) => void);

  return () => {
    store.transcriptSubscribers.delete(subscriber as (event: unknown) => void);
  };
}

export function getRemoteMicTranscriptEventTtlMs() {
  return TRANSCRIPT_EVENT_TTL_MS;
}

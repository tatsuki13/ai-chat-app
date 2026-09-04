import { getRemoteMicRuntimeStore } from "./runtime-store";

export type RemoteMicPartialTranscriptEvent = {
  type: "partial" | "clear";
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
  utteranceGroupId: string;
  text: string;
  updatedAt: string;
  expiresAt: string;
  audioCapturedAt?: string | null;
  speechStartedAt?: string | null;
  firstPartialAt?: string | null;
  speechEndedDetectedAt?: string | null;
  transcribedAt?: string | null;
  dbSavedAt?: string | null;
  pcPublishedAt?: string | null;
};

const PARTIAL_TRANSCRIPT_TTL_MS = Number(
  process.env.REMOTE_MIC_PARTIAL_TRANSCRIPT_TTL_MS || 5000,
);

export function publishRemoteMicPartialTranscript(input: {
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
  utteranceGroupId: string;
  text?: string;
  clear?: boolean;
  audioCapturedAt?: string | null;
  speechStartedAt?: string | null;
  firstPartialAt?: string | null;
  speechEndedDetectedAt?: string | null;
  transcribedAt?: string | null;
  dbSavedAt?: string | null;
}) {
  const text = input.text?.trim() ?? "";
  if (!input.clear && !text) return;

  const store = getRemoteMicRuntimeStore();
  const dedupeKey = `${input.sessionId}:${input.role}:${input.utteranceGroupId}`;
  if (input.clear) {
    store.partialTranscriptLastByGroup.delete(dedupeKey);
  } else if (store.partialTranscriptLastByGroup.get(dedupeKey) === text) {
    return;
  } else {
    store.partialTranscriptLastByGroup.set(dedupeKey, text);
  }

  const now = Date.now();
  const event: RemoteMicPartialTranscriptEvent = {
    type: input.clear ? "clear" : "partial",
    sessionId: input.sessionId,
    role: input.role,
    streamId: input.streamId,
    utteranceGroupId: input.utteranceGroupId,
    text,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PARTIAL_TRANSCRIPT_TTL_MS).toISOString(),
    audioCapturedAt: input.audioCapturedAt ?? null,
    speechStartedAt: input.speechStartedAt ?? null,
    firstPartialAt: input.firstPartialAt ?? null,
    speechEndedDetectedAt: input.speechEndedDetectedAt ?? null,
    transcribedAt: input.transcribedAt ?? null,
    dbSavedAt: input.dbSavedAt ?? null,
    pcPublishedAt: new Date(now).toISOString(),
  };

  for (const subscriber of store.partialTranscriptSubscribers) {
    subscriber(event);
  }
}

export function subscribeRemoteMicPartialTranscripts(
  subscriber: (event: RemoteMicPartialTranscriptEvent) => void,
) {
  const store = getRemoteMicRuntimeStore();
  store.partialTranscriptSubscribers.add(subscriber as (event: unknown) => void);

  return () => {
    store.partialTranscriptSubscribers.delete(subscriber as (event: unknown) => void);
  };
}

export function getRemoteMicPartialTranscriptTtlMs() {
  return PARTIAL_TRANSCRIPT_TTL_MS;
}

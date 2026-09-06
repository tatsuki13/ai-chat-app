import { prisma } from "../prisma";
import type {
  RemoteMicRealtimeEvent,
  RemoteMicSpeechContentType,
} from "../remote-mic/control-events";
import { getRemoteMicRuntimeStore } from "../remote-mic/runtime-store";

export type AiSpeechContentType = RemoteMicSpeechContentType;

export const AI_SPEECH_RELEASE_DELAY_MS = 500;
export const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45_000;

export async function startAiSpeech(input: {
  sessionId: string;
  playbackId: string;
  contentType: AiSpeechContentType;
  expectedEndAt?: Date | null;
}) {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { participantCode: true },
  });
  if (!session) {
    throw new Error("Session not found");
  }

  const startedAt = new Date();
  const state = await prisma.aISpeechState.upsert({
    where: { sessionId: input.sessionId },
    create: {
      sessionId: input.sessionId,
      participantCode: session.participantCode,
      active: true,
      playbackId: input.playbackId,
      contentType: input.contentType,
      revision: 1,
      startedAt,
      expectedEndAt: input.expectedEndAt ?? undefined,
      endedAt: null,
      releaseAfter: null,
    },
    update: {
      participantCode: session.participantCode,
      active: true,
      playbackId: input.playbackId,
      contentType: input.contentType,
      revision: { increment: 1 },
      startedAt,
      expectedEndAt: input.expectedEndAt ?? undefined,
      endedAt: null,
      releaseAfter: null,
    },
  });

  return state;
}

export async function endAiSpeech(input: {
  sessionId: string;
  playbackId: string;
  cancelled?: boolean;
}) {
  const endedAt = new Date();
  const releaseAfter = new Date(endedAt.getTime() + AI_SPEECH_RELEASE_DELAY_MS);
  const existing = await prisma.aISpeechState.findUnique({
    where: { sessionId: input.sessionId },
  });
  const contentType =
    existing?.contentType === "topic" || existing?.contentType === "question"
      ? existing.contentType
      : "question";
  const nextRevision = (existing?.revision ?? 0) + 1;
  const state = await prisma.aISpeechState.upsert({
    where: { sessionId: input.sessionId },
    create: {
      sessionId: input.sessionId,
      active: false,
      playbackId: input.playbackId,
      contentType,
      revision: nextRevision,
      endedAt,
      releaseAfter,
    },
    update: {
      active: false,
      playbackId: input.playbackId,
      contentType,
      revision: { increment: 1 },
      endedAt,
      releaseAfter,
    },
  });

  return state;
}

export async function getAiSpeechState(sessionId: string) {
  return prisma.aISpeechState.findUnique({
    where: { sessionId },
  });
}

export function isAiSpeechBlockingTranscription(state: {
  active: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  releaseAfter: Date | null;
} | null) {
  if (!state) return false;
  const now = Date.now();

  if (state.active) return true;
  if (state.releaseAfter && now <= state.releaseAfter.getTime()) return true;

  return false;
}

export function subscribeAiSpeechEvents(
  listener: (event: RemoteMicRealtimeEvent) => void,
) {
  const store = getRemoteMicRuntimeStore();
  store.aiSpeechSubscribers.add(listener as (event: unknown) => void);

  return () => {
    store.aiSpeechSubscribers.delete(listener as (event: unknown) => void);
  };
}

export function publishRemoteMicRealtimeEvent(event: RemoteMicRealtimeEvent) {
  const store = getRemoteMicRuntimeStore();
  for (const listener of store.aiSpeechSubscribers) {
    try {
      listener(event);
    } catch {}
  }
}

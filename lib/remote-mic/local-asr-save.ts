import { prisma } from "../prisma";
import {
  createUtteranceTiming,
  pickUtteranceTimingBase,
} from "../server/utterance-timing";
import { UTTERANCE_ANALYSIS_VERSION } from "../server/utterance-metadata";

export type LocalAsrTranscript = {
  status?: "accepted" | "suppressed_crosstalk" | "suppressed_ai_speech" | "empty" | "error";
  sessionId?: string;
  role?: string;
  streamId?: string;
  segmentId?: string;
  utteranceGroupId?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  startedAt?: string;
  endedAt?: string;
  finalized?: boolean;
  asrProvider?: string;
  asrModel?: string;
  reason?: string;
};

export async function appendOrCreateLocalAsrUtterance(input: {
  sessionId: string;
  participantCode: string | null;
  role: "elder" | "caregiver";
  text: string;
  sourceGroupId: string;
  startMs: number | null;
  endMs: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  asrProvider: string;
  asrModel: string | null;
}) {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: {
      startedAt: true,
      dialogueStartedAt: true,
    },
  });
  if (!session) {
    throw new Error("Session not found");
  }

  const timing = createUtteranceTiming({
    baseAt: pickUtteranceTimingBase(session),
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
  });
  const startMs = input.startedAt ? timing.startMs : input.startMs ?? timing.startMs;
  const endMs = input.endedAt
    ? timing.endMs
    : input.endMs ?? input.startMs ?? timing.endMs;
  const source = `remote_local_asr:${input.sourceGroupId}`;
  const existing = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId: input.sessionId,
      sourceGroupId: input.sourceGroupId,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return prisma.sessionUtterance.update({
      where: { id: existing.id },
      data: {
        text: input.text,
        speaker: input.role,
        source,
        startMs,
        endMs,
        sourceGroupId: input.sourceGroupId,
        asrProvider: input.asrProvider,
        asrModel: input.asrModel,
        analysisVersion: UTTERANCE_ANALYSIS_VERSION,
      },
    });
  }

  return prisma.sessionUtterance.create({
    data: {
      sessionId: input.sessionId,
      participantCode: input.participantCode,
      speaker: input.role,
      text: input.text,
      source,
      startMs,
      endMs,
      sourceGroupId: input.sourceGroupId,
      asrProvider: input.asrProvider,
      asrModel: input.asrModel,
      analysisVersion: UTTERANCE_ANALYSIS_VERSION,
    },
  });
}

export function serializeLocalAsrUtterance(utterance: Awaited<ReturnType<typeof appendOrCreateLocalAsrUtterance>>) {
  return {
    id: utterance.id,
    session_id: utterance.sessionId,
    speaker: utterance.speaker,
    text: utterance.text,
    start_ms: utterance.startMs,
    end_ms: utterance.endMs,
    source: utterance.source,
    source_group_id: utterance.sourceGroupId,
    asr_provider: utterance.asrProvider,
    asr_model: utterance.asrModel,
    created_at: utterance.createdAt.toISOString(),
    updated_at: utterance.updatedAt.toISOString(),
  };
}

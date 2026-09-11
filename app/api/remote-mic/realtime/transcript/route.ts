import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getAiSpeechState } from "../../../../../lib/ai/speech-state";
import { prisma } from "../../../../../lib/prisma";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { UTTERANCE_ANALYSIS_VERSION } from "../../../../../lib/server/utterance-metadata";
import {
  createUtteranceTiming,
  pickUtteranceTimingBase,
} from "../../../../../lib/server/utterance-timing";

export const runtime = "nodejs";

const CROSSTALK_SUPPRESSION_WINDOW_MS = 4_000;
const CROSSTALK_MIN_NORMALIZED_LENGTH = 8;
const MAX_TRANSCRIPT_TEXT_LENGTH = 10_000;
// Client and server clocks can differ slightly; keep this narrow to avoid dropping valid speech.
const AI_SPEECH_CLOCK_SKEW_TOLERANCE_MS = 250;
const transcriptDecisionLocks = new Map<string, Promise<void>>();

type FinalSkipReason =
  | "blocked_at_capture"
  | "captured_during_ai_speech"
  | "overlaps_ai_speech"
  | "echo_guard"
  | "empty_text"
  | "crosstalk_duplicate";

type FinalTranscriptRequest = {
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
  transcriptId: string;
  captureEpoch: number;
  text: string;
  startedAt?: string;
  endedAt?: string;
  firstPartialAt?: string;
  finalizedAt?: string;
  eventId?: string;
  model?: string | null;
  blockedAtCapture: boolean;
  aiPlaybackIdAtCapture?: string | null;
};

export async function POST(request: Request) {
  let parsedRequest: FinalTranscriptRequest | null = null;

  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const parsed = parseFinalTranscriptRequest(body);
    if (parsed.ok === false) {
      console.warn("[remote-mic realtime transcript invalid request]", {
        reason: parsed.reason,
      });
      return NextResponse.json({ error: parsed.reason }, { status: 400 });
    }

    const input = parsed.request;
    parsedRequest = input;
    const active = await getFixedRemoteMicActiveSession();
    if (!active || active.sessionId !== input.sessionId || active.endedAt) {
      return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
    }

    return await withTranscriptDecisionLock(input.sessionId, async () => {
      const existing = await findExistingRealtimeUtterance(input);
      if (existing) {
        if (existing.text !== input.text) {
          console.warn("[remote-mic realtime duplicate text mismatch]", {
            sessionId: input.sessionId,
            role: input.role,
            streamId: input.streamId,
            transcriptId: input.transcriptId,
            existingUtteranceId: existing.id,
          });
        }

        return NextResponse.json({
          ok: true,
          outcome: "existing",
          utterance: serializeUtterance(existing),
        });
      }

      const skip = await evaluateFinalTranscript(input);
      if (skip) {
        console.info("[remote-mic realtime transcript skipped]", {
          sessionId: input.sessionId,
          role: input.role,
          streamId: input.streamId,
          transcriptId: input.transcriptId,
          reason: skip.reason,
          sourceUtteranceId: skip.sourceUtteranceId,
          timeDiffMs: skip.timeDiffMs,
        });
        return NextResponse.json({ ok: true, outcome: "skipped", ...skip });
      }

      const session = await prisma.session.findUnique({
        where: { id: input.sessionId },
        select: {
          startedAt: true,
          dialogueStartedAt: true,
          currentTopicId: true,
          currentTopicIndex: true,
        },
      });

      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }

      const timing = createUtteranceTiming({
        baseAt: pickUtteranceTimingBase(session),
        startedAt: input.startedAt ?? input.finalizedAt ?? input.endedAt ?? "",
        endedAt: input.endedAt ?? input.finalizedAt ?? input.startedAt ?? "",
      });

      const utterance = await createRealtimeUtterance(input, {
        participantCode: active.participantCode,
        timing,
        topicId: session.currentTopicId,
        topicIndex: session.currentTopicIndex,
      });

      console.info("[remote-mic realtime transcript saved]", {
        sessionId: input.sessionId,
        role: input.role,
        streamId: input.streamId,
        transcriptId: input.transcriptId,
        outcome: "created",
        textLength: input.text.length,
      });

      return NextResponse.json({
        ok: true,
        outcome: "created",
        utterance: serializeUtterance(utterance),
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      if (parsedRequest) {
        const existing = await findExistingRealtimeUtterance(parsedRequest);
        if (existing) {
          return NextResponse.json({
            ok: true,
            outcome: "existing",
            utterance: serializeUtterance(existing),
          });
        }
      }
    }

    console.error("[remote-mic realtime transcript failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to save realtime transcript" },
      { status: 500 },
    );
  }
}

async function withTranscriptDecisionLock<T>(
  sessionId: string,
  run: () => Promise<T>,
) {
  const previous = transcriptDecisionLocks.get(sessionId);
  let releaseCurrentLock: (() => void) | null = null;
  const current = new Promise<void>((resolve) => {
    releaseCurrentLock = resolve;
  });
  const chained = previous ? previous.catch(() => undefined).then(() => current) : current;
  transcriptDecisionLocks.set(sessionId, chained);

  if (previous) {
    await previous.catch(() => undefined);
  }

  try {
    return await run();
  } finally {
    releaseCurrentLock?.();
    if (transcriptDecisionLocks.get(sessionId) === chained) {
      transcriptDecisionLocks.delete(sessionId);
    }
  }
}

function parseFinalTranscriptRequest(body: Record<string, unknown> | null):
  | { ok: true; request: FinalTranscriptRequest }
  | { ok: false; reason: string } {
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));
  const streamId = requiredString(body?.streamId);
  const transcriptId = requiredString(body?.transcriptId);
  const text = requiredString(body?.text);
  const captureEpoch =
    typeof body?.captureEpoch === "number" && Number.isFinite(body.captureEpoch)
      ? body.captureEpoch
      : null;

  if (!sessionId || !role || !streamId || !transcriptId) {
    return {
      ok: false,
      reason: "sessionId, role, streamId, and transcriptId are required",
    };
  }
  if (captureEpoch === null) return { ok: false, reason: "captureEpoch is required" };
  if (typeof body?.blockedAtCapture !== "boolean") {
    return { ok: false, reason: "blockedAtCapture is required" };
  }
  if (!text) return { ok: false, reason: "text is required" };
  if (text.length > MAX_TRANSCRIPT_TEXT_LENGTH) {
    return { ok: false, reason: "text is too long" };
  }

  const startedAt = optionalString(body?.startedAt);
  const endedAt = optionalString(body?.endedAt);
  const finalizedAt = optionalString(body?.finalizedAt) ?? endedAt;
  if (!endedAt && !finalizedAt) {
    return { ok: false, reason: "endedAt or finalizedAt is required" };
  }
  const dateFields = { startedAt, endedAt, firstPartialAt: optionalString(body?.firstPartialAt), finalizedAt };
  for (const [field, value] of Object.entries(dateFields)) {
    if (value && !parseDate(value)) {
      return { ok: false, reason: `${field} is invalid` };
    }
  }

  return {
    ok: true,
    request: {
      sessionId,
      role,
      streamId,
      transcriptId,
      captureEpoch,
      text,
      startedAt,
      endedAt,
      firstPartialAt: dateFields.firstPartialAt,
      finalizedAt,
      eventId: optionalString(body?.eventId),
      model: optionalString(body?.model) ?? null,
      blockedAtCapture: body.blockedAtCapture,
      aiPlaybackIdAtCapture: optionalString(body?.aiPlaybackIdAtCapture) ?? null,
    },
  };
}

async function evaluateFinalTranscript(input: FinalTranscriptRequest): Promise<{
  reason: FinalSkipReason;
  sourceUtteranceId?: string;
  timeDiffMs?: number;
} | null> {
  if (!input.text.trim()) return { reason: "empty_text" };
  if (input.blockedAtCapture) return { reason: "blocked_at_capture" };
  if (input.aiPlaybackIdAtCapture) return { reason: "captured_during_ai_speech" };

  const aiSpeechState = await getAiSpeechState(input.sessionId);
  const overlapReason = getAiSpeechOverlapReason({
    state: aiSpeechState,
    transcriptStartedAt: parseDate(input.startedAt),
    transcriptEndedAt: parseDate(input.endedAt ?? input.finalizedAt),
  });
  if (overlapReason) return { reason: overlapReason };

  const crosstalkSource = await findRecentCrosstalkUtterance(input);
  if (crosstalkSource) {
    return {
      reason: "crosstalk_duplicate",
      sourceUtteranceId: crosstalkSource.id,
      timeDiffMs: crosstalkSource.timeDiffMs,
    };
  }

  return null;
}

async function createRealtimeUtterance(
  input: FinalTranscriptRequest,
  context: {
    participantCode: string | null;
    timing: { startMs: number; endMs: number };
    topicId: string | null;
    topicIndex: number | null;
  },
) {
  try {
    return await prisma.sessionUtterance.create({
      data: {
        sessionId: input.sessionId,
        participantCode: context.participantCode,
        speaker: input.role,
        text: input.text,
        source: `remote_realtime:${input.streamId}:${input.transcriptId}`,
        topicId: context.topicId,
        topicIndex: context.topicIndex,
        sourceGroupId: input.transcriptId,
        asrProvider: "openai-realtime",
        asrModel: input.model,
        remoteStreamId: input.streamId,
        remoteTranscriptId: input.transcriptId,
        captureEpoch: input.captureEpoch,
        capturedDuringAiSpeech:
          input.blockedAtCapture || Boolean(input.aiPlaybackIdAtCapture),
        aiPlaybackIdAtCapture: input.aiPlaybackIdAtCapture,
        firstPartialAt: parseDate(input.firstPartialAt),
        finalizedAt: parseDate(input.finalizedAt),
        startMs: context.timing.startMs,
        endMs: context.timing.endMs,
        analysisVersion: UTTERANCE_ANALYSIS_VERSION,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await findExistingRealtimeUtterance(input);
      if (existing) return existing;
    }

    throw error;
  }
}

async function findExistingRealtimeUtterance(input: FinalTranscriptRequest) {
  return prisma.sessionUtterance.findFirst({
    where: {
      sessionId: input.sessionId,
      speaker: input.role,
      remoteStreamId: input.streamId,
      remoteTranscriptId: input.transcriptId,
    },
  });
}

function serializeUtterance(
  utterance: NonNullable<Awaited<ReturnType<typeof findExistingRealtimeUtterance>>>,
) {
  return {
    id: utterance.id,
    session_id: utterance.sessionId,
    speaker: utterance.speaker,
    text: utterance.text,
    start_ms: utterance.startMs,
    end_ms: utterance.endMs,
    source: utterance.source,
    topic_id: utterance.topicId,
    topic_index: utterance.topicIndex,
    source_group_id: utterance.sourceGroupId,
    asr_provider: utterance.asrProvider,
    asr_model: utterance.asrModel,
    remote_stream_id: utterance.remoteStreamId,
    remote_transcript_id: utterance.remoteTranscriptId,
    capture_epoch: utterance.captureEpoch,
    captured_during_ai_speech: utterance.capturedDuringAiSpeech,
    ai_playback_id_at_capture: utterance.aiPlaybackIdAtCapture,
    first_partial_at: utterance.firstPartialAt?.toISOString() ?? null,
    finalized_at: utterance.finalizedAt?.toISOString() ?? null,
    analysis_version: utterance.analysisVersion,
    created_at: utterance.createdAt.toISOString(),
    updated_at: utterance.updatedAt.toISOString(),
  };
}

function getAiSpeechOverlapReason(input: {
  state: Awaited<ReturnType<typeof getAiSpeechState>>;
  transcriptStartedAt: Date | null;
  transcriptEndedAt: Date | null;
}): "overlaps_ai_speech" | "echo_guard" | null {
  const state = input.state;
  if (!state?.startedAt) return null;

  const transcriptStartMs =
    input.transcriptStartedAt?.getTime() ?? input.transcriptEndedAt?.getTime();
  const transcriptEndMs =
    input.transcriptEndedAt?.getTime() ?? input.transcriptStartedAt?.getTime();
  if (transcriptStartMs === undefined || transcriptEndMs === undefined) return null;

  const aiStartMs = state.startedAt.getTime() - AI_SPEECH_CLOCK_SKEW_TOLERANCE_MS;
  const aiEndMs =
    (state.endedAt?.getTime() ??
      (state.active ? Date.now() : state.startedAt.getTime())) +
    AI_SPEECH_CLOCK_SKEW_TOLERANCE_MS;
  const releaseAfterMs = state.releaseAfter?.getTime() ?? null;

  if (transcriptStartMs < aiEndMs && transcriptEndMs > aiStartMs) {
    return "overlaps_ai_speech";
  }

  if (
    state.endedAt &&
    releaseAfterMs !== null &&
    transcriptStartMs >=
      state.endedAt.getTime() - AI_SPEECH_CLOCK_SKEW_TOLERANCE_MS &&
    transcriptStartMs <= releaseAfterMs + AI_SPEECH_CLOCK_SKEW_TOLERANCE_MS
  ) {
    return "echo_guard";
  }

  return null;
}

async function findRecentCrosstalkUtterance(input: FinalTranscriptRequest) {
  const normalizedText = normalizeTranscriptForCrosstalk(input.text);

  if (normalizedText.length < CROSSTALK_MIN_NORMALIZED_LENGTH) {
    return null;
  }

  const transcriptEndedAt = parseDate(input.endedAt ?? input.finalizedAt) ?? new Date();
  const windowStart = new Date(
    transcriptEndedAt.getTime() - CROSSTALK_SUPPRESSION_WINDOW_MS,
  );
  const windowEnd = new Date(
    transcriptEndedAt.getTime() + CROSSTALK_SUPPRESSION_WINDOW_MS,
  );
  const recentOppositeRoleUtterances = await prisma.sessionUtterance.findMany({
    where: {
      sessionId: input.sessionId,
      speaker: input.role === "elder" ? "caregiver" : "elder",
      OR: [
        { createdAt: { gte: windowStart, lte: windowEnd } },
        { finalizedAt: { gte: windowStart, lte: windowEnd } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      text: true,
      createdAt: true,
      finalizedAt: true,
    },
  });

  const match =
    recentOppositeRoleUtterances.find((utterance) =>
      isLikelySameTranscript(normalizedText, utterance.text),
    ) ?? null;
  if (!match) return null;

  return {
    id: match.id,
    timeDiffMs: Math.abs(
      (match.finalizedAt ?? match.createdAt).getTime() - transcriptEndedAt.getTime(),
    ),
  };
}

function isLikelySameTranscript(normalizedText: string, candidateText: string) {
  const normalizedCandidate = normalizeTranscriptForCrosstalk(candidateText);

  if (normalizedCandidate.length < CROSSTALK_MIN_NORMALIZED_LENGTH) {
    return false;
  }

  return (
    normalizedText === normalizedCandidate ||
    normalizedText.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedText)
  );
}

function normalizeTranscriptForCrosstalk(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。,.，．！？!?「」『』（）()[\]{}]/g, "");
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

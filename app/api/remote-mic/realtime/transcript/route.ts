import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import {
  getActiveFixedRemoteMicSession,
} from "../../../../../lib/remote-mic/fixed-session";
import { prisma } from "../../../../../lib/prisma";
import {
  createUtteranceTiming,
  pickUtteranceTimingBase,
} from "../../../../../lib/server/utterance-timing";
import { UTTERANCE_ANALYSIS_VERSION } from "../../../../../lib/server/utterance-metadata";
import {
  getAiSpeechState,
  isAiSpeechBlockingTranscription,
} from "../../../../../lib/ai/speech-state";

export const runtime = "nodejs";

const CROSSTALK_SUPPRESSION_WINDOW_MS = 4_000;
const CROSSTALK_MIN_NORMALIZED_LENGTH = 8;
const SAME_SPEAKER_MERGE_WINDOW_MS = 30_000;
const SAME_SPEAKER_MERGE_MAX_TEXT_LENGTH = 900;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
    streamId?: unknown;
    transcriptId?: unknown;
    text?: unknown;
    status?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
    finalizedAt?: unknown;
    firstPartialAt?: unknown;
    eventId?: unknown;
    model?: unknown;
    aiPlaybackIdAtCapture?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));
  const streamId = requiredString(body?.streamId);
  const transcriptId = requiredString(body?.transcriptId);
  const text = requiredString(body?.text);
  const status = parseTranscriptStatus(requiredString(body?.status));
  const model = requiredString(body?.model) || null;

  if (!sessionId || !role || !streamId || !transcriptId || !status) {
    return NextResponse.json(
      { error: "sessionId, role, streamId, transcriptId, and status are required" },
      { status: 400 },
    );
  }
  if (status !== "final") {
    return NextResponse.json(
      { error: "Realtime transcript API accepts final transcripts only" },
      { status: 400 },
    );
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  const roleState = active.roles[role];
  if (roleState?.muted) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "remote_mic_muted",
    });
  }

  const startedAt = requiredString(body?.startedAt);
  const endedAt = requiredString(body?.endedAt);
  const finalizedAt = requiredString(body?.finalizedAt) || endedAt;
  const aiSpeechState = await getAiSpeechState(sessionId);
  const aiPlaybackIdAtCapture = requiredString(body?.aiPlaybackIdAtCapture);
  const overlapsAiSpeech = doesTranscriptOverlapAiSpeech({
    state: aiSpeechState,
    startedAt: parseDate(startedAt),
    finalizedAt: parseDate(finalizedAt),
  });
  if (
    aiPlaybackIdAtCapture ||
    isAiSpeechBlockingTranscription(aiSpeechState) ||
    overlapsAiSpeech
  ) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: aiPlaybackIdAtCapture
        ? "captured_during_ai_speech"
        : overlapsAiSpeech
          ? "overlaps_ai_speech"
          : "ai_speech_active",
    });
  }

  if (!text) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      startedAt: true,
      dialogueStartedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const timing = createUtteranceTiming({
    baseAt: pickUtteranceTimingBase(session),
    startedAt,
    endedAt,
  });

  const source = `remote_realtime:${transcriptId}`;
  const existing = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId,
      OR: [
        { sourceGroupId: transcriptId },
        { source },
        {
          source: {
            contains: transcriptId,
          },
        },
      ],
    },
  });

  if (!existing) {
    const crosstalkSource = await findRecentCrosstalkUtterance({
      sessionId,
      role,
      text,
    });

    if (crosstalkSource) {
      console.info("[remote-mic realtime transcript skipped as crosstalk]", {
        sessionId,
        role,
        transcriptId,
        sourceUtteranceId: crosstalkSource.id,
      });

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "crosstalk_duplicate",
        sourceUtteranceId: crosstalkSource.id,
      });
    }
  }

  const utterance = existing ?? (await appendOrCreateRemoteUtterance({
    sessionId,
    participantCode: active.participantCode,
    role,
    text,
    source,
    sourceGroupId: transcriptId,
    transcriptId,
    timing,
    asrModel: model,
  }));
  const serialized = serializeUtterance(utterance);

  console.info("[remote-mic realtime transcript saved]", {
    sessionId,
    role,
    transcriptId,
    textLength: text.length,
    duplicate: Boolean(existing),
    merged: utterance.source !== source,
  });

  return NextResponse.json({
    ok: true,
    utterance: serialized,
  });
}

async function appendOrCreateRemoteUtterance(input: {
  sessionId: string;
  participantCode: string | null;
  role: "elder" | "caregiver";
  text: string;
  source: string;
  sourceGroupId: string;
  transcriptId: string;
  timing: UtteranceTiming;
  asrModel: string | null;
}) {
  const latestUtterance = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId: input.sessionId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      speaker: true,
      text: true,
      source: true,
      sourceGroupId: true,
      startMs: true,
      endMs: true,
      createdAt: true,
    },
  });

  if (canMergeWithLatestRemoteUtterance(latestUtterance, input.role, input.text)) {
    const nextSource = appendTranscriptIdToSource(
      latestUtterance.source,
      input.transcriptId,
    );

    return prisma.sessionUtterance.update({
      where: {
        id: latestUtterance.id,
      },
      data: {
        text: joinTranscriptText(latestUtterance.text, input.text),
        source: nextSource,
        sourceGroupId: input.sourceGroupId,
        startMs: latestUtterance.startMs ?? input.timing.startMs,
        endMs: input.timing.endMs ?? latestUtterance.endMs,
        asrProvider: "openai-realtime",
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
      source: input.source,
      sourceGroupId: input.sourceGroupId,
      startMs: input.timing.startMs,
      endMs: input.timing.endMs,
      asrProvider: "openai-realtime",
      asrModel: input.asrModel,
      analysisVersion: UTTERANCE_ANALYSIS_VERSION,
    },
  });
}

type UtteranceTiming = {
  startMs: number;
  endMs: number;
};

function serializeUtterance(
  utterance: Awaited<ReturnType<typeof appendOrCreateRemoteUtterance>>,
) {
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
    analysis_version: utterance.analysisVersion,
    created_at: utterance.createdAt.toISOString(),
    updated_at: utterance.updatedAt.toISOString(),
  };
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTranscriptStatus(value: string) {
  return value === "partial" || value === "final" ? value : null;
}

function parseDate(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function doesTranscriptOverlapAiSpeech(input: {
  state: Awaited<ReturnType<typeof getAiSpeechState>>;
  startedAt: Date | null;
  finalizedAt: Date | null;
}) {
  const state = input.state;
  if (!state?.startedAt) return false;

  const releaseAfter = state.releaseAfter ?? state.endedAt ?? null;
  if (!state.active && !releaseAfter) return false;

  const transcriptStartMs = input.startedAt?.getTime() ?? input.finalizedAt?.getTime();
  const transcriptEndMs = input.finalizedAt?.getTime() ?? transcriptStartMs;
  if (transcriptStartMs === undefined || transcriptEndMs === undefined) return false;

  const aiStartMs = state.startedAt.getTime();
  const aiEndMs = state.active
    ? Date.now()
    : releaseAfter?.getTime() ?? state.endedAt?.getTime() ?? aiStartMs;

  return transcriptStartMs <= aiEndMs && transcriptEndMs >= aiStartMs;
}

function canMergeWithLatestRemoteUtterance(
  latestUtterance: {
    speaker: string;
    text: string;
    source: string | null;
    createdAt: Date;
  } | null,
  role: "elder" | "caregiver",
  text: string,
) {
  if (!latestUtterance) return false;
  if (latestUtterance.speaker !== role) return false;
  if (!latestUtterance.source?.startsWith("remote_realtime:")) return false;
  if (Date.now() - latestUtterance.createdAt.getTime() > SAME_SPEAKER_MERGE_WINDOW_MS) {
    return false;
  }

  return (
    joinTranscriptText(latestUtterance.text, text).length <=
    SAME_SPEAKER_MERGE_MAX_TEXT_LENGTH
  );
}

function appendTranscriptIdToSource(source: string | null, transcriptId: string) {
  if (!source) return `remote_realtime:${transcriptId}`;
  if (source.includes(transcriptId)) return source;

  return `${source},${transcriptId}`;
}

function joinTranscriptText(currentText: string, nextText: string) {
  const current = currentText.trim();
  const next = nextText.trim();

  if (!current) return next;
  if (!next) return current;

  return `${current} ${next}`;
}

async function findRecentCrosstalkUtterance(input: {
  sessionId: string;
  role: "elder" | "caregiver";
  text: string;
}) {
  const normalizedText = normalizeTranscriptForCrosstalk(input.text);

  if (normalizedText.length < CROSSTALK_MIN_NORMALIZED_LENGTH) {
    return null;
  }

  const recentOppositeRoleUtterances = await prisma.sessionUtterance.findMany({
    where: {
      sessionId: input.sessionId,
      speaker: input.role === "elder" ? "caregiver" : "elder",
      createdAt: {
        gte: new Date(Date.now() - CROSSTALK_SUPPRESSION_WINDOW_MS),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      text: true,
    },
  });

  return (
    recentOppositeRoleUtterances.find((utterance) =>
      isLikelySameTranscript(normalizedText, utterance.text),
    ) ?? null
  );
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

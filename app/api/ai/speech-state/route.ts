import { NextResponse } from "next/server";
import {
  endAiSpeech,
  getAiSpeechState,
  startAiSpeech,
  type AiSpeechContentType,
} from "../../../../lib/ai/speech-state";
import { logAIIntervention } from "../../../../lib/ai/intervention-log";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const state = await getAiSpeechState(sessionId);

  return NextResponse.json({ state: serializeState(state) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      playbackId?: unknown;
      contentType?: unknown;
      action?: unknown;
      expectedEndAt?: unknown;
      text?: unknown;
      topicId?: unknown;
      requestedAt?: unknown;
      mutePreparedAt?: unknown;
      playbackStatus?: unknown;
      playbackStartedAt?: unknown;
      playbackEndedAt?: unknown;
      micsResumedAt?: unknown;
      speechEngine?: unknown;
      preparedAudioUsed?: unknown;
      audioGenerationDurationMs?: unknown;
      playbackErrorCode?: unknown;
    } | null;
    const sessionId = requiredString(body?.sessionId);
    const playbackId = requiredString(body?.playbackId);
    const action = requiredString(body?.action);
    const contentType = parseContentType(requiredString(body?.contentType));

    if (!sessionId || !playbackId) {
      return NextResponse.json(
        { error: "sessionId and playbackId are required" },
        { status: 400 },
      );
    }

    if (action === "start") {
      if (!contentType) {
        return NextResponse.json(
          { error: "contentType is required" },
          { status: 400 },
        );
      }

      const expectedEndAtText = requiredString(body?.expectedEndAt);
      const state = await startAiSpeech({
        sessionId,
        playbackId,
        contentType,
        expectedEndAt: expectedEndAtText ? new Date(expectedEndAtText) : null,
      });

      return NextResponse.json({ state: serializeState(state) });
    }

    if (action === "end" || action === "cancel") {
      const state = await endAiSpeech({
        sessionId,
        playbackId,
        cancelled: action === "cancel",
      });

      return NextResponse.json({ state: serializeState(state) });
    }

    if (action === "log") {
      await logPlaybackIfRequested({
        sessionId,
        playbackId,
        body,
        contentType,
      });
      const state = await getAiSpeechState(sessionId);

      return NextResponse.json({ state: serializeState(state) });
    }

    return NextResponse.json({ error: "unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("[ai speech-state failed]", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to update AI speech state" },
      { status: 500 },
    );
  }
}

async function logPlaybackIfRequested(input: {
  sessionId: string;
  playbackId: string;
  body: {
    text?: unknown;
    topicId?: unknown;
    playbackStatus?: unknown;
    requestedAt?: unknown;
    mutePreparedAt?: unknown;
    playbackStartedAt?: unknown;
    playbackEndedAt?: unknown;
    micsResumedAt?: unknown;
    speechEngine?: unknown;
    preparedAudioUsed?: unknown;
    audioGenerationDurationMs?: unknown;
    playbackErrorCode?: unknown;
  } | null;
  contentType: unknown;
}) {
  const text = requiredString(input.body?.text);
  const playbackStatus = requiredString(input.body?.playbackStatus);
  if (!text && !playbackStatus) return;

  const existing = await prisma.aIInterventionLog.findFirst({
    where: {
      sessionId: input.sessionId,
      type: "OTHER",
      metadata: {
        path: ["playbackId"],
        equals: input.playbackId,
      },
    },
    select: { id: true },
  });
  if (existing) return;

  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: { participantCode: true },
  });
  const requestedAt = parseDate(input.body?.requestedAt);
  const playbackStartedAt = parseDate(input.body?.playbackStartedAt);
  const playbackEndedAt = parseDate(input.body?.playbackEndedAt);
  await logAIIntervention({
    sessionId: input.sessionId,
    participantCode: session?.participantCode,
    type: "OTHER",
    content: text,
    topicId: optionalString(input.body?.topicId) ?? null,
    requestedAt,
    generatedAt: playbackEndedAt ?? new Date(),
    displayedAt: playbackStartedAt,
    metadata: {
      kind: "speech_playback",
      playbackId: input.playbackId,
      contentType:
        input.contentType === "topic" || input.contentType === "question"
          ? input.contentType
          : null,
      requestedAt: optionalString(input.body?.requestedAt),
      mutePreparedAt: optionalString(input.body?.mutePreparedAt),
      playbackStatus: playbackStatus || "completed",
      playbackStartedAt: optionalString(input.body?.playbackStartedAt),
      playbackEndedAt: optionalString(input.body?.playbackEndedAt),
      micsResumedAt: optionalString(input.body?.micsResumedAt),
      speechEngine:
        optionalString(input.body?.speechEngine) ?? "browser-speechSynthesis",
      preparedAudioUsed: Boolean(input.body?.preparedAudioUsed),
      audioGenerationDurationMs:
        typeof input.body?.audioGenerationDurationMs === "number"
          ? input.body.audioGenerationDurationMs
          : null,
      playbackErrorCode: optionalString(input.body?.playbackErrorCode),
    },
  });
}

function serializeState(
  state: Awaited<ReturnType<typeof getAiSpeechState>>,
) {
  if (!state) return null;

  return {
    sessionId: state.sessionId,
    active: state.active,
    playbackId: state.playbackId,
    contentType: state.contentType,
    revision: state.revision,
    startedAt: state.startedAt?.toISOString() ?? null,
    expectedEndAt: state.expectedEndAt?.toISOString() ?? null,
    endedAt: state.endedAt?.toISOString() ?? null,
    releaseAfter: state.releaseAfter?.toISOString() ?? null,
  };
}

function parseContentType(value: string): AiSpeechContentType | null {
  return value === "topic" || value === "question" ? value : null;
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDate(value: unknown) {
  const text = optionalString(value);
  if (!text) return null;

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

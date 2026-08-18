import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";
import { requireSessionAccess } from "../../../../lib/auth";
import { hasDatabaseColumn, isMissingColumnError } from "../../../../lib/db-compat";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireSessionAccess(request, id);
    if ("response" in auth) return auth.response;

    const { session, utteranceCount, utterances } =
      await loadSessionDetailWithCompat(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
        topic_started_at: session.topicStartedAt?.toISOString() ?? null,
        conversation_phase: session.conversationPhase,
        topic_paused_ms: session.topicPausedMs,
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      utterance_count: utteranceCount,
      utterances: utterances.reverse().map((utterance) => ({
        id: utterance.id,
        speaker: normalizeConversationSpeaker(utterance.speaker),
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }
}

async function loadSessionDetailWithCompat(id: string) {
  if (!(await hasSessionProgressColumns())) {
    return loadLegacySessionDetail(id);
  }

  try {
    const [session, utteranceCount, utterances] = await prisma.$transaction([
      prisma.session.findUnique({
        where: { id },
        select: {
          id: true,
          participantCode: true,
          condition: true,
          startedAt: true,
          dialogueStartedAt: true,
          currentTopicId: true,
          currentTopicIndex: true,
          topicStartedAt: true,
          conversationPhase: true,
          topicPausedMs: true,
          endedAt: true,
        },
      }),
      prisma.sessionUtterance.count({
        where: { sessionId: id },
      }),
      prisma.sessionUtterance.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          speaker: true,
          text: true,
          createdAt: true,
        },
      }),
    ]);

    return { session, utteranceCount, utterances };
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;

    return loadLegacySessionDetail(id);
  }
}

async function loadLegacySessionDetail(id: string) {
  const [session, utteranceCount, utterances] = await prisma.$transaction([
    prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        dialogueStartedAt: true,
        endedAt: true,
      },
    }),
    prisma.sessionUtterance.count({
      where: { sessionId: id },
    }),
    prisma.sessionUtterance.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        speaker: true,
        text: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    session: session
      ? {
          ...session,
          currentTopicId: null,
          currentTopicIndex: 0,
          topicStartedAt: null,
          conversationPhase: null,
          topicPausedMs: 0,
        }
      : null,
    utteranceCount,
    utterances,
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireSessionAccess(request, id);
    if ("response" in auth) return auth.response;
    const body = await request.json();

    const hasParticipantCode = "participant_code" in body || "participantCode" in body;
    const progressPatch = buildProgressPatch(body);

    if (!hasParticipantCode && Object.keys(progressPatch).length === 0) {
      return NextResponse.json(
        { error: "participant_code or progress field is required" },
        { status: 400 },
      );
    }

    const participantCode = hasParticipantCode
      ? normalizeParticipantCode(body.participant_code ?? body.participantCode)
      : undefined;

    if (hasParticipantCode && !participantCode) {
      return NextResponse.json(
        { error: "participant_code cannot be empty" },
        { status: 400 },
      );
    }

    if (participantCode) {
      const existing = await prisma.session.findFirst({
        where: {
          participantCode,
          NOT: { id },
        },
        select: { id: true },
      });

      if (existing) {
        return NextResponse.json(
          { error: "participant_code already exists" },
          { status: 409 },
        );
      }
    }

    const session = await updateSessionWithCompat(id, participantCode, progressPatch);

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
        topic_started_at: session.topicStartedAt?.toISOString() ?? null,
        conversation_phase: session.conversationPhase,
        topic_paused_ms: session.topicPausedMs,
        ended_at: session.endedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error(error);

    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "participant_code already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireSessionAccess(request, id);
    if ("response" in auth) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            utterances: true,
            finalMinutes: true,
            remoteMicTokens: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ discarded: false, reason: "not_found" });
    }

    if (
      session._count.utterances > 0 ||
      session._count.finalMinutes > 0 ||
      session._count.remoteMicTokens > 0
    ) {
      return NextResponse.json({
        discarded: false,
        reason: "session_has_content",
      });
    }

    await prisma.session.delete({
      where: { id },
    });

    return NextResponse.json({ discarded: true });
  } catch (error) {
    console.error("Failed to discard unused session", error);

    return NextResponse.json(
      { error: "Failed to discard unused session" },
      { status: 500 },
    );
  }
}

async function updateSessionWithCompat(
  id: string,
  participantCode: string | undefined,
  progressPatch: ReturnType<typeof buildProgressPatch>,
) {
  const canPersistProgress = await hasSessionProgressColumns();

  if (!canPersistProgress) {
    if (participantCode) {
      return prisma.session.update({
        where: { id },
        data: { participantCode },
        select: {
          id: true,
          participantCode: true,
          condition: true,
          startedAt: true,
          dialogueStartedAt: true,
          endedAt: true,
        },
      }).then((session) => ({
        ...session,
        currentTopicId: null,
        currentTopicIndex: 0,
        topicStartedAt: null,
        conversationPhase: null,
        topicPausedMs: 0,
      }));
    }

    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        dialogueStartedAt: true,
        endedAt: true,
      },
    });
    if (!session) throw new Error("Session not found");

    return {
      ...session,
      currentTopicId: null,
      currentTopicIndex: 0,
      topicStartedAt: null,
      conversationPhase: null,
      topicPausedMs: 0,
    };
  }

  return prisma.session.update({
    where: { id },
    data: {
      ...(participantCode ? { participantCode } : {}),
      ...progressPatch,
    },
  });
}

async function hasSessionProgressColumns() {
  return hasDatabaseColumn("sessions", "current_topic_id");
}

function normalizeParticipantCode(value: unknown) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed || null;
}

function buildProgressPatch(body: Record<string, unknown>) {
  const patch: {
    currentTopicId?: string | null;
    currentTopicIndex?: number | null;
    topicStartedAt?: Date | null;
    conversationPhase?: string | null;
    topicPausedMs?: number;
    dialogueStartedAt?: Date | null;
    endedAt?: Date | null;
  } = {};

  const currentTopicId = optionalString(body.current_topic_id ?? body.currentTopicId);
  if (currentTopicId !== undefined) patch.currentTopicId = currentTopicId;

  const currentTopicIndex = optionalInteger(
    body.current_topic_index ?? body.currentTopicIndex,
  );
  if (currentTopicIndex !== undefined) patch.currentTopicIndex = currentTopicIndex;

  if ("topic_started_at" in body || "topicStartedAt" in body) {
    patch.topicStartedAt = optionalDate(body.topic_started_at ?? body.topicStartedAt);
  }

  const conversationPhase = optionalString(
    body.conversation_phase ?? body.conversationPhase,
  );
  if (conversationPhase !== undefined) patch.conversationPhase = conversationPhase;

  const topicPausedMs = optionalInteger(body.topic_paused_ms ?? body.topicPausedMs);
  if (topicPausedMs !== undefined) patch.topicPausedMs = topicPausedMs;

  if ("dialogue_started_at" in body || "dialogueStartedAt" in body) {
    patch.dialogueStartedAt = optionalDate(
      body.dialogue_started_at ?? body.dialogueStartedAt,
    );
  }

  if ("ended_at" in body || "endedAt" in body) {
    patch.endedAt = optionalDate(body.ended_at ?? body.endedAt);
  }

  return patch;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalInteger(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);

  return Number.isInteger(numericValue) && numericValue >= 0 ? numericValue : undefined;
}

function optionalDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

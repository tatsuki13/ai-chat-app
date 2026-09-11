import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import {
  DISCUSSION_TOPICS,
  normalizeConversationSpeaker,
} from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";
import { clearFixedRemoteMicActiveSession } from "../../../../lib/remote-mic/active-session-db";
import { clearFixedRemoteMicRoleStates } from "../../../../lib/remote-mic/fixed-role-state-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  let id = "";

  try {
    id = (await context.params).id;
    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        dialogueStartedAt: true,
        endedAt: true,
        currentTopicId: true,
        currentTopicIndex: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [utteranceCount, utterances] = await Promise.all([
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
          startMs: true,
          endMs: true,
          source: true,
          topicId: true,
          topicIndex: true,
          sourceGroupId: true,
          asrProvider: true,
          asrModel: true,
          remoteStreamId: true,
          remoteTranscriptId: true,
          captureEpoch: true,
          capturedDuringAiSpeech: true,
          aiPlaybackIdAtCapture: true,
          firstPartialAt: true,
          finalizedAt: true,
          analysisVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        ended_at: session.endedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
      },
      utterance_count: utteranceCount,
      utterances: utterances.reverse().map((utterance) => ({
        id: utterance.id,
        session_id: id,
        speaker: normalizeConversationSpeaker(utterance.speaker),
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
      })),
    });
  } catch (error) {
    console.error("[session detail load failed]", {
      sessionId: id,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    const shouldStartDialogue = Boolean(
      body.start_dialogue ?? body.startDialogue,
    );
    const shouldUpdateTopic = Boolean(
      body.update_current_topic ?? body.updateCurrentTopic,
    );

    if (shouldUpdateTopic) {
      const topicId = optionalString(body.current_topic_id ?? body.currentTopicId);
      const topicIndex =
        typeof body.current_topic_index === "number" &&
        Number.isInteger(body.current_topic_index)
          ? body.current_topic_index
          : typeof body.currentTopicIndex === "number" &&
              Number.isInteger(body.currentTopicIndex)
            ? body.currentTopicIndex
            : null;

      if (!topicId || topicIndex === null) {
        return NextResponse.json(
          { error: "current_topic_id and current_topic_index are required" },
          { status: 400 },
        );
      }

      const session = await prisma.session.update({
        where: { id },
        data: {
          currentTopicId: topicId,
          currentTopicIndex: topicIndex,
        },
      });

      return NextResponse.json({
        session: {
          id: session.id,
          participant_code: session.participantCode,
          condition: session.condition,
          started_at: session.startedAt.toISOString(),
          dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
          ended_at: session.endedAt?.toISOString() ?? null,
          current_topic_id: session.currentTopicId,
          current_topic_index: session.currentTopicIndex,
        },
      });
    }

    if (
      shouldStartDialogue &&
      !("participant_code" in body) &&
      !("participantCode" in body)
    ) {
      const existing = await prisma.session.findUnique({
        where: { id },
      });

      if (!existing) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (existing.endedAt) {
        return NextResponse.json(
          { error: "Session is not active" },
          { status: 409 },
        );
      }

      const session = existing.dialogueStartedAt
        ? existing
        : await prisma.session.update({
            where: { id },
            data: {
                dialogueStartedAt: new Date(),
                currentTopicId: existing.currentTopicId ?? DISCUSSION_TOPICS[0]?.id,
                currentTopicIndex: existing.currentTopicIndex ?? 0,
              },
          });

      return NextResponse.json({
        session: {
          id: session.id,
          participant_code: session.participantCode,
          condition: session.condition,
          started_at: session.startedAt.toISOString(),
          dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
          ended_at: session.endedAt?.toISOString() ?? null,
          current_topic_id: session.currentTopicId,
          current_topic_index: session.currentTopicIndex,
        },
      });
    }

    if (!("participant_code" in body) && !("participantCode" in body)) {
      return NextResponse.json(
        { error: "participant_code is required" },
        { status: 400 },
      );
    }

    const participantCode = normalizeParticipantCode(
      body.participant_code ?? body.participantCode,
    );

    if (!participantCode) {
      return NextResponse.json(
        { error: "participant_code cannot be empty" },
        { status: 400 },
      );
    }

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

    const targetSession = await prisma.session.findUnique({
      where: { id },
      select: {
        dialogueStartedAt: true,
        _count: {
          select: {
            utterances: true,
            finalMinutes: true,
          },
        },
      },
    });

    if (!targetSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (
      targetSession.dialogueStartedAt ||
      targetSession._count.utterances > 0 ||
      targetSession._count.finalMinutes > 0
    ) {
      return NextResponse.json(
        { error: "participant_code cannot be changed after session has content" },
        { status: 409 },
      );
    }

    const session = await prisma.session.update({
      where: { id },
      data: {
        participantCode,
      },
    });

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            utterances: true,
            finalMinutes: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ discarded: false, reason: "not_found" });
    }

    if (
      session._count.utterances > 0 ||
      session._count.finalMinutes > 0
    ) {
      return NextResponse.json({
        discarded: false,
        reason: "session_has_content",
      });
    }

    await clearFixedRemoteMicActiveSession(id);
    await clearFixedRemoteMicRoleStates(id);
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

function normalizeParticipantCode(value: unknown) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed || null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

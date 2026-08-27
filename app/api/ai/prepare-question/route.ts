import { NextResponse } from "next/server";
import {
  getUnprocessedSlotUtterances,
  getSessionContext,
  saveSlotStates,
  saveSubSlotStates,
} from "../../../../lib/acp-store";
import { resolveDiscussionTopic } from "../../../../lib/acp-mvp";
import {
  generateNextQuestion,
  updateSlotStateBundleFromConversation,
} from "../../../../lib/ai";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

const PROCESSING_TIMEOUT_MS = 60_000;
const PREPARED_QUESTION_TTL_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const requestedAt = new Date();
  let sessionId = "";

  try {
    const body = await request.json().catch(() => ({}));
    sessionId = requiredString(body.session_id ?? body.sessionId);
    const currentTopic = optionalString(body.current_topic ?? body.currentTopic);
    const currentTopicTitle = optionalString(
      body.current_topic_title ?? body.currentTopicTitle,
    );

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const topic = resolveDiscussionTopic(currentTopic);
    const context = await getSessionContext(sessionId);
    const latestUtterance = context.utterances.at(-1);
    const activeState = await prisma.aIProcessingState.findUnique({
      where: { sessionId },
    });
    const utterancesToClassify = getUnprocessedSlotUtterances(
      context.utterances,
      activeState?.lastProcessedUtteranceId,
    );
    const existingPrepared = await prisma.preparedQuestion.findFirst({
      where: {
        sessionId,
        topicId: topic.id,
        status: "prepared",
        OR: [{ expiresAt: null }, { expiresAt: { gt: requestedAt } }],
      },
      orderBy: { generatedAt: "desc" },
    });

    if (
      existingPrepared &&
      activeState?.processingStatus === "ready" &&
      activeState.lastProcessedUtteranceId === (latestUtterance?.id ?? null) &&
      activeState.slotRevision === existingPrepared.slotRevision
    ) {
      return NextResponse.json({
        processing: toProcessingStateResponse(activeState),
        prepared_question: toPreparedQuestionResponse(existingPrepared),
        reused: true,
      });
    }

    if (
      activeState &&
      activeState.processingStatus !== "idle" &&
      activeState.processingStatus !== "ready" &&
      activeState.processingStatus !== "failed" &&
      activeState.processingStartedAt &&
      requestedAt.getTime() - activeState.processingStartedAt.getTime() <
        PROCESSING_TIMEOUT_MS
    ) {
      return NextResponse.json({
        processing: toProcessingStateResponse(activeState),
        prepared_question: null,
        in_progress: true,
      });
    }

    const state = await prisma.aIProcessingState.upsert({
      where: { sessionId },
      create: {
        sessionId,
        participantCode: context.session.participantCode,
        processingStatus: "updating_slots",
        processingStartedAt: requestedAt,
      },
      update: {
        participantCode: context.session.participantCode,
        processingStatus: "updating_slots",
        processingStartedAt: requestedAt,
        lastError: null,
      },
    });

    console.info("[ai prepare-question start]", {
      sessionId,
      topicId: topic.id,
      utteranceCount: context.utterances.length,
      utterancesToClassifyCount: utterancesToClassify.length,
      startedAt: requestedAt.toISOString(),
    });

    await prisma.preparedQuestion.updateMany({
      where: {
        sessionId,
        status: "prepared",
        NOT: { topicId: topic.id },
      },
      data: {
        status: "expired",
        invalidatedAt: requestedAt,
        invalidationReason: "topic_changed",
      },
    });

    const bundle = await updateSlotStateBundleFromConversation({
      ...context,
      currentTopic,
      currentTopicTitle,
      utterancesToClassify,
    });
    if (
      utterancesToClassify.length > 0 &&
      bundle.debug.summary.llmSucceeded !== true
    ) {
      throw new Error("Failed to update slots from new utterances");
    }
    await saveSlotStates(sessionId, bundle.slotStates);
    await saveSubSlotStates(sessionId, bundle.subSlotStates);

    const latestProcessedUtterance = utterancesToClassify.at(-1);
    const nextRevision =
      state.slotRevision + (latestProcessedUtterance?.id ? 1 : 0);
    await prisma.aIProcessingState.update({
      where: { sessionId },
      data: {
        processingStatus: "generating_question",
        slotRevision: nextRevision,
        lastProcessedUtteranceId:
          latestProcessedUtterance?.id ?? state.lastProcessedUtteranceId,
        lastProcessedAt: latestProcessedUtterance?.id ? new Date() : state.lastProcessedAt,
      },
    });

    const refreshedContext = await getSessionContext(sessionId);
    const aiQuestionLogs = await loadQuestionHistory(sessionId, topic.id, topic.slot_name);
    const result = await generateNextQuestion({
      ...refreshedContext,
      currentTopic,
      currentTopicTitle,
      currentTopicQuestionCount: aiQuestionLogs.length,
      aiQuestionHistory: aiQuestionLogs,
      useDeterministicQuestionText: true,
    });

    await prisma.preparedQuestion.updateMany({
      where: {
        sessionId,
        topicId: topic.id,
        status: "prepared",
      },
      data: {
        status: "invalidated",
        invalidatedAt: new Date(),
        invalidationReason: "superseded",
      },
    });

    if (!result.question || result.no_relevant_followup) {
      const finished = await prisma.aIProcessingState.update({
        where: { sessionId },
        data: {
          processingStatus: "ready",
          processingFinishedAt: new Date(),
          lastError: null,
        },
      });

      return NextResponse.json({
        processing: toProcessingStateResponse(finished),
        prepared_question: null,
        no_relevant_followup: true,
        reason: result.reason,
      });
    }

    const prepared = await prisma.preparedQuestion.create({
      data: {
        sessionId,
        participantCode: refreshedContext.session.participantCode,
        topicId: topic.id,
        topicSlotName: topic.slot_name,
        question: result.question,
        transitionPhrase: result.transition_phrase,
        targetMainSlotId: result.targetMainSlotId ?? topic.id,
        targetSubSlotId: result.targetSubSlotId ?? "",
        questionPurpose: result.questionPurpose ?? "elicit_preference",
        reasonForSelection: result.reasonForSelection ?? result.reason,
        basedOnUtteranceId: latestProcessedUtterance?.id ?? latestUtterance?.id ?? null,
        slotRevision: nextRevision,
        status: "prepared",
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + PREPARED_QUESTION_TTL_MS),
      },
    });
    const finished = await prisma.aIProcessingState.update({
      where: { sessionId },
      data: {
        processingStatus: "ready",
        processingFinishedAt: new Date(),
        lastError: null,
      },
    });

    console.info("[ai prepare-question ready]", {
      sessionId,
      topicId: topic.id,
      preparedQuestionId: prepared.id,
      slotRevision: nextRevision,
      elapsedMs: Date.now() - requestedAt.getTime(),
    });

    return NextResponse.json({
      processing: toProcessingStateResponse(finished),
      prepared_question: toPreparedQuestionResponse(prepared),
      reused: false,
    });
  } catch (error) {
    console.error("[ai prepare-question failed]", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (sessionId) {
      await prisma.aIProcessingState.upsert({
        where: { sessionId },
        create: {
          sessionId,
          processingStatus: "failed",
          processingFinishedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
          retryCount: 1,
        },
        update: {
          processingStatus: "failed",
          processingFinishedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
          retryCount: { increment: 1 },
        },
      }).catch(() => undefined);
    }

    return NextResponse.json(
      { error: "Failed to prepare next question" },
      { status: 500 },
    );
  }
}

async function loadQuestionHistory(
  sessionId: string,
  topicId: string,
  topicSlotName: string,
) {
  const logs = await prisma.aIInterventionLog.findMany({
    where: {
      sessionId,
      type: "NEXT_QUESTION",
      OR: [
        { topicId },
        { topicId: topicSlotName },
        { metadata: { path: ["targetMainSlotId"], equals: topicId } },
      ],
    },
    orderBy: { generatedAt: "asc" },
    take: 50,
    select: {
      content: true,
      topicId: true,
      generatedAt: true,
      metadata: true,
    },
  });

  return logs.map((log) => {
    const metadata =
      log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
        ? (log.metadata as Record<string, unknown>)
        : {};

    return {
      content: log.content,
      topicId: log.topicId,
      generatedAt: log.generatedAt.toISOString(),
      targetMainSlotId:
        typeof metadata.targetMainSlotId === "string"
          ? metadata.targetMainSlotId
          : null,
      targetSubSlotId:
        typeof metadata.targetSubSlotId === "string"
          ? metadata.targetSubSlotId
          : null,
      questionPurpose:
        typeof metadata.questionPurpose === "string"
          ? metadata.questionPurpose
          : null,
    };
  });
}

function toPreparedQuestionResponse(question: {
  id: string;
  sessionId: string;
  topicId: string;
  topicSlotName: string | null;
  question: string;
  transitionPhrase: string;
  targetMainSlotId: string;
  targetSubSlotId: string;
  questionPurpose: string;
  reasonForSelection: string;
  basedOnUtteranceId: string | null;
  slotRevision: number;
  status: string;
  generatedAt: Date;
}) {
  return {
    id: question.id,
    session_id: question.sessionId,
    topic_id: question.topicId,
    topic_slot_name: question.topicSlotName,
    question: question.question,
    transition_phrase: question.transitionPhrase,
    targetMainSlotId: question.targetMainSlotId,
    targetSubSlotId: question.targetSubSlotId,
    questionPurpose: question.questionPurpose,
    reasonForSelection: question.reasonForSelection,
    basedOnUtteranceId: question.basedOnUtteranceId,
    slotRevision: question.slotRevision,
    status: question.status,
    generated_at: question.generatedAt.toISOString(),
  };
}

function toProcessingStateResponse(state: {
  processingStatus: string;
  lastProcessedUtteranceId: string | null;
  lastProcessedAt: Date | null;
  slotRevision: number;
  processingStartedAt: Date | null;
  processingFinishedAt: Date | null;
  lastError: string | null;
  retryCount: number;
}) {
  return {
    processingStatus: state.processingStatus,
    lastProcessedUtteranceId: state.lastProcessedUtteranceId,
    lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
    slotRevision: state.slotRevision,
    processingStartedAt: state.processingStartedAt?.toISOString() ?? null,
    processingFinishedAt: state.processingFinishedAt?.toISOString() ?? null,
    lastError: state.lastError,
    retryCount: state.retryCount,
  };
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

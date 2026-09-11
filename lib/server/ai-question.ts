import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { resolveDiscussionTopic, toJsonValue } from "../acp-mvp";
import { getDialogueOpenAIModel } from "../ai/client";
import { logAIIntervention } from "../ai/intervention-log";
import { prisma } from "../prisma";
import { generateQuestionAndUpdateSlotsForTopic } from "./slot-processing";

const AI_QUESTION_ACTION_TYPE = "AI_QUESTION_REQUEST";
const AI_QUESTION_PROCESSING_TIMEOUT_MS = 90_000;
const AI_QUESTION_HISTORY_LIMIT = 8;

type AiQuestionRequestStatus = "processing" | "completed" | "failed";

export async function generateAiQuestionForTopic(input: {
  requestId: string;
  sessionId: string;
  currentTopicId?: string | null;
  currentTopic?: string | null;
  currentTopicTitle?: string | null;
}) {
  const timingStartedAt = Date.now();
  const requestedAt = new Date();
  const topic = resolveDiscussionTopic(
    input.currentTopicId ?? input.currentTopic ?? undefined,
  );
  const model = getDialogueOpenAIModel();
  const requestState = await claimAiQuestionRequest({
    requestId: input.requestId,
    sessionId: input.sessionId,
    topicId: topic.id,
    topicTitle: input.currentTopicTitle ?? topic.title,
    requestedAt,
    model,
  });
  const claimMs = Date.now() - timingStartedAt;

  if (requestState.status === "completed" && requestState.result) {
    return {
      ...requestState.result,
      requestId: input.requestId,
      request_status: "completed",
      idempotent_replay: true,
    };
  }

  if (requestState.status === "processing") {
    return {
      requestId: input.requestId,
      request_status: "processing",
      in_progress: true,
      processing: null,
      topic_processing: null,
      suggestion: null,
      transition_proposal: null,
      no_relevant_followup: false,
      slot_update_outcome: "in_progress",
    };
  }

  if (requestState.status === "failed") {
    return {
      requestId: input.requestId,
      request_status: "failed",
      failed: true,
      error: requestState.error ?? "ai_question_request_failed",
      in_progress: false,
      processing: null,
      topic_processing: null,
      suggestion: null,
      transition_proposal: null,
      no_relevant_followup: false,
      slot_update_outcome: "in_progress",
    };
  }

  try {
    const historyStartedAt = Date.now();
    const aiQuestionHistory = await loadQuestionHistory(
      input.sessionId,
      topic.id,
      topic.slot_name,
    );
    const historyMs = Date.now() - historyStartedAt;
    const combinedStartedAt = Date.now();
    const slotUpdate = await generateQuestionAndUpdateSlotsForTopic({
      sessionId: input.sessionId,
      topicId: topic.id,
      currentTopic: input.currentTopic ?? topic.slot_name,
      currentTopicTitle: input.currentTopicTitle ?? topic.title,
      currentTopicQuestionCount: aiQuestionHistory.length,
      aiQuestionHistory,
    });
    const combinedMs = Date.now() - combinedStartedAt;

    if (slotUpdate.outcome === "in_progress") {
      const result = {
        requestId: input.requestId,
        request_status: "failed",
        failed: true,
        error: "slot_processing_in_progress",
        error_code: "processing_conflict",
        processing: slotUpdate.processingState,
        topic_processing: slotUpdate.topicProcessingState ?? slotUpdate.processingState,
        in_progress: false,
        slot_update_outcome: slotUpdate.outcome,
        slot_states: slotUpdate.slotStates,
        sub_slot_states: slotUpdate.subSlotStates,
        slot_control: slotUpdate.slotControl,
        slot_classification_debug: slotUpdate.slotClassificationDebug,
        suggestion: null,
        transition_proposal: null,
      };
      await failAiQuestionRequest({
        requestId: input.requestId,
        error: "slot_processing_in_progress",
        model,
      });
      logAiQuestionTiming({
        requestId: input.requestId,
        sessionId: input.sessionId,
        topicId: topic.id,
        claimMs,
        historyMs,
        combinedMs,
        totalMs: Date.now() - timingStartedAt,
        outcome: "slot_processing_in_progress",
        questionHistoryCount: aiQuestionHistory.length,
        processedUtteranceCount: slotUpdate.processedUtteranceIds.length,
      });
      return result;
    }

    const slotRevision =
      slotUpdate.topicProcessingState?.slotRevision ??
      slotUpdate.processingState.slotRevision;
    const generatedAt = new Date();
    const result = slotUpdate.nextQuestion;
    if (!result) {
      throw new Error("ai_question_combined_result_missing");
    }
    if (!result.question || result.no_relevant_followup) {
      const recommendationId = randomUUID();

      const response = {
        requestId: input.requestId,
        request_status: "completed",
        processing: slotUpdate.processingState,
        topic_processing: slotUpdate.topicProcessingState ?? slotUpdate.processingState,
        in_progress: false,
        no_relevant_followup: true,
        reason: result.reason,
        slot_update_outcome: slotUpdate.outcome,
        slot_states: slotUpdate.slotStates,
        sub_slot_states: slotUpdate.subSlotStates,
        slot_control: slotUpdate.slotControl,
        slot_classification_debug: slotUpdate.slotClassificationDebug,
        suggestion: {
          suggestion_type: "advance_topic",
          content: null,
          question: null,
          transition_phrase: "",
          target_slot: topic.slot_name,
          targetMainSlotId: topic.id,
          targetSubSlotId: null,
          questionPurpose: "advance_topic",
          reasonForSelection: result.reasonForSelection ?? result.reason,
          no_relevant_followup: true,
          reason: result.reason,
          sensitivity: result.sensitivity,
          slot_states_updated: slotUpdate.outcome === "updated",
          control_debug: slotUpdate.slotControl,
          slot_update_outcome: slotUpdate.outcome,
          created_at: generatedAt.toISOString(),
        },
        transition_proposal: {
          type: "advance_topic",
          action: "advance_topic",
          sessionId: input.sessionId,
          session_id: input.sessionId,
          topicId: topic.id,
          topic_id: topic.id,
          slotRevision,
          recommendationId,
          recommendation_id: recommendationId,
          reason: result.reason,
          generated_at: generatedAt.toISOString(),
        },
      };

      await completeAiQuestionRequest({
        requestId: input.requestId,
        response,
        model,
        nextAction: "advance_topic",
        processedUtteranceIds: slotUpdate.processedUtteranceIds,
      });

      logAiQuestionTiming({
        requestId: input.requestId,
        sessionId: input.sessionId,
        topicId: topic.id,
        claimMs,
        historyMs,
        combinedMs,
        totalMs: Date.now() - timingStartedAt,
        outcome: "advance_topic",
        questionHistoryCount: aiQuestionHistory.length,
        processedUtteranceCount: slotUpdate.processedUtteranceIds.length,
      });
      return response;
    }

    await logAIIntervention({
      sessionId: input.sessionId,
      participantCode: slotUpdate.participantCode ?? null,
      type: "NEXT_QUESTION",
      content: result.question,
      topicId: topic.id,
      requestedAt,
      generatedAt,
      metadata: {
        requestId: input.requestId,
        currentTopic: topic.slot_name,
        currentTopicTitle: input.currentTopicTitle ?? topic.title,
        targetSlot: result.target_slot,
        targetMainSlotId: result.targetMainSlotId,
        targetSubSlotId: result.targetSubSlotId,
        questionPurpose: result.questionPurpose,
        reasonForSelection: result.reasonForSelection,
        noRelevantFollowup: result.no_relevant_followup === true,
        sensitivity: result.sensitivity,
        slotUpdateOutcome: slotUpdate.outcome,
        slotRevision,
        nextActionDebug: slotUpdate.nextActionDebug,
      },
    });

    const response = {
      requestId: input.requestId,
      request_status: "completed",
      processing: slotUpdate.processingState,
      topic_processing: slotUpdate.topicProcessingState ?? slotUpdate.processingState,
      in_progress: false,
      no_relevant_followup: false,
      reason: result.reason,
      slot_update_outcome: slotUpdate.outcome,
      slot_states: slotUpdate.slotStates,
      sub_slot_states: slotUpdate.subSlotStates,
      slot_control: slotUpdate.slotControl,
      slot_classification_debug: slotUpdate.slotClassificationDebug,
      suggestion: {
        suggestion_type: "next_question",
        content: result.question,
        question: result.question,
        transition_phrase: result.transition_phrase,
        target_slot: result.target_slot,
        targetMainSlotId: result.targetMainSlotId,
        targetSubSlotId: result.targetSubSlotId,
        questionPurpose: result.questionPurpose,
        reasonForSelection: result.reasonForSelection,
        no_relevant_followup: false,
        reason: result.reason,
        sensitivity: result.sensitivity,
        slot_states_updated: slotUpdate.outcome === "updated",
        control_debug: slotUpdate.slotControl,
        slot_update_outcome: slotUpdate.outcome,
        created_at: generatedAt.toISOString(),
      },
      transition_proposal: null,
    };

    await completeAiQuestionRequest({
      requestId: input.requestId,
      response,
      model,
      nextAction: "ask_question",
      processedUtteranceIds: slotUpdate.processedUtteranceIds,
    });

    logAiQuestionTiming({
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: topic.id,
      claimMs,
      historyMs,
      combinedMs,
      totalMs: Date.now() - timingStartedAt,
      outcome: "ask_question",
      questionHistoryCount: aiQuestionHistory.length,
      processedUtteranceCount: slotUpdate.processedUtteranceIds.length,
    });
    return response;
  } catch (error) {
    await failAiQuestionRequest({
      requestId: input.requestId,
      error,
      model,
    });
    console.warn("[ai question timing]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: topic.id,
      claimMs,
      totalMs: Date.now() - timingStartedAt,
      outcome: "failed",
      error: getErrorLogDetails(error),
    });
    throw error;
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
    orderBy: { generatedAt: "desc" },
    take: AI_QUESTION_HISTORY_LIMIT,
    select: {
      content: true,
      topicId: true,
      generatedAt: true,
      metadata: true,
    },
  });

  return logs.reverse().map((log) => {
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

async function claimAiQuestionRequest(input: {
  requestId: string;
  sessionId: string;
  topicId: string;
  topicTitle: string;
  requestedAt: Date;
  model: string;
}): Promise<{
  status: AiQuestionRequestStatus | "claimed";
  result?: Record<string, unknown> | null;
  error?: string | null;
}> {
  const existing = await prisma.aIActionEvent.findUnique({
    where: { id: input.requestId },
    select: {
      sessionId: true,
      currentTopicId: true,
      result: true,
      metadata: true,
      createdAt: true,
    },
  });

  if (existing) {
    return interpretExistingAiQuestionRequest(input, existing);
  }

  const staleBefore = new Date(
    input.requestedAt.getTime() - AI_QUESTION_PROCESSING_TIMEOUT_MS,
  );
  const lockKey = `ai-question:${input.sessionId}:${input.topicId}`;

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existingAfterLock = await tx.aIActionEvent.findUnique({
        where: { id: input.requestId },
        select: {
          sessionId: true,
          currentTopicId: true,
          result: true,
          metadata: true,
          createdAt: true,
        },
      });
      if (existingAfterLock) {
        return interpretExistingAiQuestionRequest(input, existingAfterLock);
      }

      const activeSameTopicRequest = await tx.aIActionEvent.findFirst({
        where: {
          sessionId: input.sessionId,
          currentTopicId: input.topicId,
          actionType: AI_QUESTION_ACTION_TYPE,
          result: "processing",
          createdAt: { gte: staleBefore },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (activeSameTopicRequest) {
        console.info("[ai question request joined active processing]", {
          requestId: input.requestId,
          activeRequestId: activeSameTopicRequest.id,
          sessionId: input.sessionId,
          topicId: input.topicId,
          activeCreatedAt: activeSameTopicRequest.createdAt.toISOString(),
        });
        return {
          status: "processing" as const,
          error: "duplicate_ai_question_request_in_progress",
        };
      }

      const slotState = await tx.slotProcessingState.findUnique({
        where: {
          sessionId_topicId: {
            sessionId: input.sessionId,
            topicId: input.topicId,
          },
        },
        select: {
          slotRevision: true,
          lastProcessedUtteranceId: true,
        },
      });

      await tx.aIActionEvent.create({
        data: {
          id: input.requestId,
          sessionId: input.sessionId,
          actionType: AI_QUESTION_ACTION_TYPE,
          currentTopicId: input.topicId,
          currentTopicTitle: input.topicTitle,
          result: "processing",
          model: input.model,
          metadata: toPrismaJson({
            requestId: input.requestId,
            status: "processing",
            topicId: input.topicId,
            requestedAt: input.requestedAt.toISOString(),
            processingStartedAt: input.requestedAt.toISOString(),
            slotRevisionAtRequest: slotState?.slotRevision ?? 0,
            lastProcessedUtteranceIdAtRequest:
              slotState?.lastProcessedUtteranceId ?? null,
            model: input.model,
          }),
        },
      });

      console.info("[ai question request claimed]", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        topicId: input.topicId,
        model: input.model,
        slotRevisionAtRequest: slotState?.slotRevision ?? 0,
      });

      return { status: "claimed" as const };
    });

    return transactionResult;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const createdByOtherRequest = await prisma.aIActionEvent.findUnique({
      where: { id: input.requestId },
      select: {
        sessionId: true,
        currentTopicId: true,
        result: true,
        metadata: true,
        createdAt: true,
      },
    });
    if (!createdByOtherRequest) throw error;
    return interpretExistingAiQuestionRequest(input, createdByOtherRequest);
  }
}

function interpretExistingAiQuestionRequest(
  input: {
    requestId: string;
    sessionId: string;
    topicId: string;
  },
  existing: {
    sessionId: string;
    currentTopicId: string | null;
    result: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  },
): {
  status: AiQuestionRequestStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
} {
  if (existing.sessionId !== input.sessionId || existing.currentTopicId !== input.topicId) {
    throw new Error("ai_question_request_id_reused_for_different_scope");
  }

  const metadata = asRecord(existing.metadata) ?? {};
  const status = normalizeAiQuestionStatus(metadata.status, existing.result);
  const result = asRecord(metadata.result);

  if (status === "completed" && result) {
    console.info("[ai question request replay completed]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: input.topicId,
    });
    return { status: "completed", result };
  }

  if (status === "failed") {
    console.warn("[ai question request replay failed]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: input.topicId,
      error: typeof metadata.error === "string" ? metadata.error : null,
    });
    return {
      status: "failed",
      error: typeof metadata.error === "string" ? metadata.error : null,
    };
  }

  const staleBefore = Date.now() - AI_QUESTION_PROCESSING_TIMEOUT_MS;
  if (existing.createdAt.getTime() < staleBefore) {
    console.warn("[ai question request replay stale processing]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: input.topicId,
      createdAt: existing.createdAt.toISOString(),
    });
  }

  return { status: "processing" };
}

async function completeAiQuestionRequest(input: {
  requestId: string;
  response: Record<string, unknown>;
  model: string;
  nextAction: "ask_question" | "advance_topic";
  processedUtteranceIds: string[];
}) {
  const completedAt = new Date();
  await prisma.aIActionEvent.update({
    where: { id: input.requestId },
    data: {
      result: "completed",
      model: input.model,
      generatedText:
        input.nextAction === "ask_question"
          ? asRecord(input.response.suggestion)?.question?.toString() ?? null
          : null,
      metadata: toPrismaJson({
        requestId: input.requestId,
        status: "completed",
        completedAt: completedAt.toISOString(),
        model: input.model,
        nextAction: input.nextAction,
        processedUtteranceIds: input.processedUtteranceIds,
        result: input.response,
      }),
    },
  });

  console.info("[ai question request completed]", {
    requestId: input.requestId,
    nextAction: input.nextAction,
    processedUtteranceCount: input.processedUtteranceIds.length,
    completedAt: completedAt.toISOString(),
  });
}

async function failAiQuestionRequest(input: {
  requestId: string;
  error: unknown;
  model: string;
}) {
  const failedAt = new Date();
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await prisma.aIActionEvent
    .update({
      where: { id: input.requestId },
      data: {
        result: "failed",
        model: input.model,
        metadata: toPrismaJson({
          requestId: input.requestId,
          status: "failed",
          failedAt: failedAt.toISOString(),
          model: input.model,
          error: message,
        }),
      },
    })
    .catch((updateError) => {
      console.warn("[ai question request failed-state save failed]", {
        requestId: input.requestId,
        error:
          updateError instanceof Error ? updateError.message : String(updateError),
      });
    });
}

function normalizeAiQuestionStatus(
  metadataStatus: unknown,
  result: string | null,
): AiQuestionRequestStatus {
  if (metadataStatus === "completed" || result === "completed") return "completed";
  if (metadataStatus === "failed" || result === "failed") return "failed";
  return "processing";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toPrismaJson(value: Record<string, unknown>) {
  return toJsonValue(value) as Prisma.InputJsonValue;
}

function logAiQuestionTiming(input: {
  requestId: string;
  sessionId: string;
  topicId: string;
  claimMs: number;
  historyMs: number;
  combinedMs: number;
  totalMs: number;
  outcome: string;
  questionHistoryCount: number;
  processedUtteranceCount: number;
}) {
  console.info("[ai question timing]", {
    requestId: input.requestId,
    sessionId: input.sessionId,
    topicId: input.topicId,
    claimMs: input.claimMs,
    questionHistoryLoadMs: input.historyMs,
    combinedSlotAndQuestionMs: input.combinedMs,
    totalMs: input.totalMs,
    outcome: input.outcome,
    questionHistoryCount: input.questionHistoryCount,
    processedUtteranceCount: input.processedUtteranceCount,
  });
}

function getErrorLogDetails(error: unknown) {
  return {
    name: error instanceof Error ? error.name : null,
    code:
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

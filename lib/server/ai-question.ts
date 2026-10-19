import { QUESTION_POLICY_VERSION, QuestionGenerationError } from "../ai/question-policy";
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
  logAiQuestionServerStage("request_claim_result", {
    requestId: input.requestId,
    sessionId: input.sessionId,
    topicId: topic.id,
    lockResult: requestState.status,
    claimMs,
  });

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
    logAiQuestionServerStage("history_loaded", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: topic.id,
      questionHistoryCount: aiQuestionHistory.length,
      historyMs,
    });
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
    logAiQuestionServerStage("combined_processing_result", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: topic.id,
      outcome: slotUpdate.outcome,
      combinedMs,
      processedUtteranceCount: slotUpdate.processedUtteranceIds.length,
      nextAction: slotUpdate.nextQuestion?.policy?.decision ?? null,
      selectedSubSlotId: slotUpdate.nextQuestion?.targetSubSlotId ?? null,
    });

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
    if (result.policy?.decision === "opening_question") {
      const response = {
        requestId: input.requestId, request_status: "completed", in_progress: false,
        no_relevant_followup: false, decision_reason: "no_topic_utterances",
        question_policy: result.policy,
        opening_question: { introduction: topic.introduction, question: topic.openingQuestion },
        suggestion: null, transition_proposal: null,
        processing: slotUpdate.processingState,
        topic_processing: slotUpdate.topicProcessingState ?? slotUpdate.processingState,
        slot_update_outcome: "no_utterances", slot_states: slotUpdate.slotStates,
        sub_slot_states: slotUpdate.subSlotStates, slot_control: slotUpdate.slotControl,
        slot_classification_debug: slotUpdate.slotClassificationDebug,
      };
      await completeAiQuestionRequest({ requestId: input.requestId, response, model,
        nextAction: "opening_question", processedUtteranceIds: slotUpdate.processedUtteranceIds });
      return response;
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
        question_policy: result.policy,
        decision_reason: result.policy?.decision_reason,
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

    const presentedQuestionText = joinQuestionPrompt(
      result.transition_phrase,
      result.question,
    );

    await logAIIntervention({
      sessionId: input.sessionId,
      participantCode: slotUpdate.participantCode ?? null,
      type: "NEXT_QUESTION",
      content: presentedQuestionText,
      topicId: topic.id,
      requestedAt,
      generatedAt,
      metadata: {
        requestId: input.requestId,
        currentTopic: topic.slot_name,
        currentTopicTitle: input.currentTopicTitle ?? topic.title,
        transitionPhrase: result.transition_phrase,
        question: result.question,
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
        questionPolicy: result.policy,
      },
    });

    const response = {
      requestId: input.requestId,
      request_status: "completed",
      processing: slotUpdate.processingState,
      topic_processing: slotUpdate.topicProcessingState ?? slotUpdate.processingState,
      in_progress: false,
      no_relevant_followup: false,
      question_policy: result.policy,
      decision_reason: result.policy?.decision_reason,
      reason: result.reason,
      slot_update_outcome: slotUpdate.outcome,
      slot_states: slotUpdate.slotStates,
      sub_slot_states: slotUpdate.subSlotStates,
      slot_control: slotUpdate.slotControl,
      slot_classification_debug: slotUpdate.slotClassificationDebug,
      suggestion: {
        suggestion_type: "next_question",
        content: presentedQuestionText,
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
    logAiQuestionServerStage("failed", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      topicId: topic.id,
      error: getErrorLogDetails(error),
      stack: error instanceof Error ? error.stack : null,
    });
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
      content: typeof metadata.question === "string" ? metadata.question : log.content,
      topicId: log.topicId,
      generatedAt: log.generatedAt.toISOString(),
      questionType: asRecord(metadata.questionPolicy)?.question_type as "experience" | "values" | "perspective" | null,
      evidenceUtteranceIds: Array.isArray(asRecord(metadata.questionPolicy)?.evidence_utterance_ids)
        ? (asRecord(metadata.questionPolicy)!.evidence_utterance_ids as string[]) : [],
      supportKey: typeof asRecord(metadata.questionPolicy)?.support_key === "string"
        ? asRecord(metadata.questionPolicy)!.support_key as string : null,
      supportForUtteranceId: typeof asRecord(metadata.questionPolicy)?.support_for_utterance_id === "string"
        ? asRecord(metadata.questionPolicy)!.support_for_utterance_id as string : null,
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
        logAiQuestionServerStage("request_lock_busy", {
          requestId: input.requestId,
          activeRequestId: activeSameTopicRequest.id,
          sessionId: input.sessionId,
          topicId: input.topicId,
          lockResult: "processing",
          activeCreatedAt: activeSameTopicRequest.createdAt.toISOString(),
        });
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
          policyVersion: QUESTION_POLICY_VERSION,
          metadata: toPrismaJson({
            requestId: input.requestId,
            status: "processing",
            topicId: input.topicId,
            policy_version: QUESTION_POLICY_VERSION,
            requestedAt: input.requestedAt.toISOString(),
            processingStartedAt: input.requestedAt.toISOString(),
            slotRevisionAtRequest: slotState?.slotRevision ?? 0,
            lastProcessedUtteranceIdAtRequest:
              slotState?.lastProcessedUtteranceId ?? null,
            model: input.model,
          }),
        },
      });
      logAiQuestionServerStage("request_lock_claimed", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        topicId: input.topicId,
        lockResult: "claimed",
        dbOperation: "aIActionEvent.create",
        dbSuccess: true,
        slotRevisionAtRequest: slotState?.slotRevision ?? 0,
        lastProcessedUtteranceIdAtRequest:
          slotState?.lastProcessedUtteranceId ?? null,
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
  nextAction: "ask_question" | "advance_topic" | "opening_question";
  processedUtteranceIds: string[];
}) {
  const completedAt = new Date();
  const existing = await prisma.aIActionEvent.findUnique({ where: { id: input.requestId }, select: { metadata: true } });
  const policy = asRecord(input.response.question_policy);
  try {
    await prisma.aIActionEvent.update({
      where: { id: input.requestId },
      data: {
        result: "completed",
        model: input.model,
        policyVersion: QUESTION_POLICY_VERSION,
        targetMainSlotId: asRecord(policy?.selected_slot_id)?.topic_id?.toString() ?? null,
        targetSubSlotId: asRecord(policy?.selected_slot_id)?.slot_id?.toString() ?? null,
        reason: typeof policy?.decision_reason === "string" ? policy.decision_reason : null,
        generatedText:
          input.nextAction === "ask_question"
            ? asRecord(input.response.suggestion)?.content?.toString() ?? null
            : null,
        metadata: toPrismaJson({
          ...asRecord(existing?.metadata),
          ...policy,
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
    logAiQuestionServerStage("request_completion_saved", {
      requestId: input.requestId,
      dbOperation: "aIActionEvent.update",
      dbSuccess: true,
      nextAction: input.nextAction,
      processedUtteranceCount: input.processedUtteranceIds.length,
    });
  } catch (error) {
    logAiQuestionServerStage("request_completion_save_failed", {
      requestId: input.requestId,
      dbOperation: "aIActionEvent.update",
      dbSuccess: false,
      error: getErrorLogDetails(error),
      stack: error instanceof Error ? error.stack : null,
    });
    throw error;
  }

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
  const existing = await prisma.aIActionEvent.findUnique({ where: { id: input.requestId }, select: { metadata: true } });
  const policy = input.error instanceof QuestionGenerationError ? input.error.policy : null;
  await prisma.aIActionEvent
    .update({
      where: { id: input.requestId },
      data: {
        result: "failed",
        model: input.model,
        policyVersion: QUESTION_POLICY_VERSION,
        reason: "technical_error",
        metadata: toPrismaJson({
          ...asRecord(existing?.metadata),
          ...policy,
          decision: "error", decision_reason: "technical_error",
          policy_version: QUESTION_POLICY_VERSION,
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

function joinQuestionPrompt(transitionPhrase: string, question: string | null) {
  const normalizedQuestion = question?.trim() ?? "";
  if (!normalizedQuestion) return "";
  const normalizedTransition = transitionPhrase.trim();
  if (!normalizedTransition) return normalizedQuestion;

  return `${normalizedTransition}\n\n${normalizedQuestion}`;
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

function logAiQuestionServerStage(stage: string, details: Record<string, unknown>) {
  console.info(
    `[ai question server stage] ${JSON.stringify({
      ...details,
      stage,
      occurredAt: new Date().toISOString(),
    })}`,
  );
}

function isUniqueConstraintError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

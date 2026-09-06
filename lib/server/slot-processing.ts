import {
  buildSlotControlDebugState,
  DISCUSSION_TOPICS,
  resolveDiscussionTopic,
} from "../acp-mvp";
import {
  getChangedSlotStates,
  getChangedSubSlotStates,
  getSessionContext,
  getUnprocessedSlotUtterances,
  saveSlotStates,
  saveSubSlotStates,
} from "../acp-store";
import {
  updateSlotStateBundleFromConversation,
  updateSlotsAndGenerateNextQuestionAction,
} from "../ai/slot-state";
import { prisma } from "../prisma";

const SLOT_PROCESSING_TIMEOUT_MS = 60_000;
const SLOT_PROCESSING_POLL_MS = 250;

export type SlotUpdateOutcome =
  | "updated"
  | "already_current"
  | "no_utterances"
  | "in_progress";

export async function updateSlotsForAllTopics(input: {
  sessionId: string;
}) {
  const results = [];

  for (const topic of DISCUSSION_TOPICS) {
    const result = await updateSlotsForTopic({
      sessionId: input.sessionId,
      topicId: topic.id,
      currentTopic: topic.slot_name,
      currentTopicTitle: topic.title,
    });

    if (result.outcome === "in_progress") {
      throw new Error(`slot_processing_in_progress:${topic.id}`);
    }

    results.push({
      topicId: topic.id,
      topicSlotName: topic.slot_name,
      outcome: result.outcome,
      processedThroughUtteranceId: result.processedThroughUtteranceId,
      processedUtteranceIds: result.processedUtteranceIds,
      processingState: result.topicProcessingState ?? result.processingState,
    });
  }

  return {
    results,
    updated: results.filter((result) => result.outcome === "updated"),
    skipped: results.filter((result) => result.outcome !== "updated"),
  };
}

export async function updateSlotsForTopic(input: {
  sessionId: string;
  topicId?: string | null;
  currentTopic?: string | null;
  currentTopicTitle?: string | null;
}) {
  const requestedAt = new Date();
  const topic = resolveDiscussionTopic(input.topicId ?? input.currentTopic ?? undefined);
  const context = await getSessionContext(input.sessionId);
  const topicUtterances = getTopicUtterances(context.utterances, topic.id);
  const existingState = await prisma.slotProcessingState.upsert({
    where: {
      sessionId_topicId: {
        sessionId: input.sessionId,
        topicId: topic.id,
      },
    },
    create: {
      sessionId: input.sessionId,
      participantCode: context.session.participantCode,
      topicId: topic.id,
      processingStatus: "idle",
    },
    update: {
      participantCode: context.session.participantCode,
    },
  });
  const utterancesToClassify = getUnprocessedSlotUtterances(
    topicUtterances,
    existingState.lastProcessedUtteranceId,
  );

  if (utterancesToClassify.length === 0) {
    const slotControl = buildSlotControlDebugState({
      slots: context.slotStates,
      currentTopic: topic.slot_name,
      subSlotStates: context.subSlotStates,
    });

    return {
      outcome: topicUtterances.length === 0 ? "no_utterances" : "already_current",
      slotStates: context.slotStates,
      subSlotStates: context.subSlotStates,
      slotControl,
      slotClassificationDebug: null,
      processingState: toProcessingStateResponse(existingState),
      processedThroughUtteranceId: existingState.lastProcessedUtteranceId,
      processedUtteranceIds: [] as string[],
    };
  }

  const rangeEndUtterance = utterancesToClassify.at(-1);
  if (!rangeEndUtterance?.id) {
    throw new Error("slot_processing_range_end_missing");
  }

  const claimed = await claimSlotProcessingRange({
    sessionId: input.sessionId,
    participantCode: context.session.participantCode,
    topicId: topic.id,
    rangeStartAt: parseOptionalDate(utterancesToClassify[0]?.created_at),
    rangeEndUtteranceId: rangeEndUtterance.id,
    requestedAt,
  });

  if (!claimed) {
    const completedState = await waitForSlotProcessingRange({
      sessionId: input.sessionId,
      topicId: topic.id,
      rangeEndUtteranceId: rangeEndUtterance.id,
    });
    const refreshedContext = await getSessionContext(input.sessionId);
    const slotControl = buildSlotControlDebugState({
      slots: refreshedContext.slotStates,
      currentTopic: topic.slot_name,
      subSlotStates: refreshedContext.subSlotStates,
    });

    return {
      outcome: completedState ? "already_current" : "in_progress",
      slotStates: refreshedContext.slotStates,
      subSlotStates: refreshedContext.subSlotStates,
      slotControl,
      slotClassificationDebug: null,
      processingState: completedState
        ? toProcessingStateResponse(completedState)
        : toProcessingStateResponse(existingState),
      processedThroughUtteranceId:
        completedState?.lastProcessedUtteranceId ?? existingState.lastProcessedUtteranceId,
      processedUtteranceIds: [] as string[],
    };
  }

  try {
    console.info("[ai slot-processing start]", {
      sessionId: input.sessionId,
      topicId: topic.id,
      utterancesToClassifyCount: utterancesToClassify.length,
      rangeEndUtteranceId: rangeEndUtterance.id,
      startedAt: requestedAt.toISOString(),
    });

    const bundle = await updateSlotStateBundleFromConversation({
      ...context,
      currentTopic: topic.slot_name,
      currentTopicTitle: input.currentTopicTitle ?? topic.title,
      utterancesToClassify,
    });

    if (
      utterancesToClassify.length > 0 &&
      bundle.debug.summary.llmSucceeded !== true
    ) {
      throw new Error("slot_classification_failed");
    }

    const latestProcessedUtterance = utterancesToClassify.at(-1);
    const processedThroughUtteranceId = latestProcessedUtterance?.id ?? null;
    const changedSlotStates = getChangedSlotStates(
      context.slotStates,
      bundle.slotStates,
    );
    const changedSubSlotStates = getChangedSubSlotStates(
      context.subSlotStates,
      bundle.subSlotStates,
    );

    const transactionResult = await prisma.$transaction(async (tx) => {
      if (changedSlotStates.length > 0) {
        await saveSlotStates(input.sessionId, changedSlotStates, tx);
      }
      if (changedSubSlotStates.length > 0) {
        await saveSubSlotStates(input.sessionId, changedSubSlotStates, tx);
      }

      const slotProcessingState = await tx.slotProcessingState.update({
        where: {
          sessionId_topicId: {
            sessionId: input.sessionId,
            topicId: topic.id,
          },
        },
        data: {
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: processedThroughUtteranceId,
          lastProcessedAt: new Date(),
          processingRangeEndUtteranceId: processedThroughUtteranceId,
          slotRevision: { increment: processedThroughUtteranceId ? 1 : 0 },
          processingStatus: "ready",
          processingFinishedAt: new Date(),
          lastError: null,
        },
      });

      const aiProcessingState = await tx.aIProcessingState.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: processedThroughUtteranceId,
          lastProcessedAt: new Date(),
          slotRevision: 1,
          processingStatus: "ready",
          processingFinishedAt: new Date(),
        },
        update: {
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: processedThroughUtteranceId,
          lastProcessedAt: new Date(),
          slotRevision: { increment: processedThroughUtteranceId ? 1 : 0 },
          processingStatus: "ready",
          processingFinishedAt: new Date(),
          lastError: null,
        },
      });

      return { slotProcessingState, aiProcessingState };
    });

    const slotControl = buildSlotControlDebugState({
      slots: bundle.slotStates,
      currentTopic: topic.slot_name,
      subSlotStates: bundle.subSlotStates,
      classificationDebug: bundle.debug.summary,
    });

    console.info("[ai slot-processing saved]", {
      sessionId: input.sessionId,
      topicId: topic.id,
      outcome: "updated",
      processedThroughUtteranceId,
      processedUtteranceCount: utterancesToClassify.length,
      slotWrites: changedSlotStates.length,
      subSlotWrites: changedSubSlotStates.length,
      slotRevision: transactionResult.slotProcessingState.slotRevision,
    });

    return {
      outcome: "updated" as SlotUpdateOutcome,
      slotStates: bundle.slotStates,
      subSlotStates: bundle.subSlotStates,
      slotControl,
      slotClassificationDebug: bundle.debug,
      processingState: toProcessingStateResponse(transactionResult.aiProcessingState),
      topicProcessingState: toProcessingStateResponse(
        transactionResult.slotProcessingState,
      ),
      processedThroughUtteranceId,
      processedUtteranceIds: utterancesToClassify
        .map((utterance) => utterance.id)
        .filter(Boolean) as string[],
    };
  } catch (error) {
    await Promise.all([
      prisma.slotProcessingState.update({
        where: {
          sessionId_topicId: {
            sessionId: input.sessionId,
            topicId: topic.id,
          },
        },
        data: {
          processingStatus: "failed",
          processingFinishedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
          retryCount: { increment: 1 },
        },
      }),
      prisma.aIProcessingState.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          participantCode: context.session.participantCode,
          processingStatus: "failed",
          processingStartedAt: requestedAt,
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
      }),
    ]);

    throw error;
  }
}

export async function generateQuestionAndUpdateSlotsForTopic(input: {
  sessionId: string;
  topicId?: string | null;
  currentTopic?: string | null;
  currentTopicTitle?: string | null;
  aiQuestionHistory?: Array<{
    content: string;
    topicId?: string | null;
    generatedAt?: string | null;
    targetMainSlotId?: string | null;
    targetSubSlotId?: string | null;
    questionPurpose?: string | null;
  }>;
  currentTopicQuestionCount?: number;
}) {
  const requestedAt = new Date();
  const topic = resolveDiscussionTopic(input.topicId ?? input.currentTopic ?? undefined);
  const context = await getSessionContext(input.sessionId);
  const topicUtterances = getTopicUtterances(context.utterances, topic.id);
  const existingState = await prisma.slotProcessingState.upsert({
    where: {
      sessionId_topicId: {
        sessionId: input.sessionId,
        topicId: topic.id,
      },
    },
    create: {
      sessionId: input.sessionId,
      participantCode: context.session.participantCode,
      topicId: topic.id,
      processingStatus: "idle",
    },
    update: {
      participantCode: context.session.participantCode,
    },
  });
  const utterancesToClassify = getUnprocessedSlotUtterances(
    topicUtterances,
    existingState.lastProcessedUtteranceId,
  );
  const rangeEndUtterance = utterancesToClassify.at(-1) ?? null;

  if (rangeEndUtterance?.id) {
    const claimed = await claimSlotProcessingRange({
      sessionId: input.sessionId,
      participantCode: context.session.participantCode,
      topicId: topic.id,
      rangeStartAt: parseOptionalDate(utterancesToClassify[0]?.created_at),
      rangeEndUtteranceId: rangeEndUtterance.id,
      requestedAt,
    });

    if (!claimed) {
      const completedState = await waitForSlotProcessingRange({
        sessionId: input.sessionId,
        topicId: topic.id,
        rangeEndUtteranceId: rangeEndUtterance.id,
      });
      const refreshedContext = await getSessionContext(input.sessionId);
      const slotControl = buildSlotControlDebugState({
        slots: refreshedContext.slotStates,
        currentTopic: topic.slot_name,
        subSlotStates: refreshedContext.subSlotStates,
      });

      return {
        outcome: completedState ? "already_current" : "in_progress",
        slotStates: refreshedContext.slotStates,
        subSlotStates: refreshedContext.subSlotStates,
        slotControl,
        slotClassificationDebug: null,
        processingState: completedState
          ? toProcessingStateResponse(completedState)
          : toProcessingStateResponse(existingState),
        topicProcessingState: completedState
          ? toProcessingStateResponse(completedState)
          : toProcessingStateResponse(existingState),
        processedThroughUtteranceId:
          completedState?.lastProcessedUtteranceId ?? existingState.lastProcessedUtteranceId,
        processedUtteranceIds: [] as string[],
        nextQuestion: null,
        nextActionDebug: null,
      };
    }
  }

  try {
    console.info("[ai question combined-processing start]", {
      sessionId: input.sessionId,
      topicId: topic.id,
      utterancesToClassifyCount: utterancesToClassify.length,
      rangeEndUtteranceId: rangeEndUtterance?.id ?? null,
      llmCallCount: 1,
      startedAt: requestedAt.toISOString(),
    });

    const bundle = await updateSlotsAndGenerateNextQuestionAction({
      ...context,
      currentTopic: topic.slot_name,
      currentTopicTitle: input.currentTopicTitle ?? topic.title,
      utterancesToClassify,
      aiQuestionHistory: input.aiQuestionHistory,
      currentTopicQuestionCount: input.currentTopicQuestionCount,
    });

    if (bundle.debug.summary.llmSucceeded !== true) {
      throw new Error("ai_question_combined_llm_failed");
    }

    const processedThroughUtteranceId = rangeEndUtterance?.id ?? null;
    const changedSlotStates = getChangedSlotStates(
      context.slotStates,
      bundle.slotStates,
    );
    const changedSubSlotStates = getChangedSubSlotStates(
      context.subSlotStates,
      bundle.subSlotStates,
    );

    const transactionResult = await prisma.$transaction(async (tx) => {
      if (changedSlotStates.length > 0) {
        await saveSlotStates(input.sessionId, changedSlotStates, tx);
      }
      if (changedSubSlotStates.length > 0) {
        await saveSubSlotStates(input.sessionId, changedSubSlotStates, tx);
      }

      const slotProcessingState = processedThroughUtteranceId
        ? await tx.slotProcessingState.update({
            where: {
              sessionId_topicId: {
                sessionId: input.sessionId,
                topicId: topic.id,
              },
            },
            data: {
              participantCode: context.session.participantCode,
              lastProcessedUtteranceId: processedThroughUtteranceId,
              lastProcessedAt: new Date(),
              processingRangeEndUtteranceId: processedThroughUtteranceId,
              slotRevision: { increment: 1 },
              processingStatus: "ready",
              processingFinishedAt: new Date(),
              lastError: null,
            },
          })
        : await tx.slotProcessingState.update({
            where: {
              sessionId_topicId: {
                sessionId: input.sessionId,
                topicId: topic.id,
              },
            },
            data: {
              participantCode: context.session.participantCode,
              processingStatus: "ready",
              processingFinishedAt: new Date(),
              lastError: null,
            },
          });

      const aiProcessingState = await tx.aIProcessingState.upsert({
        where: { sessionId: input.sessionId },
        create: {
          sessionId: input.sessionId,
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: processedThroughUtteranceId,
          lastProcessedAt: processedThroughUtteranceId ? new Date() : null,
          slotRevision: processedThroughUtteranceId ? 1 : 0,
          processingStatus: "ready",
          processingFinishedAt: new Date(),
        },
        update: {
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId:
            processedThroughUtteranceId ?? existingState.lastProcessedUtteranceId,
          lastProcessedAt: processedThroughUtteranceId ? new Date() : undefined,
          slotRevision: processedThroughUtteranceId ? { increment: 1 } : undefined,
          processingStatus: "ready",
          processingFinishedAt: new Date(),
          lastError: null,
        },
      });

      return { slotProcessingState, aiProcessingState };
    });

    const slotControl = buildSlotControlDebugState({
      slots: bundle.slotStates,
      currentTopic: topic.slot_name,
      subSlotStates: bundle.subSlotStates,
      classificationDebug: bundle.debug.summary,
    });

    console.info("[ai question combined-processing saved]", {
      sessionId: input.sessionId,
      topicId: topic.id,
      outcome: processedThroughUtteranceId ? "updated" : "already_current",
      processedThroughUtteranceId,
      processedUtteranceCount: utterancesToClassify.length,
      slotWrites: changedSlotStates.length,
      subSlotWrites: changedSubSlotStates.length,
      slotRevision: transactionResult.slotProcessingState.slotRevision,
      nextActionType: bundle.nextActionDebug.acceptedActionType,
      llmCallCount: 1,
    });

    return {
      outcome: processedThroughUtteranceId
        ? "updated"
        : ("already_current" as SlotUpdateOutcome),
      slotStates: bundle.slotStates,
      subSlotStates: bundle.subSlotStates,
      slotControl,
      slotClassificationDebug: bundle.debug,
      processingState: toProcessingStateResponse(transactionResult.aiProcessingState),
      topicProcessingState: toProcessingStateResponse(
        transactionResult.slotProcessingState,
      ),
      processedThroughUtteranceId,
      processedUtteranceIds: utterancesToClassify
        .map((utterance) => utterance.id)
        .filter(Boolean) as string[],
      nextQuestion: bundle.nextQuestion,
      nextActionDebug: bundle.nextActionDebug,
    };
  } catch (error) {
    if (rangeEndUtterance?.id) {
      await prisma.slotProcessingState.update({
        where: {
          sessionId_topicId: {
            sessionId: input.sessionId,
            topicId: topic.id,
          },
        },
        data: {
          processingStatus: "failed",
          processingFinishedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
          retryCount: { increment: 1 },
        },
      });
    }
    await prisma.aIProcessingState.upsert({
      where: { sessionId: input.sessionId },
      create: {
        sessionId: input.sessionId,
        participantCode: context.session.participantCode,
        processingStatus: "failed",
        processingStartedAt: requestedAt,
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
    });

    throw error;
  }
}

function getTopicUtterances(
  utterances: Awaited<ReturnType<typeof getSessionContext>>["utterances"],
  topicId: string,
) {
  return utterances.filter((utterance) => utterance.topic_id === topicId);
}

async function claimSlotProcessingRange(input: {
  sessionId: string;
  participantCode: string | null;
  topicId: string;
  rangeStartAt: Date | null;
  rangeEndUtteranceId: string;
  requestedAt: Date;
}) {
  const staleBefore = new Date(
    input.requestedAt.getTime() - SLOT_PROCESSING_TIMEOUT_MS,
  );
  const result = await prisma.slotProcessingState.updateMany({
    where: {
      sessionId: input.sessionId,
      topicId: input.topicId,
      OR: [
        { processingStatus: { in: ["idle", "ready", "failed"] } },
        { processingStartedAt: null },
        { processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      participantCode: input.participantCode,
      processingStatus: "updating_slots",
      processingStartedAt: input.requestedAt,
      processingFinishedAt: null,
      lastError: null,
      processingRangeStartedAt: input.rangeStartAt,
      processingRangeEndUtteranceId: input.rangeEndUtteranceId,
    },
  });

  return result.count > 0;
}

async function waitForSlotProcessingRange(input: {
  sessionId: string;
  topicId: string;
  rangeEndUtteranceId: string;
}) {
  const deadline = Date.now() + SLOT_PROCESSING_TIMEOUT_MS;

  while (Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, SLOT_PROCESSING_POLL_MS));
    const state = await prisma.slotProcessingState.findUnique({
      where: {
        sessionId_topicId: {
          sessionId: input.sessionId,
          topicId: input.topicId,
        },
      },
    });

    if (
      state?.processingStatus === "ready" &&
      state.lastProcessedUtteranceId === input.rangeEndUtteranceId
    ) {
      return state;
    }
    if (state?.processingStatus === "failed") return null;
  }

  return null;
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

function parseOptionalDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

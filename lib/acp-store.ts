import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  createEmptySlotStates,
  createEmptySubSlotStates,
  isAnswerDepth,
  isSlotClassificationResponseState,
  isSlotCompletion,
  isSlotReasonCode,
  mergeSlotStates,
  normalizeConversationSpeaker,
  normalizeSlotStatus,
  toJsonValue,
  type AcpSlotState,
  type AnswerDepth,
  type ConversationUtterance,
  type FinalMinutesResult,
  type SlotClassificationResponseState,
  type SlotCompletion,
  type SlotReasonCode,
  type StoredSubSlotState,
} from "./acp-mvp";

type PrismaClientLike = typeof prisma | Prisma.TransactionClient;

export async function getSessionContext(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      utterances: {
        orderBy: { createdAt: "asc" },
      },
      slotStates: true,
      subSlotStates: true,
    },
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const slotUpdates = session.slotStates.map((slot) => ({
    slot_name: slot.slotName,
    status: normalizeSlotStatus(slot.status),
    summary: slot.summary,
    evidence_utterance: slot.evidenceUtterance ?? "",
    updated_at: slot.updatedAt.toISOString(),
  }));

  return {
    session,
    utterances: session.utterances.map((utterance) => ({
      id: utterance.id,
      speaker: normalizeConversationSpeaker(utterance.speaker),
      text: utterance.text,
      start_ms: utterance.startMs,
      end_ms: utterance.endMs,
      source: utterance.source,
      topic_id: utterance.topicId,
      topic_index: utterance.topicIndex,
      analysis_version: utterance.analysisVersion,
      created_at: utterance.createdAt.toISOString(),
    })) satisfies ConversationUtterance[],
    slotStates: mergeSlotStates(createEmptySlotStates(), slotUpdates),
    subSlotStates: mergeSubSlotStates(
      createEmptySubSlotStates(),
      session.subSlotStates.map((state) => ({
        mainSlotId: state.mainSlotId,
        subSlotId: state.subSlotId,
        completion: isSlotCompletion(state.completion) ? state.completion : "none",
        responseState: isSlotClassificationResponseState(state.responseState)
          ? state.responseState
          : "no_response",
        reasonCode:
          state.reasonCode && isSlotReasonCode(state.reasonCode)
            ? state.reasonCode
            : null,
        evidenceUtteranceIds: normalizeEvidenceIds(state.evidenceUtteranceIds),
        canAskAgain: state.canAskAgain,
        isDeferred: state.isDeferred,
        depth: isAnswerDepth(state.depth)
          ? state.depth
          : inferLegacyDepth(state.completion, state.responseState),
        needsOptionalFollowUp: false,
        hasConflict: state.responseState === "conflicting",
        lastUpdatedTopicId: state.lastUpdatedTopicId,
        updatedAt: state.updatedAt.toISOString(),
      })),
    ),
  };
}

export function getUnprocessedSlotUtterances(
  utterances: ConversationUtterance[],
  lastProcessedUtteranceId?: string | null,
) {
  const withIds = utterances.filter((utterance) => utterance.id);
  if (!lastProcessedUtteranceId) return withIds;

  const lastProcessedIndex = withIds.findIndex(
    (utterance) => utterance.id === lastProcessedUtteranceId,
  );
  if (lastProcessedIndex < 0) return withIds;

  return withIds.slice(lastProcessedIndex + 1);
}

export async function resetSlotProcessingAfterUtteranceChange(
  sessionId: string,
  utteranceIds: string[],
) {
  const idsToRemove = [...new Set(utteranceIds.map((id) => id.trim()).filter(Boolean))];

  if (idsToRemove.length > 0) {
    const states = await prisma.slotSubState.findMany({
      where: { sessionId },
      select: {
        id: true,
        evidenceUtteranceIds: true,
      },
    });

    await Promise.all(
      states.flatMap((state) => {
        const currentEvidenceIds = normalizeEvidenceIds(state.evidenceUtteranceIds);
        const nextEvidenceIds = currentEvidenceIds.filter(
          (id) => !idsToRemove.includes(id),
        );
        if (nextEvidenceIds.length === currentEvidenceIds.length) return [];

        const data: Prisma.SlotSubStateUpdateInput =
          nextEvidenceIds.length > 0
            ? {
                evidenceUtteranceIds: toJsonValue(nextEvidenceIds) as Prisma.InputJsonValue,
              }
            : {
                completion: "none",
                responseState: "no_response",
                reasonCode: "not_discussed",
                evidenceUtteranceIds: toJsonValue([]) as Prisma.InputJsonValue,
                depth: "none",
                canAskAgain: true,
                isDeferred: true,
                lastUpdatedTopicId: null,
              };

        return [
          prisma.slotSubState.update({
            where: { id: state.id },
            data,
          }),
        ];
      }),
    );
  }

  await Promise.all([
    prisma.aIProcessingState.updateMany({
      where: { sessionId },
      data: {
        lastProcessedUtteranceId: null,
        lastProcessedAt: null,
        processingStatus: "idle",
        lastError: null,
      },
    }),
    prisma.slotProcessingState.updateMany({
      where: { sessionId },
      data: {
        lastProcessedUtteranceId: null,
        lastProcessedAt: null,
        processingStatus: "idle",
        processingRangeStartedAt: null,
        processingRangeEndUtteranceId: null,
        lastError: null,
      },
    }),
  ]);
}

export async function createInitialSlotStates(sessionId: string) {
  const slots = createEmptySlotStates();
  const subSlots = createEmptySubSlotStates();

  await Promise.all(
    slots.map((slot) =>
      prisma.slotState.upsert({
        where: {
          sessionId_slotName: {
            sessionId,
            slotName: slot.slot_name,
          },
        },
        create: {
          sessionId,
          slotName: slot.slot_name,
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance,
        },
        update: {},
      }),
    ),
  );
  await saveSubSlotStates(sessionId, subSlots);

  return slots;
}

export async function saveSlotStates(
  sessionId: string,
  slots: AcpSlotState[],
  db: PrismaClientLike = prisma,
) {
  await Promise.all(
    slots.map((slot) =>
      db.slotState.upsert({
        where: {
          sessionId_slotName: {
            sessionId,
            slotName: slot.slot_name,
          },
        },
        create: {
          sessionId,
          slotName: slot.slot_name,
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance,
        },
        update: {
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance,
        },
      }),
    ),
  );
}

export function getChangedSlotStates(
  currentStates: AcpSlotState[],
  nextStates: AcpSlotState[],
) {
  const currentByName = new Map(
    currentStates.map((state) => [state.slot_name, state]),
  );

  return nextStates.filter((nextState) => {
    const currentState = currentByName.get(nextState.slot_name);
    if (!currentState) return true;

    return !areSlotStatesEqual(currentState, nextState);
  });
}

export async function saveSubSlotStates(
  sessionId: string,
  states: StoredSubSlotState[],
  db: PrismaClientLike = prisma,
) {
  await Promise.all(
    states.map((state) =>
      db.slotSubState.upsert({
        where: {
          sessionId_mainSlotId_subSlotId: {
            sessionId,
            mainSlotId: state.mainSlotId,
            subSlotId: state.subSlotId,
          },
        },
        create: {
          sessionId,
          mainSlotId: state.mainSlotId,
          subSlotId: state.subSlotId,
          completion: state.completion,
          responseState: state.responseState,
          reasonCode: state.reasonCode,
          evidenceUtteranceIds: toJsonValue(state.evidenceUtteranceIds) as Prisma.InputJsonValue,
          depth: state.depth,
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
        },
        update: {
          completion: state.completion,
          responseState: state.responseState,
          reasonCode: state.reasonCode,
          evidenceUtteranceIds: toJsonValue(state.evidenceUtteranceIds) as Prisma.InputJsonValue,
          depth: state.depth,
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
        },
      }),
    ),
  );
}

export function getChangedSubSlotStates(
  currentStates: StoredSubSlotState[],
  nextStates: StoredSubSlotState[],
) {
  const currentByKey = new Map(
    currentStates.map((state) => [
      getSubSlotStateKey(state.mainSlotId, state.subSlotId),
      state,
    ]),
  );

  return nextStates.filter((nextState) => {
    const currentState = currentByKey.get(
      getSubSlotStateKey(nextState.mainSlotId, nextState.subSlotId),
    );
    if (!currentState) return true;

    return !areSubSlotStatesEqual(currentState, nextState);
  });
}

export async function saveFinalMinutes(
  sessionId: string,
  minutes: FinalMinutesResult,
) {
  return prisma.finalMinute.create({
    data: {
      sessionId,
      markdown: minutes.markdown,
      json: toJsonValue(minutes.json) as Prisma.InputJsonValue,
    },
  });
}

function mergeSubSlotStates(
  current: StoredSubSlotState[],
  updates: StoredSubSlotState[],
) {
  const byKey = new Map(
    current.map((state) => [`${state.mainSlotId}:${state.subSlotId}`, state]),
  );

  updates.forEach((state) => {
    byKey.set(`${state.mainSlotId}:${state.subSlotId}`, state);
  });

  return [...byKey.values()];
}

function normalizeEvidenceIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function areSlotStatesEqual(current: AcpSlotState, next: AcpSlotState) {
  return (
    current.status === next.status &&
    current.summary === next.summary &&
    current.evidence_utterance === next.evidence_utterance
  );
}

function areSubSlotStatesEqual(
  current: StoredSubSlotState,
  next: StoredSubSlotState,
) {
  return (
    current.completion === next.completion &&
    current.responseState === next.responseState &&
    nullableString(current.reasonCode) === nullableString(next.reasonCode) &&
    nullableString(current.depth) === nullableString(next.depth) &&
    current.canAskAgain === next.canAskAgain &&
    current.isDeferred === next.isDeferred &&
    nullableString(current.lastUpdatedTopicId) ===
      nullableString(next.lastUpdatedTopicId) &&
    areStringArraysEqual(
      normalizeEvidenceIds(current.evidenceUtteranceIds),
      normalizeEvidenceIds(next.evidenceUtteranceIds),
    )
  );
}

function getSubSlotStateKey(mainSlotId: string, subSlotId: string) {
  return `${mainSlotId}:${subSlotId}`;
}

function nullableString(value: string | null | undefined) {
  return value ?? null;
}

function areStringArraysEqual(current: string[], next: string[]) {
  if (current.length !== next.length) return false;

  return current.every((value, index) => value === next[index]);
}

function inferLegacyDepth(completion: string, responseState: string): AnswerDepth {
  if (responseState === "no_response") return "none";
  if (completion === "complete" || completion === "partial") return "minimal";
  return "none";
}

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  createEmptySlotStates,
  createEmptySubSlotStates,
  isSlotClassificationResponseState,
  isSlotCompletion,
  isSlotReasonCode,
  mergeSlotStates,
  normalizeConversationSpeaker,
  normalizeSlotStatus,
  toJsonValue,
  type AcpSlotState,
  type ConversationUtterance,
  type FinalMinutesResult,
  type SlotClassificationResponseState,
  type SlotCompletion,
  type SlotReasonCode,
  type StoredSubSlotState,
} from "./acp-mvp";

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
        depth: inferLegacyDepth(state.completion, state.responseState),
        needsOptionalFollowUp: false,
        hasConflict: state.responseState === "conflicting",
        lastUpdatedTopicId: state.lastUpdatedTopicId,
        updatedAt: state.updatedAt.toISOString(),
      })),
    ),
  };
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

export async function saveSlotStates(sessionId: string, slots: AcpSlotState[]) {
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
        update: {
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance,
        },
      }),
    ),
  );
}

export async function saveSubSlotStates(
  sessionId: string,
  states: StoredSubSlotState[],
) {
  await Promise.all(
    states.map((state) =>
      prisma.slotSubState.upsert({
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
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
        },
        update: {
          completion: state.completion,
          responseState: state.responseState,
          reasonCode: state.reasonCode,
          evidenceUtteranceIds: toJsonValue(state.evidenceUtteranceIds) as Prisma.InputJsonValue,
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
        },
      }),
    ),
  );
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

function inferLegacyDepth(completion: string, responseState: string) {
  if (responseState === "no_response") return "none";
  if (completion === "complete" || completion === "partial") return "minimal";
  return "none";
}

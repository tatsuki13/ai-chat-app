import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { hasDatabaseColumn, isMissingColumnError } from "./db-compat";
import {
  createEmptySlotStates,
  createEmptySubSlotStates,
  isSlotClassificationResponseState,
  isSlotCompletion,
  isSlotReasonCode,
  isAnswerDepth,
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
  const session = await findSessionContextWithCompat(sessionId);

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
        depth: normalizeStoredDepth(state, state.completion, state.responseState),
        needsOptionalFollowUp: false,
        hasConflict: state.responseState === "conflicting",
        lastUpdatedTopicId: state.lastUpdatedTopicId,
        updatedAt: state.updatedAt.toISOString(),
      })),
    ),
  };
}

async function findSessionContextWithCompat(sessionId: string) {
  if (!(await hasSubSlotDepthColumn())) {
    return findLegacySessionContext(sessionId);
  }

  try {
    return await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        dialogueStartedAt: true,
        endedAt: true,
        utterances: {
          orderBy: { createdAt: "asc" },
        },
        slotStates: true,
        subSlotStates: true,
      },
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;

    return findLegacySessionContext(sessionId);
  }
}

async function findLegacySessionContext(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      participantCode: true,
      condition: true,
      startedAt: true,
      dialogueStartedAt: true,
      endedAt: true,
      utterances: {
        orderBy: { createdAt: "asc" },
      },
      slotStates: true,
      subSlotStates: {
        select: {
          id: true,
          sessionId: true,
          mainSlotId: true,
          subSlotId: true,
          completion: true,
          responseState: true,
          reasonCode: true,
          evidenceUtteranceIds: true,
          canAskAgain: true,
          isDeferred: true,
          lastUpdatedTopicId: true,
          updatedAt: true,
        },
      },
    },
  });
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
  if (!(await hasSubSlotDepthColumn())) {
    await Promise.all(
      states.map((state) => saveLegacySubSlotState(sessionId, state)),
    );
    return;
  }

  try {
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
            depth: state.depth ?? inferLegacyDepth(state.completion, state.responseState),
            lastUpdatedTopicId: state.lastUpdatedTopicId,
          },
          update: {
            completion: state.completion,
            responseState: state.responseState,
            reasonCode: state.reasonCode,
            evidenceUtteranceIds: toJsonValue(state.evidenceUtteranceIds) as Prisma.InputJsonValue,
            canAskAgain: state.canAskAgain,
            isDeferred: state.isDeferred,
            depth: state.depth ?? inferLegacyDepth(state.completion, state.responseState),
            lastUpdatedTopicId: state.lastUpdatedTopicId,
          },
        }),
      ),
    );
    return;
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
  }

  await Promise.all(
    states.map((state) => saveLegacySubSlotState(sessionId, state)),
  );
}

async function saveLegacySubSlotState(
  sessionId: string,
  state: StoredSubSlotState,
) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO slot_sub_states (
      id,
      session_id,
      main_slot_id,
      sub_slot_id,
      completion,
      response_state,
      reason_code,
      evidence_utterance_ids,
      can_ask_again,
      is_deferred,
      last_updated_topic_id,
      updated_at
    )
    VALUES (
      ${id},
      ${sessionId},
      ${state.mainSlotId},
      ${state.subSlotId},
      ${state.completion},
      ${state.responseState},
      ${state.reasonCode},
      ${JSON.stringify(state.evidenceUtteranceIds)}::jsonb,
      ${state.canAskAgain},
      ${state.isDeferred},
      ${state.lastUpdatedTopicId},
      NOW()
    )
    ON CONFLICT (session_id, main_slot_id, sub_slot_id)
    DO UPDATE SET
      completion = EXCLUDED.completion,
      response_state = EXCLUDED.response_state,
      reason_code = EXCLUDED.reason_code,
      evidence_utterance_ids = EXCLUDED.evidence_utterance_ids,
      can_ask_again = EXCLUDED.can_ask_again,
      is_deferred = EXCLUDED.is_deferred,
      last_updated_topic_id = EXCLUDED.last_updated_topic_id,
      updated_at = NOW()
  `;
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

function normalizeStoredDepth(state: unknown, completion: string, responseState: string) {
  if (!state || typeof state !== "object") {
    return inferLegacyDepth(completion, responseState);
  }

  const depth = (state as { depth?: unknown }).depth;

  return isAnswerDepth(depth) ? depth : inferLegacyDepth(completion, responseState);
}

async function hasSubSlotDepthColumn() {
  return hasDatabaseColumn("slot_sub_states", "depth");
}

function inferLegacyDepth(completion: string, responseState: string) {
  if (responseState === "no_response") return "none";
  if (completion === "complete" || completion === "partial") return "minimal";
  return "none";
}

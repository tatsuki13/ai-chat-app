import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  createEmptySlotStates,
  mergeSlotStates,
  toJsonValue,
  type AcpSlotState,
  type ButtonType,
  type ConversationUtterance,
  type FinalMinutesResult,
  type SuggestionType,
} from "./acp-mvp";

export async function getSessionContext(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      utterances: {
        orderBy: { createdAt: "asc" },
      },
      slotStates: true,
    },
  });

  if (!session) {
    throw new Error("Session not found");
  }

  const slotUpdates = session.slotStates.map((slot) => ({
    slot_name: slot.slotName,
    status: slot.status as AcpSlotState["status"],
    summary: slot.summary,
    evidence_utterance: slot.evidenceUtterance ?? "",
    updated_at: slot.updatedAt.toISOString(),
  }));

  return {
    session,
    utterances: session.utterances.map((utterance) => ({
      id: utterance.id,
      speaker: utterance.speaker,
      text: utterance.text,
      created_at: utterance.createdAt.toISOString(),
    })) satisfies ConversationUtterance[],
    slotStates: mergeSlotStates(createEmptySlotStates(), slotUpdates),
  };
}

export async function createInitialSlotStates(sessionId: string) {
  const slots = createEmptySlotStates();

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

export async function createButtonEvent(sessionId: string, buttonType: ButtonType) {
  return prisma.buttonEvent.create({
    data: {
      sessionId,
      buttonType,
    },
  });
}

export async function ensureButtonEvent(
  sessionId: string,
  buttonType: ButtonType,
  triggerEventId?: string,
) {
  if (triggerEventId) {
    const existing = await prisma.buttonEvent.findFirst({
      where: {
        id: triggerEventId,
        sessionId,
      },
    });

    if (existing) return existing;
  }

  return createButtonEvent(sessionId, buttonType);
}

export async function saveAiSuggestion(input: {
  sessionId: string;
  triggerEventId: string;
  suggestionType: SuggestionType;
  content: string;
  reasoning?: string;
  targetSlot?: string;
}) {
  return prisma.aiSuggestionLog.create({
    data: {
      sessionId: input.sessionId,
      triggerEventId: input.triggerEventId,
      suggestionType: input.suggestionType,
      content: input.content,
      reasoning: input.reasoning,
      targetSlot: input.targetSlot,
    },
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

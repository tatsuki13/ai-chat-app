import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { hasDatabaseTable } from "./db-compat";
import { toJsonValue } from "./acp-mvp";
import { AI_POLICY_VERSION, getOpenAIModel } from "./llm";

export type AiActionType =
  | "update_slots"
  | "next_question"
  | "topic_transition"
  | "check_end"
  | "final_minutes";

export async function writeAiActionEvent(input: {
  sessionId: string;
  actionType: AiActionType;
  currentTopicId?: string | null;
  currentTopicTitle?: string | null;
  targetMainSlotId?: string | null;
  targetSubSlotId?: string | null;
  generatedText?: string | null;
  reason?: string | null;
  result?: string | null;
  model?: string | null;
  policyVersion?: string | null;
  metadata?: unknown;
}) {
  try {
    if (!(await hasDatabaseTable("ai_action_events"))) return;

    await prisma.aiActionEvent.create({
      data: {
        sessionId: input.sessionId,
        actionType: input.actionType,
        currentTopicId: input.currentTopicId ?? null,
        currentTopicTitle: input.currentTopicTitle ?? null,
        targetMainSlotId: input.targetMainSlotId ?? null,
        targetSubSlotId: input.targetSubSlotId ?? null,
        generatedText: input.generatedText ?? null,
        reason: input.reason ?? null,
        result: input.result ?? null,
        model: input.model ?? getOpenAIModel(),
        policyVersion: input.policyVersion ?? AI_POLICY_VERSION,
        metadata:
          input.metadata === undefined
            ? undefined
            : (toJsonValue(input.metadata) as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    console.error("Failed to write AI action event", {
      sessionId: input.sessionId,
      actionType: input.actionType,
      error,
    });
  }
}

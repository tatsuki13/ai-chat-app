import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { toJsonValue } from "../acp-mvp";

export type AIInterventionLogType =
  | "NEXT_QUESTION"
  | "TOPIC_SWITCH"
  | "CONVERSATION_END"
  | "FINAL_MINUTES"
  | "OTHER";

export async function logAIIntervention(input: {
  sessionId: string;
  type: AIInterventionLogType;
  content: string | null | undefined;
  topicId?: string | null;
  requestedAt?: Date | null;
  generatedAt?: Date | null;
  displayedAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.aIInterventionLog.create({
      data: {
        sessionId: input.sessionId,
        type: input.type,
        content: input.content ?? "",
        topicId: input.topicId ?? undefined,
        requestedAt: input.requestedAt ?? undefined,
        generatedAt: input.generatedAt ?? new Date(),
        displayedAt: input.displayedAt ?? undefined,
        metadata:
          input.metadata === undefined
            ? undefined
            : (toJsonValue(input.metadata) as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    console.error("Failed to save AI intervention log", {
      sessionId: input.sessionId,
      type: input.type,
      error,
    });
  }
}

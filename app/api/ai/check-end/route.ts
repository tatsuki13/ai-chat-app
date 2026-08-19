import { NextResponse } from "next/server";
import {
  getSessionContext,
} from "../../../../lib/acp-store";
import { checkConversationEnd } from "../../../../lib/ai/conversation-end";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { logAIIntervention } from "../../../../lib/ai/intervention-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const requestedAt = new Date();
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const currentTopic = optionalString(body.current_topic ?? body.currentTopic);
    const currentTopicTitle = optionalString(
      body.current_topic_title ?? body.currentTopicTitle,
    );
    const context = await getSessionContext(sessionId);
    const result = await checkConversationEnd({
      ...context,
      currentTopic,
      currentTopicTitle,
    });
    const generatedAt = new Date();
    const suggestion = {
      suggestion_type: "check_end",
      content: result.message,
      can_end: result.can_end,
      message: result.message,
      reason: result.reason,
      remaining_slots: result.remaining_slots,
      slot_states_updated: false,
      control_debug: buildSlotControlDebugState({
        slots: context.slotStates,
        currentTopic,
        includeBeforeSessionEnd: true,
        subSlotStates: context.subSlotStates,
      }),
      created_at: generatedAt.toISOString(),
    };
    await logAIIntervention({
      sessionId,
      type: "CONVERSATION_END",
      content: suggestion.content,
      topicId: currentTopic ?? null,
      requestedAt,
      generatedAt,
      metadata: {
        currentTopic,
        currentTopicTitle,
        canEnd: result.can_end,
        remainingSlots: result.remaining_slots,
      },
    });

    return NextResponse.json({
      suggestion,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to check conversation end" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

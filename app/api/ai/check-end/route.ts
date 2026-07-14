import { NextResponse } from "next/server";
import {
  getSessionContext,
  saveSlotStates,
} from "../../../../lib/acp-store";
import {
  checkConversationEnd,
  updateSlotsFromConversation,
} from "../../../../lib/llm";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
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
    const slotStates =
      context.utterances.length > 0
        ? await updateSlotsFromConversation({
            ...context,
            currentTopic,
            currentTopicTitle,
          })
        : context.slotStates;
    if (context.utterances.length > 0) {
      await saveSlotStates(sessionId, slotStates);
    }
    const result = await checkConversationEnd({
      ...context,
      slotStates,
      currentTopic,
      currentTopicTitle,
    });

    return NextResponse.json({
      suggestion: {
        suggestion_type: "check_end",
        content: result.message,
        can_end: result.can_end,
        message: result.message,
        reason: result.reason,
        remaining_slots: result.remaining_slots,
        slot_states_updated: context.utterances.length > 0,
        control_debug: buildSlotControlDebugState({
          slots: slotStates,
          currentTopic,
          includeBeforeSessionEnd: true,
        }),
        created_at: new Date().toISOString(),
      },
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

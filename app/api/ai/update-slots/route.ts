import { NextResponse } from "next/server";
import {
  getSessionContext,
  saveSlotStates,
} from "../../../../lib/acp-store";
import { updateSlotsFromConversation } from "../../../../lib/llm";

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
    const slotStates = await updateSlotsFromConversation({
      ...context,
      currentTopic,
      currentTopicTitle,
    });
    await saveSlotStates(sessionId, slotStates);

    return NextResponse.json({
      slot_states: slotStates,
      final_minutes: null,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to update slots" },
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

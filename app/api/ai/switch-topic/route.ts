import { NextResponse } from "next/server";
import {
  ensureButtonEvent,
  getSessionContext,
  saveAiSuggestion,
} from "../../../../lib/acp-store";
import { generateTopicSwitch } from "../../../../lib/llm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const trigger = await ensureButtonEvent(
      sessionId,
      "switch_topic",
      optionalString(body.trigger_event_id ?? body.triggerEventId),
    );
    const context = await getSessionContext(sessionId);
    const result = await generateTopicSwitch(context);
    const savedSuggestion = await saveAiSuggestion({
      sessionId,
      triggerEventId: trigger.id,
      suggestionType: "switch_topic",
      content: result.message,
      reasoning: result.reason,
      targetSlot: result.target_slot,
    });

    return NextResponse.json({
      trigger_event_id: trigger.id,
      suggestion: {
        id: savedSuggestion.id,
        suggestion_type: savedSuggestion.suggestionType,
        content: savedSuggestion.content,
        message: result.message,
        target_slot: result.target_slot,
        reason: result.reason,
        sensitivity: result.sensitivity,
        created_at: savedSuggestion.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to generate topic switch" },
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

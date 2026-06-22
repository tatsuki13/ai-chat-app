import { NextResponse } from "next/server";
import {
  ensureButtonEvent,
  getSessionContext,
  saveAiSuggestion,
  saveSlotStates,
} from "../../../../lib/acp-store";
import {
  generateNextQuestion,
  updateSlotsFromConversation,
} from "../../../../lib/llm";

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
      "next_question",
      optionalString(body.trigger_event_id ?? body.triggerEventId),
    );
    const context = await getSessionContext(sessionId);
    const slotStates =
      context.utterances.length > 0
        ? await updateSlotsFromConversation(context)
        : context.slotStates;
    if (context.utterances.length > 0) {
      await saveSlotStates(sessionId, slotStates);
    }
    const result = await generateNextQuestion({
      ...context,
      slotStates,
      currentTopic: optionalString(body.current_topic ?? body.currentTopic),
      currentTopicTitle: optionalString(
        body.current_topic_title ?? body.currentTopicTitle,
      ),
    });
    const savedSuggestion = await saveAiSuggestion({
      sessionId,
      triggerEventId: trigger.id,
      suggestionType: "next_question",
      content: result.question,
      reasoning: result.reason,
      targetSlot: result.target_slot,
    });

    return NextResponse.json({
      trigger_event_id: trigger.id,
      suggestion: {
        id: savedSuggestion.id,
        suggestion_type: savedSuggestion.suggestionType,
        content: savedSuggestion.content,
        question: result.question,
        transition_phrase: result.transition_phrase,
        target_slot: result.target_slot,
        reason: result.reason,
        sensitivity: result.sensitivity,
        slot_states_updated: context.utterances.length > 0,
        created_at: savedSuggestion.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to generate next question" },
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

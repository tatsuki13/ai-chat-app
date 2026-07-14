import { NextResponse } from "next/server";
import {
  getSessionContext,
} from "../../../../lib/acp-store";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { generateNextQuestion } from "../../../../lib/llm";

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
    const result = await generateNextQuestion({
      ...context,
      currentTopic,
      currentTopicTitle,
    });

    return NextResponse.json({
      suggestion: {
        suggestion_type: "next_question",
        content: result.question,
        question: result.question,
        transition_phrase: result.transition_phrase,
        target_slot: result.target_slot,
        reason: result.reason,
        sensitivity: result.sensitivity,
        slot_states_updated: false,
        control_debug: buildSlotControlDebugState({
          slots: context.slotStates,
          currentTopic,
          subSlotStates: context.subSlotStates,
        }),
        created_at: new Date().toISOString(),
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

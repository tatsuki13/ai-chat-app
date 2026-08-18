import { NextResponse } from "next/server";
import {
  getSessionContext,
} from "../../../../lib/acp-store";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { generateNextQuestion, getOpenAIModel, AI_POLICY_VERSION } from "../../../../lib/llm";
import { requireSessionAccess } from "../../../../lib/auth";
import { writeAiActionEvent } from "../../../../lib/ai-action-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const auth = await requireSessionAccess(request, sessionId);
    if ("response" in auth) return auth.response;

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
    await writeAiActionEvent({
      sessionId,
      actionType: "next_question",
      currentTopicId: currentTopic,
      currentTopicTitle,
      targetMainSlotId: result.targetMainSlotId,
      targetSubSlotId: result.targetSubSlotId,
      generatedText: result.question,
      reason: result.reason,
      result: result.no_relevant_followup ? "no_question" : "question_generated",
      model: getOpenAIModel(),
      policyVersion: AI_POLICY_VERSION,
      metadata: {
        target_slot: result.target_slot,
        transition_phrase: result.transition_phrase,
        sensitivity: result.sensitivity,
        no_relevant_followup: result.no_relevant_followup === true,
      },
    });

    return NextResponse.json({
      suggestion: {
        suggestion_type: "next_question",
        content: result.question,
        question: result.question,
        transition_phrase: result.transition_phrase,
        target_slot: result.target_slot,
        targetMainSlotId: result.targetMainSlotId,
        targetSubSlotId: result.targetSubSlotId,
        no_relevant_followup: result.no_relevant_followup === true,
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

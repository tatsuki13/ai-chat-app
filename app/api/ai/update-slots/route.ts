import { NextResponse } from "next/server";
import {
  getSessionContext,
  saveSubSlotStates,
  saveSlotStates,
} from "../../../../lib/acp-store";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { updateSlotStateBundleFromConversation } from "../../../../lib/llm";
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
    const bundle = await updateSlotStateBundleFromConversation({
      ...context,
      currentTopic,
      currentTopicTitle,
    });
    await saveSlotStates(sessionId, bundle.slotStates);
    await saveSubSlotStates(sessionId, bundle.subSlotStates);
    await writeAiActionEvent({
      sessionId,
      actionType: "update_slots",
      currentTopicId: currentTopic,
      currentTopicTitle,
      result: "updated",
      metadata: {
        unmatched_utterance_ids: bundle.debug.unmatchedUtteranceIds,
        summary: bundle.debug.summary,
      },
    });
    const slotControl = buildSlotControlDebugState({
      slots: bundle.slotStates,
      currentTopic,
      subSlotStates: bundle.subSlotStates,
      classificationDebug: bundle.debug.summary,
    });

    return NextResponse.json({
      slot_states: bundle.slotStates,
      sub_slot_states: bundle.subSlotStates,
      slot_control: slotControl,
      slot_classification_debug: bundle.debug,
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

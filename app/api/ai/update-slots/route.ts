import { NextResponse } from "next/server";
import { updateSlotsForTopic } from "../../../../lib/server/slot-processing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let sessionId = "";

  try {
    const body = await request.json();
    sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const result = await updateSlotsForTopic({
      sessionId,
      topicId: optionalString(body.current_topic_id ?? body.currentTopicId),
      currentTopic: optionalString(body.current_topic ?? body.currentTopic),
      currentTopicTitle: optionalString(
        body.current_topic_title ?? body.currentTopicTitle,
      ),
    });

    return NextResponse.json({
      outcome: result.outcome,
      slot_update_outcome: result.outcome,
      processing: result.processingState,
      topic_processing: result.topicProcessingState ?? result.processingState,
      processed_through_utterance_id: result.processedThroughUtteranceId,
      processed_utterance_ids: result.processedUtteranceIds,
      slot_states: result.slotStates,
      sub_slot_states: result.subSlotStates,
      slot_control: result.slotControl,
      slot_classification_debug: result.slotClassificationDebug,
      final_minutes: null,
    });
  } catch (error) {
    console.error("[ai update-slots failed]", {
      sessionId,
      stage: "update_slots",
      error: error instanceof Error ? error.message : String(error),
    });

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

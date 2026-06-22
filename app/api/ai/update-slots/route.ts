import { NextResponse } from "next/server";
import {
  ensureButtonEvent,
  getSessionContext,
  saveFinalMinutes,
  saveSlotStates,
} from "../../../../lib/acp-store";
import {
  generateFinalMinutes,
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
      "update_slots",
      optionalString(body.trigger_event_id ?? body.triggerEventId),
    );
    const context = await getSessionContext(sessionId);
    const slotStates = await updateSlotsFromConversation(context);
    await saveSlotStates(sessionId, slotStates);

    const minutes = await generateFinalMinutes({
      utterances: context.utterances,
      slotStates,
    });
    const savedMinutes = await saveFinalMinutes(sessionId, minutes);

    return NextResponse.json({
      trigger_event_id: trigger.id,
      slot_states: slotStates,
      final_minutes: {
        id: savedMinutes.id,
        markdown: savedMinutes.markdown,
        json: savedMinutes.json,
        created_at: savedMinutes.createdAt.toISOString(),
      },
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

import { NextResponse } from "next/server";
import {
  getSessionContext,
  saveFinalMinutes,
  saveSlotStates,
  saveSubSlotStates,
} from "../../../../lib/acp-store";
import {
  generateFinalMinutes,
  updateSlotStateBundleFromConversation,
} from "../../../../lib/llm";
import { prisma } from "../../../../lib/prisma";

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
    const initialContext = await getSessionContext(sessionId);
    const bundle = await updateSlotStateBundleFromConversation({
      ...initialContext,
      currentTopic,
      currentTopicTitle,
    });
    await saveSlotStates(sessionId, bundle.slotStates);
    await saveSubSlotStates(sessionId, bundle.subSlotStates);

    const context = await getSessionContext(sessionId);
    const minutes = await generateFinalMinutes({
      ...context,
      currentTopic,
      currentTopicTitle,
      sessionId: context.session.id,
      participantCode: context.session.participantCode,
    });
    const savedMinutes = await saveFinalMinutes(sessionId, minutes);
    const endedAt = context.session.endedAt ?? new Date();
    const session = await prisma.session.update({
      where: { id: sessionId },
      data: { endedAt },
    });

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      slot_states: context.slotStates,
      sub_slot_states: context.subSlotStates,
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
      { error: "Failed to generate final minutes" },
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

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
    const finalize = body.finalize === true;
    const initialContext = await getSessionContext(sessionId);
    const bundle = await updateSlotStateBundleFromConversation({
      ...initialContext,
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
      result: "updated_before_minutes",
      metadata: { summary: bundle.debug.summary },
    });

    const context = await getSessionContext(sessionId);
    const minutes = await generateFinalMinutes({
      ...context,
      currentTopic,
      currentTopicTitle,
      sessionId: context.session.id,
      participantCode: context.session.participantCode,
    });
    const savedMinutes = await saveFinalMinutes(sessionId, minutes);
    await writeAiActionEvent({
      sessionId,
      actionType: "final_minutes",
      currentTopicId: currentTopic,
      currentTopicTitle,
      generatedText: savedMinutes.markdown,
      result: finalize ? "finalized" : "draft_saved",
      metadata: { final_minutes_id: savedMinutes.id },
    });
    const session = finalize
      ? await prisma.session.update({
          where: { id: sessionId },
          data: { endedAt: context.session.endedAt ?? new Date() },
        })
      : context.session;

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
        topic_started_at: session.topicStartedAt?.toISOString() ?? null,
        conversation_phase: session.conversationPhase,
        topic_paused_ms: session.topicPausedMs,
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

import { NextResponse } from "next/server";
import {
  getSessionContext,
  saveFinalMinutes,
  saveSlotStates,
} from "../../../../lib/acp-store";
import {
  generateFinalMinutes,
  updateSlotsFromConversation,
} from "../../../../lib/llm";
import { prisma } from "../../../../lib/prisma";
import { ensureStudySessionForAppSession } from "../../../../lib/research-store";

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
    const slotStates =
      context.utterances.length > 0
        ? await updateSlotsFromConversation({
            ...context,
            currentTopic,
            currentTopicTitle,
          })
        : context.slotStates;

    if (context.utterances.length > 0) {
      await saveSlotStates(sessionId, slotStates);
    }

    const minutes = await generateFinalMinutes({
      ...context,
      slotStates,
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

    await ensureStudySessionForAppSession({
      id: session.id,
      participantCode: session.participantCode,
      condition: session.condition,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    });

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
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

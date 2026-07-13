import { NextResponse } from "next/server";
import {
  createEmptySlotStates,
  mergeSlotStates,
  normalizeSlotStatus,
} from "../../../../../lib/acp-mvp";
import { prisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        utterances: {
          orderBy: { createdAt: "asc" },
        },
        buttonEvents: {
          orderBy: { createdAt: "asc" },
        },
        aiSuggestions: {
          orderBy: { createdAt: "asc" },
        },
        slotStates: true,
        finalMinutes: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const slotStates = mergeSlotStates(
      createEmptySlotStates(),
      session.slotStates.map((slot) => ({
        slot_name: slot.slotName,
        status: normalizeSlotStatus(slot.status),
        summary: slot.summary,
        evidence_utterance: slot.evidenceUtterance ?? "",
        updated_at: slot.updatedAt.toISOString(),
      })),
    );

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      utterances: session.utterances.map((utterance) => ({
        id: utterance.id,
        session_id: utterance.sessionId,
        participant_code: session.participantCode,
        speaker: utterance.speaker,
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      })),
      button_events: session.buttonEvents.map((event) => ({
        id: event.id,
        session_id: event.sessionId,
        participant_code: session.participantCode,
        button_type: event.buttonType,
        created_at: event.createdAt.toISOString(),
      })),
      ai_suggestions: session.aiSuggestions.map((suggestion) => ({
        id: suggestion.id,
        session_id: suggestion.sessionId,
        participant_code: session.participantCode,
        trigger_event_id: suggestion.triggerEventId,
        suggestion_type: suggestion.suggestionType,
        content: suggestion.content,
        reasoning: suggestion.reasoning,
        target_slot: suggestion.targetSlot,
        adopted: suggestion.adopted,
        created_at: suggestion.createdAt.toISOString(),
      })),
      slot_states: slotStates,
      final_minutes: session.finalMinutes.map((minutes) => ({
        id: minutes.id,
        session_id: minutes.sessionId,
        participant_code: session.participantCode,
        markdown: minutes.markdown,
        json: minutes.json,
        created_at: minutes.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load session detail" },
      { status: 500 },
    );
  }
}

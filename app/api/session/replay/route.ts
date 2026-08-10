import { NextResponse } from "next/server";
import { createInitialSlotStates } from "../../../../lib/acp-store";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

const REPLAY_PREFIX = "tatsuki_";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const replayParticipantCode = requiredString(
      body.participant_code ?? body.participantCode,
    );

    if (!replayParticipantCode.startsWith(REPLAY_PREFIX)) {
      return NextResponse.json(
        { error: "participant_code must start with tatsuki_" },
        { status: 400 },
      );
    }

    const sourceParticipantCode = replayParticipantCode.slice(REPLAY_PREFIX.length).trim();
    if (!sourceParticipantCode) {
      return NextResponse.json(
        { error: "source participant_code is required" },
        { status: 400 },
      );
    }

    const sourceSession = await prisma.session.findFirst({
      where: {
        participantCode: sourceParticipantCode,
        condition: { not: "replay" },
      },
      orderBy: [{ endedAt: "desc" }, { startedAt: "desc" }],
      include: {
        utterances: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!sourceSession) {
      return NextResponse.json(
        { error: "source session not found" },
        { status: 404 },
      );
    }

    const session = await prisma.session.create({
      data: {
        participantCode: replayParticipantCode,
        condition: "replay",
        utterances: {
          create: sourceSession.utterances.map((utterance) => ({
            speaker: utterance.speaker,
            text: utterance.text,
            createdAt: utterance.createdAt,
          })),
        },
      },
      include: {
        utterances: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const slotStates = await createInitialSlotStates(session.id);

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      source_session: {
        participant_code: sourceSession.participantCode,
        started_at: sourceSession.startedAt.toISOString(),
        ended_at: sourceSession.endedAt?.toISOString() ?? null,
        utterance_count: sourceSession.utterances.length,
      },
      utterance_count: session.utterances.length,
      utterances: session.utterances.map((utterance) => ({
        id: utterance.id,
        speaker: normalizeConversationSpeaker(utterance.speaker),
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      })),
      slot_states: slotStates,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to create replay session" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

import { NextResponse } from "next/server";
import { createInitialSlotStates, getSessionContext } from "../../../../lib/acp-store";
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

    const existingReplaySession = await prisma.session.findFirst({
      where: {
        participantCode: replayParticipantCode,
        condition: "replay",
      },
      select: { id: true },
    });

    if (existingReplaySession) {
      const sourceSession = await findSourceSession(sourceParticipantCode);

      return NextResponse.json(
        await buildReplayResponse({
          sessionId: existingReplaySession.id,
          sourceParticipantCode,
          sourceSession,
          reused: true,
        }),
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

    return NextResponse.json(
      await buildReplayResponse({
        sessionId: session.id,
        sourceParticipantCode,
        sourceSession,
        slotStates,
        reused: false,
      }),
    );
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

async function findSourceSession(sourceParticipantCode: string) {
  return prisma.session.findFirst({
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
}

async function buildReplayResponse(input: {
  sessionId: string;
  sourceParticipantCode: string;
  sourceSession: Awaited<ReturnType<typeof findSourceSession>>;
  slotStates?: Awaited<ReturnType<typeof createInitialSlotStates>>;
  reused: boolean;
}) {
  const context = await getSessionContext(input.sessionId);

  return {
    reused: input.reused,
    session: {
      id: context.session.id,
      participant_code: context.session.participantCode,
      condition: context.session.condition,
      started_at: context.session.startedAt.toISOString(),
      dialogue_started_at: context.session.dialogueStartedAt?.toISOString() ?? null,
      ended_at: context.session.endedAt?.toISOString() ?? null,
    },
    source_session: {
      participant_code:
        input.sourceSession?.participantCode ?? input.sourceParticipantCode,
      started_at:
        input.sourceSession?.startedAt.toISOString() ??
        context.session.startedAt.toISOString(),
      ended_at: input.sourceSession?.endedAt?.toISOString() ?? null,
      utterance_count: input.sourceSession?.utterances.length ?? context.utterances.length,
    },
    utterance_count: context.utterances.length,
    utterances: context.utterances.map((utterance) => ({
      id: utterance.id,
      speaker: normalizeConversationSpeaker(utterance.speaker),
      text: utterance.text,
      created_at: utterance.created_at,
    })),
    slot_states: input.slotStates ?? context.slotStates,
  };
}

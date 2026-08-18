import { NextResponse } from "next/server";
import { createInitialSlotStates, getSessionContext } from "../../../../lib/acp-store";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";
import { requireAdminAccess } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = requireAdminAccess(request);
    if ("response" in auth) return auth.response;

    const body = await request.json();
    const sourceParticipantCode = requiredString(
      body.participant_code ?? body.participantCode,
    );

    if (!sourceParticipantCode) {
      return NextResponse.json(
        { error: "source participant_code is required" },
        { status: 400 },
      );
    }

    const replayParticipantCode = await createUniqueReplayParticipantCode(
      sourceParticipantCode,
    );

    const existingSessionWithReplayCode = await prisma.session.findFirst({
      where: {
        participantCode: replayParticipantCode,
      },
      select: { id: true, condition: true },
    });

    if (existingSessionWithReplayCode && existingSessionWithReplayCode.condition !== "replay") {
      return NextResponse.json(
        { error: "replay participant_code already exists as a normal session" },
        { status: 409 },
      );
    }

    if (existingSessionWithReplayCode) {
      const sourceSession = await findSourceSession(sourceParticipantCode);

      return NextResponse.json(
        await buildReplayResponse({
          sessionId: existingSessionWithReplayCode.id,
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

async function createUniqueReplayParticipantCode(sourceParticipantCode: string) {
  const normalized = sourceParticipantCode.replace(/[^A-Za-z0-9_-]/g, "-");
  const base = `dev_${normalized}`;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.session.findFirst({
      where: { participantCode: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;
  }

  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
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

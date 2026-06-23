import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const [session, utteranceCount, utterances] = await prisma.$transaction([
      prisma.session.findUnique({
        where: { id },
        select: {
          id: true,
          participantCode: true,
          condition: true,
          startedAt: true,
          endedAt: true,
        },
      }),
      prisma.sessionUtterance.count({
        where: { sessionId: id },
      }),
      prisma.sessionUtterance.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          speaker: true,
          text: true,
          createdAt: true,
        },
      }),
    ]);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      utterance_count: utteranceCount,
      utterances: utterances.reverse().map((utterance) => ({
        id: utterance.id,
        speaker: utterance.speaker,
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    if (!("participant_code" in body) && !("participantCode" in body)) {
      return NextResponse.json(
        { error: "participant_code is required" },
        { status: 400 },
      );
    }

    const participantCode = normalizeParticipantCode(
      body.participant_code ?? body.participantCode,
    );

    if (!participantCode) {
      return NextResponse.json(
        { error: "participant_code cannot be empty" },
        { status: 400 },
      );
    }

    const existing = await prisma.session.findFirst({
      where: {
        participantCode,
        NOT: { id },
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: "participant_code already exists" },
        { status: 409 },
      );
    }

    const session = await prisma.session.update({
      where: { id },
      data: {
        participantCode,
      },
    });

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error(error);

    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "participant_code already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 },
    );
  }
}

function normalizeParticipantCode(value: unknown) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed || null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

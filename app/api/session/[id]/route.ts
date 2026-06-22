import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

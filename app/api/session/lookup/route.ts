import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const participantCode = searchParams.get("participant_code")?.trim();

    if (!participantCode) {
      return NextResponse.json(
        { error: "participant_code is required" },
        { status: 400 },
      );
    }

    const session = await prisma.session.findFirst({
      where: { participantCode },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        dialogueStartedAt: true,
        endedAt: true,
        _count: {
          select: {
            utterances: true,
            finalMinutes: true,
          },
        },
      },
    });

    return NextResponse.json({
      session: session
        ? {
            id: session.id,
            participant_code: session.participantCode,
            condition: session.condition,
            started_at: session.startedAt.toISOString(),
            dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
            ended_at: session.endedAt?.toISOString() ?? null,
            utterance_count: session._count.utterances,
            has_final_minutes: session._count.finalMinutes > 0,
          }
        : null,
    });
  } catch (error) {
    console.error("Failed to lookup session", error);

    return NextResponse.json(
      { error: "Failed to lookup session" },
      { status: 500 },
    );
  }
}

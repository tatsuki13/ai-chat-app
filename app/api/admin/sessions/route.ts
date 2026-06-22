import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sessions = await prisma.session.findMany({
      orderBy: { startedAt: "desc" },
      take: 100,
      include: {
        _count: {
          select: {
            utterances: true,
            buttonEvents: true,
            aiSuggestions: true,
          },
        },
        finalMinutes: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
        utterance_count: session._count.utterances,
        button_event_count: session._count.buttonEvents,
        ai_suggestion_count: session._count.aiSuggestions,
        has_final_minutes: session.finalMinutes.length > 0,
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load sessions" },
      { status: 500 },
    );
  }
}

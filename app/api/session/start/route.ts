import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { createInitialSlotStates } from "../../../../lib/acp-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const participantCode = optionalString(body.participant_code ?? body.participantCode);
    const condition = optionalString(body.condition);
    const session = await prisma.session.create({
      data: {
        participantCode,
        condition,
      },
    });
    const slotStates = await createInitialSlotStates(session.id);

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      slot_states: slotStates,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 },
    );
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

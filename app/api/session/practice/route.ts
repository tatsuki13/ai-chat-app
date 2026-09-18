import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  clearFixedRemoteMicActiveSession,
  setFixedRemoteMicActiveSession,
} from "../../../../lib/remote-mic/active-session-db";
import { clearFixedRemoteMicRoleStates } from "../../../../lib/remote-mic/fixed-role-state-db";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await prisma.session.create({
      data: {
        condition: "practice",
        currentTopicId: "practice-animals-1",
        currentTopicIndex: 0,
        conversationPhase: "practice",
      },
    });

    const active = await setFixedRemoteMicActiveSession(session.id);
    if (!active.ok) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return NextResponse.json({ error: active.error }, { status: active.status });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: null,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        ended_at: session.endedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
      },
      active: active.active,
    });
  } catch (error) {
    console.error("[practice session create failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to start practice session" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, condition: true },
    });

    await clearFixedRemoteMicActiveSession(sessionId);
    await clearFixedRemoteMicRoleStates(sessionId);

    if (session?.condition === "practice") {
      await prisma.session.delete({ where: { id: sessionId } });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[practice session cleanup failed]", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to clean up practice session" },
      { status: 500 },
    );
  }
}

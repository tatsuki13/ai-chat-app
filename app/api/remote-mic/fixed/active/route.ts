import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  clearActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
} from "../../../../../lib/remote-mic/fixed-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      participantCode: true,
      endedAt: true,
      dialogueStartedAt: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const state = setActiveFixedRemoteMicSession({
    sessionId: session.id,
    participantCode: session.participantCode,
    endedAt: session.endedAt?.toISOString() ?? null,
    dialogueStartedAt: session.dialogueStartedAt?.toISOString() ?? null,
  });

  return NextResponse.json({ active: serializeState(state) });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  clearActiveFixedRemoteMicSession(params.get("sessionId") ?? undefined);

  return NextResponse.json({ ok: true });
}

function serializeState(
  state: ReturnType<typeof setActiveFixedRemoteMicSession>,
) {
  return {
    sessionId: state.sessionId,
    participantCode: state.participantCode,
    endedAt: state.endedAt,
    dialogueStartedAt: state.dialogueStartedAt,
    roles: state.roles,
  };
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  getActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
  updateFixedRemoteMicRole,
} from "../../../../../lib/remote-mic/fixed-session";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
    sessionId?: unknown;
    muted?: unknown;
  } | null;
  const role = parseRemoteMicRole(requiredString(body?.role));
  const sessionId = requiredString(body?.sessionId);
  const muted = body?.muted !== false;

  if (!role || !sessionId) {
    return NextResponse.json(
      { error: "role and sessionId are required" },
      { status: 400 },
    );
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  if (!muted) {
    await prisma.session.updateMany({
      where: {
        id: sessionId,
        dialogueStartedAt: null,
        endedAt: null,
      },
      data: { dialogueStartedAt: new Date() },
    });
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

  if (!session || session.endedAt) {
    return NextResponse.json({ error: "Session is not active" }, { status: 409 });
  }

  const nextActive = setActiveFixedRemoteMicSession({
    sessionId: session.id,
    participantCode: session.participantCode,
    endedAt: session.endedAt?.toISOString() ?? null,
    dialogueStartedAt: session.dialogueStartedAt?.toISOString() ?? null,
  });
  updateFixedRemoteMicRole(role, {
    muted,
    transmitting: !muted,
    connectedAt: Date.now(),
  });

  return NextResponse.json({
    dialogueStartedAt: nextActive.dialogueStartedAt,
    muted,
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

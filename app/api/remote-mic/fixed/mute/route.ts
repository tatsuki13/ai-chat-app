import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
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

  const runtimeActive = getActiveFixedRemoteMicSession();
  let active:
    | {
        sessionId: string;
        participantCode: string | null;
        endedAt: string | null;
        dialogueStartedAt: string | null;
      }
    | null = null;

  try {
    active = await getFixedRemoteMicActiveSession();
  } catch (error) {
    console.warn("[remote-mic fixed mute db lookup failed]", {
      role,
      sessionId,
      muted,
      error,
    });
    active = runtimeActive;
  }

  if (!active || active.sessionId !== sessionId) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  let session = {
    id: active.sessionId,
    participantCode: active.participantCode,
    endedAt: active.endedAt ? new Date(active.endedAt) : null,
    dialogueStartedAt: active.dialogueStartedAt
      ? new Date(active.dialogueStartedAt)
      : null,
  };

  try {
    const dbSession = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        participantCode: true,
        endedAt: true,
        dialogueStartedAt: true,
      },
    });

    if (dbSession) session = dbSession;
  } catch (error) {
    console.warn("[remote-mic fixed mute session lookup failed]", {
      role,
      sessionId,
      muted,
      error,
    });
  }

  if (session.endedAt) {
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

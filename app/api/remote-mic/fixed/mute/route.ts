import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import {
  parseRemoteMicCaptureState,
  upsertFixedRemoteMicRoleState,
} from "../../../../../lib/remote-mic/fixed-role-state-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
    sessionId?: unknown;
    muted?: unknown;
    realtimeConnected?: unknown;
    captureState?: unknown;
    reconnectAttempt?: unknown;
    reconnectReason?: unknown;
  } | null;
  const role = parseRemoteMicRole(requiredString(body?.role));
  const sessionId = requiredString(body?.sessionId);
  const muted = typeof body?.muted === "boolean" ? body.muted : undefined;
  const realtimeConnected =
    typeof body?.realtimeConnected === "boolean" ? body.realtimeConnected : undefined;
  const captureState = parseRemoteMicCaptureState(body?.captureState);
  const reconnectAttempt =
    typeof body?.reconnectAttempt === "number" && Number.isFinite(body.reconnectAttempt)
      ? body.reconnectAttempt
      : body?.reconnectAttempt === null
        ? null
        : undefined;
  const reconnectReason =
    typeof body?.reconnectReason === "string"
      ? body.reconnectReason
      : body?.reconnectReason === null
        ? null
      : undefined;

  if (!role || !sessionId) {
    return NextResponse.json(
      { error: "role and sessionId are required" },
      { status: 400 },
    );
  }

  const active = await getFixedRemoteMicActiveSession();

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

  const roleState = await upsertFixedRemoteMicRoleState({
    sessionId: session.id,
    role,
    muted,
    realtimeConnected,
    captureState: captureState ?? undefined,
    reconnectAttempt,
    reconnectReason,
  });

  return NextResponse.json({
    dialogueStartedAt: session.dialogueStartedAt?.toISOString() ?? null,
    roleState,
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

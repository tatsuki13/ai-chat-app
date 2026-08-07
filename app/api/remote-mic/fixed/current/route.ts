import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  getActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
  updateFixedRemoteMicRole,
} from "../../../../../lib/remote-mic/fixed-session";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const role = parseRemoteMicRole(params.get("role") ?? "");

  if (!role) {
    return NextResponse.json({ error: "role is required" }, { status: 400 });
  }

  updateFixedRemoteMicRole(role, { connectedAt: Date.now() });
  const active = getActiveFixedRemoteMicSession();

  if (!active) {
    return NextResponse.json({
      active: null,
      role,
    });
  }

  const session = await prisma.session.findUnique({
    where: { id: active.sessionId },
    select: {
      id: true,
      participantCode: true,
      endedAt: true,
      dialogueStartedAt: true,
    },
  });

  if (!session || session.endedAt) {
    return NextResponse.json({
      active: null,
      role,
    });
  }

  const nextActive = setActiveFixedRemoteMicSession({
    sessionId: session.id,
    participantCode: session.participantCode,
    endedAt: session.endedAt?.toISOString() ?? null,
    dialogueStartedAt: session.dialogueStartedAt?.toISOString() ?? null,
  });
  updateFixedRemoteMicRole(role, { connectedAt: Date.now() });

  return NextResponse.json({
    active: {
      sessionId: nextActive.sessionId,
      participantCode: nextActive.participantCode,
      endedAt: nextActive.endedAt,
      dialogueStartedAt: nextActive.dialogueStartedAt,
      roleState: nextActive.roles[role],
    },
    role,
  });
}

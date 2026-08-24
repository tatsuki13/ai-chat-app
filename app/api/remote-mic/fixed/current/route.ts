import { NextResponse } from "next/server";
import {
  getActiveFixedRemoteMicSession,
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

  const active = getActiveFixedRemoteMicSession();

  if (!active || active.endedAt) {
    return NextResponse.json({
      active: null,
      role,
    });
  }

  const nextActive =
    updateFixedRemoteMicRole(role, { connectedAt: Date.now() }) ?? active;

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

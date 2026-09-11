import { NextResponse } from "next/server";
import {
  recordFixedRemoteMicHeartbeat,
} from "../../../../../lib/remote-mic/fixed-role-state-db";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const role = parseRemoteMicRole(params.get("role") ?? "");

  if (!role) {
    return NextResponse.json({ error: "role is required" }, { status: 400 });
  }

  const active = await getFixedRemoteMicActiveSession();

  if (!active || active.endedAt) {
    return NextResponse.json({
      active: null,
      role,
    });
  }

  const roleState = await recordFixedRemoteMicHeartbeat({
    sessionId: active.sessionId,
    role,
  });

  return NextResponse.json({
    active: {
      sessionId: active.sessionId,
      participantCode: active.participantCode,
      endedAt: active.endedAt,
      dialogueStartedAt: active.dialogueStartedAt,
      roleState,
    },
    role,
  });
}

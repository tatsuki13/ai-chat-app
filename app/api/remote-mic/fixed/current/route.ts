import { NextResponse } from "next/server";
import {
  getActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
  updateFixedRemoteMicRole,
} from "../../../../../lib/remote-mic/fixed-session";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const role = parseRemoteMicRole(params.get("role") ?? "");

  if (!role) {
    return NextResponse.json({ error: "role is required" }, { status: 400 });
  }

  let cachedActive = getActiveFixedRemoteMicSession();

  try {
    const active = await getFixedRemoteMicActiveSession();

    if (!active || active.endedAt) {
      return NextResponse.json({
        active: null,
        role,
      });
    }

    cachedActive = setActiveFixedRemoteMicSession(active);
  } catch (error) {
    console.warn("[remote-mic fixed current db lookup failed]", {
      role,
      error,
    });

    if (!cachedActive || cachedActive.endedAt) {
      return NextResponse.json({
        active: null,
        role,
      });
    }
  }

  const nextActive =
    updateFixedRemoteMicRole(role, { connectedAt: Date.now() }) ?? cachedActive;

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

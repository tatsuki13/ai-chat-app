import { NextResponse } from "next/server";
import {
  clearFixedRemoteMicActiveSession,
  getFixedRemoteMicActiveSession,
  setFixedRemoteMicActiveSession,
} from "../../../../../lib/remote-mic/active-session-db";
import {
  clearActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
} from "../../../../../lib/remote-mic/fixed-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const active = await getFixedRemoteMicActiveSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ active: null });
  }

  const state = setActiveFixedRemoteMicSession(active);

  return NextResponse.json({ active: serializeState(state) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const result = await setFixedRemoteMicActiveSession(sessionId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const state = setActiveFixedRemoteMicSession(result.active);

  return NextResponse.json({ active: serializeState(state) });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId") ?? undefined;
  await clearFixedRemoteMicActiveSession(sessionId);
  clearActiveFixedRemoteMicSession(sessionId);

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

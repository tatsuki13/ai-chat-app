import { NextResponse } from "next/server";
import {
  clearFixedRemoteMicActiveSession,
  getFixedRemoteMicActiveSession,
  setFixedRemoteMicActiveSession,
} from "../../../../../lib/remote-mic/active-session-db";
import {
  clearFixedRemoteMicRoleStates,
  getFixedRemoteMicRoleStates,
} from "../../../../../lib/remote-mic/fixed-role-state-db";

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

  const roles = await getFixedRemoteMicRoleStates(active.sessionId);

  return NextResponse.json({ active: serializeState(active, roles) });
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

  const roles = await getFixedRemoteMicRoleStates(result.active.sessionId);

  return NextResponse.json({ active: serializeState(result.active, roles) });
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId") ?? undefined;
  await clearFixedRemoteMicActiveSession(sessionId);
  await clearFixedRemoteMicRoleStates(sessionId);

  return NextResponse.json({ ok: true });
}

function serializeState(
  state: NonNullable<Awaited<ReturnType<typeof getFixedRemoteMicActiveSession>>>,
  roles: Awaited<ReturnType<typeof getFixedRemoteMicRoleStates>>,
) {
  return {
    sessionId: state.sessionId,
    participantCode: state.participantCode,
    endedAt: state.endedAt,
    dialogueStartedAt: state.dialogueStartedAt,
    roles,
  };
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

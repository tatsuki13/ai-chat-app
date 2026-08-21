import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../../lib/remote-mic/config";
import { getActiveFixedRemoteMicSession } from "../../../../../../lib/remote-mic/fixed-session";
import { setRemoteMicWebRtcAnswer } from "../../../../../../lib/remote-mic/webrtc-signaling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    role?: unknown;
    peerId?: string;
    answer?: unknown;
  } | null;
  const sessionId = body?.sessionId?.trim() ?? "";
  const role = parseRemoteMicRole(body?.role);
  const peerId = body?.peerId?.trim() ?? "";

  if (
    !sessionId ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId) ||
    !role ||
    !peerId ||
    !body?.answer
  ) {
    return NextResponse.json(
      { error: "sessionId, role, peerId, and answer are required" },
      { status: 400 },
    );
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  const offer = setRemoteMicWebRtcAnswer({
    sessionId,
    role,
    peerId,
    answer: body.answer,
  });

  if (!offer) {
    return NextResponse.json({ error: "offer not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

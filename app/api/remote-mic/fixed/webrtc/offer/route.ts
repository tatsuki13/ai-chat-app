import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../../lib/remote-mic/config";
import { getActiveFixedRemoteMicSession } from "../../../../../../lib/remote-mic/fixed-session";
import {
  createRemoteMicWebRtcOffer,
  getRemoteMicWebRtcAnswer,
} from "../../../../../../lib/remote-mic/webrtc-signaling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
    offer?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(body?.role);

  if (!sessionId || !role || !body?.offer) {
    return NextResponse.json(
      { error: "sessionId, role, and offer are required" },
      { status: 400 },
    );
  }

  const validation = validateFixedRemoteMicSession(sessionId);
  if (validation) return validation;

  const offer = createRemoteMicWebRtcOffer({
    sessionId,
    role,
    offer: body.offer,
  });

  return NextResponse.json({ peerId: offer.peerId });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";
  const role = parseRemoteMicRole(params.get("role") ?? "");
  const peerId = params.get("peerId")?.trim() ?? "";

  if (!sessionId || !role || !peerId) {
    return NextResponse.json(
      { error: "sessionId, role, and peerId are required" },
      { status: 400 },
    );
  }

  const validation = validateFixedRemoteMicSession(sessionId);
  if (validation) return validation;

  return NextResponse.json({
    answer: getRemoteMicWebRtcAnswer({
      sessionId,
      role,
      peerId,
    }),
  });
}

function validateFixedRemoteMicSession(sessionId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    return NextResponse.json({ error: "sessionId is invalid" }, { status: 400 });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  return null;
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

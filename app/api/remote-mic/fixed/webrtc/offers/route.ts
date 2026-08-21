import { NextResponse } from "next/server";
import { getActiveFixedRemoteMicSession } from "../../../../../../lib/remote-mic/fixed-session";
import { listRemoteMicWebRtcOffers } from "../../../../../../lib/remote-mic/webrtc-signaling";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId || !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  return NextResponse.json({
    offers: listRemoteMicWebRtcOffers(sessionId),
  });
}

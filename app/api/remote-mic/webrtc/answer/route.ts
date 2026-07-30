import { NextResponse } from "next/server";
import { setRemoteMicWebRtcAnswer } from "../../../../../lib/remote-mic/webrtc-signaling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    peerId?: string;
    answer?: unknown;
  } | null;
  const sessionId = body?.sessionId?.trim() ?? "";
  const peerId = body?.peerId?.trim() ?? "";

  if (
    !sessionId ||
    !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId) ||
    !peerId ||
    !body?.answer
  ) {
    return NextResponse.json(
      { error: "sessionId, peerId, and answer are required" },
      { status: 400 },
    );
  }

  const offer = setRemoteMicWebRtcAnswer({
    sessionId,
    peerId,
    answer: body.answer,
  });

  if (!offer) {
    return NextResponse.json({ error: "offer not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

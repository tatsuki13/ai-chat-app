import { NextResponse } from "next/server";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import { consumeRemoteMicRecognizedTexts } from "../../../../../lib/remote-mic/text-relay";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ texts: [] });
  }

  return NextResponse.json({
    texts: consumeRemoteMicRecognizedTexts(sessionId),
  });
}

import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import { addRemoteMicRecognizedText } from "../../../../../lib/remote-mic/text-relay";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
    text?: unknown;
    recognizedAt?: unknown;
    clientTextId?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));
  const text = requiredString(body?.text);
  const recognizedAt = requiredString(body?.recognizedAt) || new Date().toISOString();
  const clientTextId = requiredString(body?.clientTextId);

  if (!sessionId || !role || !text || !clientTextId) {
    return NextResponse.json(
      { error: "sessionId, role, text, and clientTextId are required" },
      { status: 400 },
    );
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  const item = addRemoteMicRecognizedText({
    sessionId,
    role,
    text,
    recognizedAt,
    clientTextId,
  });

  return NextResponse.json({ ok: true, text: item });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

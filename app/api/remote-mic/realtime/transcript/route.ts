import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import { prisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
    transcriptId?: unknown;
    text?: unknown;
    status?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
    eventId?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));
  const transcriptId = requiredString(body?.transcriptId);
  const text = requiredString(body?.text);
  const status = parseTranscriptStatus(requiredString(body?.status));

  if (!sessionId || !role || !transcriptId || status !== "final") {
    return NextResponse.json(
      { error: "sessionId, role, transcriptId, and final status are required" },
      { status: 400 },
    );
  }

  if (!text) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  const source = `remote_realtime:${transcriptId}`;
  const existing = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId,
      source,
    },
  });

  const utterance =
    existing ??
    (await prisma.sessionUtterance.create({
      data: {
        sessionId,
        participantCode: active.participantCode,
        speaker: role,
        text,
        source,
      },
    }));

  console.info("[remote-mic realtime transcript saved]", {
    sessionId,
    role,
    transcriptId,
    textLength: text.length,
    duplicate: Boolean(existing),
  });

  return NextResponse.json({
    ok: true,
    utterance: {
      id: utterance.id,
      session_id: utterance.sessionId,
      speaker: utterance.speaker,
      text: utterance.text,
      created_at: utterance.createdAt.toISOString(),
    },
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTranscriptStatus(value: string) {
  return value === "partial" || value === "final" ? value : null;
}

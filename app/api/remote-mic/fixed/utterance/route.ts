import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import {
  getActiveFixedRemoteMicSession,
  updateFixedRemoteMicRole,
} from "../../../../../lib/remote-mic/fixed-session";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    role?: unknown;
    sessionId?: unknown;
    text?: unknown;
    recognizedAt?: unknown;
    recognized_at?: unknown;
  } | null;
  const role = parseRemoteMicRole(requiredString(body?.role));
  const sessionId = requiredString(body?.sessionId);
  const text = requiredString(body?.text);
  const recognizedAt = optionalDate(body?.recognizedAt ?? body?.recognized_at);

  if (!role || !sessionId || !text) {
    return NextResponse.json(
      { error: "role, sessionId, and text are required" },
      { status: 400 },
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "text is too long" }, { status: 413 });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.roles[role].muted) {
    return NextResponse.json({ error: "microphone is not transmitting" }, { status: 409 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      participantCode: true,
      endedAt: true,
      dialogueStartedAt: true,
    },
  });

  if (!session || session.endedAt || !session.dialogueStartedAt) {
    return NextResponse.json({ error: "Session is not accepting utterances" }, { status: 409 });
  }

  const utterance = await prisma.sessionUtterance.create({
    data: {
      sessionId: session.id,
      speaker: role,
      text,
      createdAt: recognizedAt ?? undefined,
    },
  });
  updateFixedRemoteMicRole(role, {
    connectedAt: Date.now(),
    transmitting: true,
    muted: false,
  });

  return NextResponse.json({
    utterance: {
      id: utterance.id,
      session_id: utterance.sessionId,
      participant_id: session.participantCode,
      speaker: utterance.speaker,
      text: utterance.text,
      created_at: utterance.createdAt.toISOString(),
    },
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue)
    : new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

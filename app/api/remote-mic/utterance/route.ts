import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  authenticateRemoteMicRequest,
  remoteMicErrorResponse,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 4000;

export async function POST(request: Request) {
  try {
    const remoteMic = await authenticateRemoteMicRequest();
    const body = (await request.json().catch(() => null)) as {
      text?: unknown;
      recognized_at?: unknown;
      recognizedAt?: unknown;
    } | null;
    const text = requiredString(body?.text);
    const recognizedAt = optionalDate(body?.recognized_at ?? body?.recognizedAt);

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: "text is too long" }, { status: 413 });
    }

    const utterance = await prisma.sessionUtterance.create({
      data: {
        sessionId: remoteMic.sessionId,
        speaker: remoteMic.role,
        text,
        createdAt: recognizedAt ?? undefined,
      },
    });

    console.info("[remote-mic utterance saved]", {
      role: remoteMic.role,
      textLength: text.length,
    });

    return NextResponse.json({
      utterance: {
        id: utterance.id,
        session_id: utterance.sessionId,
        speaker: utterance.speaker,
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    console.error("[remote-mic utterance failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      status: response.status,
    });

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
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

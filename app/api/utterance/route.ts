import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { normalizeConversationSpeaker } from "../../../lib/acp-mvp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);
    const rawSpeaker = requiredString(body.speaker);
    const speaker = normalizeSpeaker(rawSpeaker);
    const text = requiredString(body.text);

    if (!sessionId || !isSpeaker(rawSpeaker) || !text) {
      return NextResponse.json(
        { error: "session_id, speaker, and text are required" },
        { status: 400 },
      );
    }

    const utterance = await prisma.sessionUtterance.create({
      data: {
        sessionId,
        speaker,
        text,
      },
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
    console.error(error);

    return NextResponse.json(
      { error: "Failed to save utterance" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpeaker(value: string) {
  return normalizeConversationSpeaker(value);
}

function isSpeaker(value: string): value is "A" | "B" | "elder" | "caregiver" {
  return (
    value === "A" ||
    value === "B" ||
    value === "elder" ||
    value === "caregiver"
  );
}

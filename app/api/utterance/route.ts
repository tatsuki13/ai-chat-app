import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);
    const speaker = requiredString(body.speaker);
    const text = requiredString(body.text);

    if (!sessionId || !speaker || !text) {
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

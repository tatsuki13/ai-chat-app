import { NextResponse } from "next/server";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const rawSpeaker = requiredString(body.speaker);
    const speaker = normalizeSpeaker(rawSpeaker);
    const text = requiredString(body.text);

    if (!isSpeaker(rawSpeaker) || !text) {
      return NextResponse.json(
        { error: "speaker and text are required" },
        { status: 400 },
      );
    }

    const utterance = await prisma.sessionUtterance.update({
      where: { id },
      data: {
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
    console.error("Failed to update utterance", error);

    return NextResponse.json(
      { error: "Failed to update utterance" },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const utterance = await prisma.sessionUtterance.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!utterance) {
      return NextResponse.json({ error: "Utterance not found" }, { status: 404 });
    }

    await prisma.sessionUtterance.delete({
      where: { id },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete utterance", error);

    return NextResponse.json(
      { error: "Failed to delete utterance" },
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

function isSpeaker(value: string): value is "elder" | "caregiver" {
  return value === "elder" || value === "caregiver";
}

import { NextResponse } from "next/server";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";
import {
  deleteStudyUtteranceForAppUtterance,
  saveStudyUtteranceForAppUtterance,
} from "../../../../lib/research-store";

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
    await saveStudyUtteranceForAppUtterance({
      id: utterance.id,
      sessionId: utterance.sessionId,
      speaker: utterance.speaker,
      text: utterance.text,
      createdAt: utterance.createdAt,
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
        sessionId: true,
      },
    });

    if (!utterance) {
      return NextResponse.json({ error: "Utterance not found" }, { status: 404 });
    }

    await deleteStudyUtteranceForAppUtterance(utterance.id, utterance.sessionId);
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

function isSpeaker(value: string): value is "A" | "B" | "elder" | "caregiver" {
  return (
    value === "A" ||
    value === "B" ||
    value === "elder" ||
    value === "caregiver"
  );
}

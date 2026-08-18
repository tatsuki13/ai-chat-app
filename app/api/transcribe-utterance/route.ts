import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { normalizeConversationSpeaker } from "../../../lib/acp-mvp";
import { transcribeAudioFile } from "../../../lib/server/transcription/transcribe-audio";
import { requireSessionAccess } from "../../../lib/auth";

export const runtime = "nodejs";

const MIN_AUDIO_BYTES = 512;

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is required for audio transcription" },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const sessionId = requiredString(formData.get("session_id"));
    const rawSpeaker = requiredString(formData.get("speaker"));
    const speaker = normalizeSpeaker(rawSpeaker);
    const audio = formData.get("audio");
    const startedAt = optionalDate(formData.get("started_at"));

    if (!sessionId || !isSpeaker(rawSpeaker) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "session_id, speaker, and audio are required" },
        { status: 400 },
      );
    }

    const auth = await requireSessionAccess(request, sessionId);
    if ("response" in auth) return auth.response;

    if (audio.size < MIN_AUDIO_BYTES) {
      return NextResponse.json({
        skipped: true,
        speaker,
        transcript: "",
      });
    }

    const transcript = await transcribeAudioFile(audio);

    if (!transcript) {
      return NextResponse.json({
        skipped: true,
        speaker,
        transcript: "",
      });
    }

    const utterance = await prisma.sessionUtterance.create({
      data: {
        sessionId,
        speaker,
        text: transcript,
        createdAt: startedAt ?? undefined,
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
      speaker,
      transcript,
    });
  } catch (error) {
    console.error("Failed to transcribe utterance", error);

    return NextResponse.json(
      { error: "Failed to transcribe utterance" },
      { status: 500 },
    );
  }
}

function requiredString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalDate(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSpeaker(value: string) {
  return normalizeConversationSpeaker(value);
}

function isSpeaker(value: string): value is "elder" | "caregiver" {
  return value === "elder" || value === "caregiver";
}

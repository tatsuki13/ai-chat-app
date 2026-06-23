import OpenAI from "openai";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { saveStudyUtteranceForAppUtterance } from "../../../lib/research-store";

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
    const speaker = requiredString(formData.get("speaker"));
    const audio = formData.get("audio");

    if (!sessionId || !isSpeaker(speaker) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "session_id, speaker, and audio are required" },
        { status: 400 },
      );
    }

    if (audio.size < MIN_AUDIO_BYTES) {
      return NextResponse.json({
        skipped: true,
        speaker,
        transcript: "",
      });
    }

    const transcript = normalizeTranscript(
      await transcribeAudio(apiKey, audio),
    );

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

async function transcribeAudio(apiKey: string, audio: File) {
  const openai = new OpenAI({
    apiKey,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 20000),
  });
  const transcription = await openai.audio.transcriptions.create({
    file: audio,
    model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
    language: "ja",
    prompt:
      "Japanese ACP conversation. Transcribe only spoken words and ignore silence or device noise.",
  });

  if (
    typeof transcription === "object" &&
    transcription !== null &&
    "text" in transcription
  ) {
    return String(transcription.text ?? "");
  }

  return String(transcription ?? "");
}

function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function requiredString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function isSpeaker(value: string): value is "elder" | "caregiver" {
  return value === "elder" || value === "caregiver";
}

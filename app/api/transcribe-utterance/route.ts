import OpenAI from "openai";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { normalizeConversationSpeaker } from "../../../lib/acp-mvp";
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
        createdAt: startedAt ?? undefined,
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

function isSpeaker(value: string): value is "A" | "B" | "elder" | "caregiver" {
  return (
    value === "A" ||
    value === "B" ||
    value === "elder" ||
    value === "caregiver"
  );
}

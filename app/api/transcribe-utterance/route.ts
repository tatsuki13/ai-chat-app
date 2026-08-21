import { NextResponse } from "next/server";
import { normalizeConversationSpeaker } from "../../../lib/acp-mvp";
import { transcribeAudioFile } from "../../../lib/server/transcription/transcribe-audio";

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
    const rawSpeaker = requiredString(formData.get("speaker"));
    const speaker = normalizeSpeaker(rawSpeaker);
    const audio = formData.get("audio");

    if (!isSpeaker(rawSpeaker) || !(audio instanceof File)) {
      return NextResponse.json(
        { error: "speaker and audio are required" },
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

    const transcript = await transcribeAudioFile(audio);

    if (!transcript) {
      return NextResponse.json({
        skipped: true,
        speaker,
        transcript: "",
      });
    }

    return NextResponse.json({
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

function normalizeSpeaker(value: string) {
  return normalizeConversationSpeaker(value);
}

function isSpeaker(value: string): value is "elder" | "caregiver" {
  return value === "elder" || value === "caregiver";
}

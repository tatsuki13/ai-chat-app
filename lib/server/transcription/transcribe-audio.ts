import OpenAI from "openai";

export async function transcribeAudioFile(audio: File) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for audio transcription");
  }

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
    return normalizeTranscript(String(transcription.text ?? ""));
  }

  return normalizeTranscript(String(transcription ?? ""));
}

export function normalizeTranscript(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

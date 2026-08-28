import {
  createOpenAIClient,
  getDefaultOpenAITimeoutMs,
} from "../../ai/client";
import { getTranscribeModel, getTranscribePrompt } from "./config";

export async function transcribeAudioFile(audio: File) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = getTranscribeModel();

  if (!apiKey) {
    throw new TranscriptionConfigurationError(
      "Audio transcription is not configured",
    );
  }

  const openai = createOpenAIClient({
    apiKey,
    timeout: getDefaultOpenAITimeoutMs(),
  });

  console.info("[pc-stt] transcription request", {
    configured: true,
    model,
    fileName: audio.name,
    fileType: audio.type,
    fileSize: audio.size,
  });

  let transcription: unknown;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: audio,
      model,
      language: "ja",
      prompt: getTranscribePrompt(),
    });
  } catch (error) {
    console.error("[pc-stt] transcription failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      status:
        typeof error === "object" &&
        error !== null &&
        "status" in error
          ? String(error.status)
          : undefined,
      code:
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : undefined,
    });

    throw error;
  }

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

export class TranscriptionConfigurationError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "TranscriptionConfigurationError";
  }
}

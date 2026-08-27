import { getTranscribePrompt } from "../server/transcription/config";

const DEFAULT_REALTIME_TRANSCRIBE_MODEL = "whisper-1";
const DEFAULT_REALTIME_VAD_SILENCE_MS = 1600;
const DEFAULT_REALTIME_VAD_THRESHOLD = 0.65;
const WHISPER_REALTIME_PROMPT = [
  "ACP",
  "アドバンス・ケア・プランニング",
  "日本語",
  "医療",
  "介護",
  "在宅",
  "施設",
  "救急搬送",
  "延命治療",
  "家族",
  "希望",
].join(", ");

export function getRealtimeTranscribeModel() {
  return (
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
    DEFAULT_REALTIME_TRANSCRIBE_MODEL
  );
}

export function getRealtimeTranscribePrompt() {
  if (process.env.OPENAI_REALTIME_TRANSCRIBE_PROMPT) {
    return process.env.OPENAI_REALTIME_TRANSCRIBE_PROMPT;
  }

  return getRealtimeTranscribeModel() === "whisper-1"
    ? WHISPER_REALTIME_PROMPT
    : getTranscribePrompt();
}

export function getRealtimeVadSilenceMs() {
  const value = Number(process.env.OPENAI_REALTIME_VAD_SILENCE_MS);

  return Number.isFinite(value) && value >= 300 && value <= 2000
    ? value
    : DEFAULT_REALTIME_VAD_SILENCE_MS;
}

export function getRealtimeVadThreshold() {
  const value = Number(process.env.OPENAI_REALTIME_VAD_THRESHOLD);

  return Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_REALTIME_VAD_THRESHOLD;
}

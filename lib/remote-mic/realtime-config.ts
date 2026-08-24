import { getTranscribePrompt } from "../server/transcription/config";

const DEFAULT_REALTIME_TRANSCRIBE_MODEL = "whisper-1";
const DEFAULT_REALTIME_VAD_SILENCE_MS = 1600;
const DEFAULT_REALTIME_VAD_THRESHOLD = 0.65;
const WHISPER_REALTIME_PROMPT = [
  "ACP",
  "advance care planning",
  "Japanese",
  "medical care",
  "nursing care",
  "home care",
  "facility care",
  "emergency transport",
  "life-sustaining treatment",
  "family",
  "wishes",
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

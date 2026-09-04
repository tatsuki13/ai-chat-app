import { getTranscribePrompt } from "../server/transcription/config";

const DEFAULT_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const DEFAULT_REALTIME_VAD_SILENCE_MS = 700;
const DEFAULT_REALTIME_VAD_THRESHOLD = 0.5;

export function getRealtimeTranscribeModel() {
  return (
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
    DEFAULT_REALTIME_TRANSCRIBE_MODEL
  );
}

export function getRealtimeTranscribePrompt() {
  return process.env.OPENAI_REALTIME_TRANSCRIBE_PROMPT || getTranscribePrompt();
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

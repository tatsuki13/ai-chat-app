import { getTranscribeModel } from "../server/transcription/config";

const DEFAULT_REALTIME_VAD_SILENCE_MS = 1600;
const DEFAULT_REALTIME_VAD_THRESHOLD = 0.65;

export function getRealtimeTranscribeModel() {
  return getTranscribeModel();
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

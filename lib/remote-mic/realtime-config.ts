export const DEFAULT_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

export function getRealtimeTranscribeModel() {
  return (
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
    DEFAULT_REALTIME_TRANSCRIBE_MODEL
  );
}

export function getRealtimeVadSilenceMs() {
  const value = Number(process.env.OPENAI_REALTIME_VAD_SILENCE_MS);

  return Number.isFinite(value) && value >= 300 && value <= 2000 ? value : 700;
}

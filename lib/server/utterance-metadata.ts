export const UTTERANCE_ANALYSIS_VERSION = "utterance-timing-v1";

const UTTERANCE_SOURCES = new Set([
  "manual",
  "local_voice",
  // Legacy compatibility only. New fixed smartphone utterances use remote_local_asr.
  "remote_realtime",
  "remote_local_asr",
]);

export function normalizeUtteranceSource(
  value: unknown,
  fallback: "manual" | "local_voice" | "remote_realtime" | "remote_local_asr",
) {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();

  // Legacy compatibility only. Do not use remote_realtime for new utterances.
  if (trimmed.startsWith("remote_realtime:")) return trimmed;
  if (trimmed.startsWith("remote_local_asr:")) return trimmed;
  if (UTTERANCE_SOURCES.has(trimmed)) return trimmed;

  return fallback;
}

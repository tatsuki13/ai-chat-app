export const UTTERANCE_ANALYSIS_VERSION = "utterance-timing-v1";

const UTTERANCE_SOURCES = new Set([
  "manual",
  "local_voice",
  "remote_realtime",
]);

export function normalizeUtteranceSource(
  value: unknown,
  fallback: "manual" | "local_voice" | "remote_realtime",
) {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();

  if (trimmed.startsWith("remote_realtime:")) return trimmed;
  if (UTTERANCE_SOURCES.has(trimmed)) return trimmed;

  return fallback;
}

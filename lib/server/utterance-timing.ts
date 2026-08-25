export type UtteranceTiming = {
  startMs: number;
  endMs: number;
};

export function createUtteranceTiming(input: {
  baseAt: Date | string;
  startedAt?: Date | string | number | null;
  endedAt?: Date | string | number | null;
  fallbackAt?: Date | string | number | null;
}): UtteranceTiming {
  const baseMs = parseTimestampMs(input.baseAt) ?? Date.now();
  const fallbackMs = parseTimestampMs(input.fallbackAt) ?? Date.now();
  const startedAtMs = parseTimestampMs(input.startedAt) ?? fallbackMs;
  const endedAtMs = parseTimestampMs(input.endedAt) ?? startedAtMs;
  const startMs = Math.max(0, Math.round(startedAtMs - baseMs));
  const endMs = Math.max(startMs, Math.round(endedAtMs - baseMs));

  return {
    startMs,
    endMs,
  };
}

export function pickUtteranceTimingBase(input: {
  dialogueStartedAt?: Date | string | null;
  startedAt: Date | string;
}) {
  return input.startedAt;
}

function parseTimestampMs(value: Date | string | number | null | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

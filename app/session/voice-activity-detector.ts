export type VoiceActivityConfig = {
  startThreshold: number;
  endThreshold: number;
  minimumSpeechMs: number;
  trailingSilenceMs: number;
  maximumSegmentMs: number;
};

export type VoiceActivitySegment = {
  startedAtMs: number;
  endedAtMs: number;
};

type VoiceActivityCallbacks = {
  onSpeechStart: (segmentStartedAtMs: number) => void;
  onSpeechEnd: (segment: VoiceActivitySegment) => void;
};

export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  startThreshold: 0.045,
  endThreshold: 0.024,
  minimumSpeechMs: 350,
  trailingSilenceMs: 800,
  maximumSegmentMs: 20000,
};

export function createVoiceActivityDetector(
  callbacks: VoiceActivityCallbacks,
  config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG,
) {
  let active = false;
  let candidateStartedAtMs: number | null = null;
  let segmentStartedAtMs = 0;
  let lastVoiceAtMs = 0;

  function update(level: number, atMs: number) {
    if (!active) {
      if (level >= config.startThreshold) {
        candidateStartedAtMs ??= atMs;
        if (atMs - candidateStartedAtMs >= config.minimumSpeechMs) {
          active = true;
          segmentStartedAtMs = candidateStartedAtMs;
          lastVoiceAtMs = atMs;
          callbacks.onSpeechStart(segmentStartedAtMs);
        }
      } else {
        candidateStartedAtMs = null;
      }
      return;
    }

    if (level >= config.endThreshold) {
      lastVoiceAtMs = atMs;
    }

    const silentForMs = atMs - lastVoiceAtMs;
    const segmentAgeMs = atMs - segmentStartedAtMs;
    if (
      silentForMs >= config.trailingSilenceMs ||
      segmentAgeMs >= config.maximumSegmentMs
    ) {
      callbacks.onSpeechEnd({
        startedAtMs: segmentStartedAtMs,
        endedAtMs: lastVoiceAtMs || atMs,
      });
      active = false;
      candidateStartedAtMs = null;
      segmentStartedAtMs = 0;
      lastVoiceAtMs = 0;
    }
  }

  function forceEnd(atMs: number) {
    if (!active) {
      candidateStartedAtMs = null;
      return;
    }

    callbacks.onSpeechEnd({
      startedAtMs: segmentStartedAtMs,
      endedAtMs: atMs,
    });
    active = false;
    candidateStartedAtMs = null;
    segmentStartedAtMs = 0;
    lastVoiceAtMs = 0;
  }

  return {
    update,
    forceEnd,
    isActive: () => active,
  };
}

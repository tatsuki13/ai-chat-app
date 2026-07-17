export type ConversationSpeaker = "elder" | "caregiver";
export type StoredConversationSpeaker = ConversationSpeaker | "unknown";
export type CameraSide = "left" | "right";

export type ParticipantLayout = {
  leftSpeaker: ConversationSpeaker;
  rightSpeaker: ConversationSpeaker;
};

export type SessionClock = {
  sessionStartedAtEpochMs: number;
  sessionStartedAtMonotonicMs: number;
};

export const DEFAULT_PARTICIPANT_LAYOUT: ParticipantLayout = {
  leftSpeaker: "elder",
  rightSpeaker: "caregiver",
};

export async function startSharedMediaStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("media devices are not available in this browser");
  }

  return navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15 },
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

export function createSessionClock(): SessionClock {
  return {
    sessionStartedAtEpochMs: Date.now(),
    sessionStartedAtMonotonicMs: performance.now(),
  };
}

export function monotonicToSessionOffsetMs(clock: SessionClock, at = performance.now()) {
  return Math.max(0, Math.round(at - clock.sessionStartedAtMonotonicMs));
}

export function speakerFromSide(
  side: CameraSide,
  layout: ParticipantLayout,
): ConversationSpeaker {
  return side === "left" ? layout.leftSpeaker : layout.rightSpeaker;
}

export function otherSpeaker(speaker: ConversationSpeaker): ConversationSpeaker {
  return speaker === "elder" ? "caregiver" : "elder";
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

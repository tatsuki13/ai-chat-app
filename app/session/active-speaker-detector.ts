import {
  speakerFromSide,
  type ParticipantLayout,
  type StoredConversationSpeaker,
} from "./media-session-service";
import type { LipActivityFrame } from "./lip-activity-service";

export type DetectedSpeaker =
  | "elder"
  | "caregiver"
  | "unknown"
  | "overlap"
  | "silence";

export type LipActivitySummary = {
  segmentStartedAtMs: number;
  segmentEndedAtMs: number;
  leftActiveMs: number;
  rightActiveMs: number;
  bothActiveMs: number;
  neitherActiveMs: number;
  leftScore: number;
  rightScore: number;
  leftFaceVisibilityRate: number;
  rightFaceVisibilityRate: number;
};

export type SpeakerDetectionResult = {
  detectedSpeaker: Exclude<DetectedSpeaker, "silence">;
  confidence: number;
  leftLipScore: number;
  rightLipScore: number;
  leftFaceVisibilityRate: number;
  rightFaceVisibilityRate: number;
  detectionReason:
    | "left_dominant"
    | "right_dominant"
    | "both_active"
    | "insufficient_difference"
    | "left_face_missing"
    | "right_face_missing"
    | "both_faces_missing"
    | "insufficient_lip_activity";
};

const ACTIVE_THRESHOLD = 0.22;
const DOMINANCE_MARGIN = 0.14;
const MIN_FACE_VISIBILITY = 0.35;
const MIN_LIP_SCORE = 0.08;

export function summarizeLipActivity(
  frames: LipActivityFrame[],
  segmentStartedAtMs: number,
  segmentEndedAtMs: number,
): LipActivitySummary {
  const segmentFrames = frames.filter(
    (frame) =>
      frame.timestampMs >= segmentStartedAtMs &&
      frame.timestampMs <= segmentEndedAtMs,
  );
  if (segmentFrames.length === 0) {
    return {
      segmentStartedAtMs,
      segmentEndedAtMs,
      leftActiveMs: 0,
      rightActiveMs: 0,
      bothActiveMs: 0,
      neitherActiveMs: segmentEndedAtMs - segmentStartedAtMs,
      leftScore: 0,
      rightScore: 0,
      leftFaceVisibilityRate: 0,
      rightFaceVisibilityRate: 0,
    };
  }

  let leftScore = 0;
  let rightScore = 0;
  let leftVisible = 0;
  let rightVisible = 0;
  let leftActiveMs = 0;
  let rightActiveMs = 0;
  let bothActiveMs = 0;
  let neitherActiveMs = 0;

  for (let index = 0; index < segmentFrames.length; index += 1) {
    const frame = segmentFrames[index];
    const nextFrame = segmentFrames[index + 1];
    const duration = Math.max(
      16,
      (nextFrame?.timestampMs ?? segmentEndedAtMs) - frame.timestampMs,
    );
    const leftActive = frame.leftSpeakingLikelihood >= ACTIVE_THRESHOLD;
    const rightActive = frame.rightSpeakingLikelihood >= ACTIVE_THRESHOLD;

    leftScore += frame.leftSpeakingLikelihood;
    rightScore += frame.rightSpeakingLikelihood;
    if (frame.leftFaceVisible) leftVisible += 1;
    if (frame.rightFaceVisible) rightVisible += 1;
    if (leftActive) leftActiveMs += duration;
    if (rightActive) rightActiveMs += duration;
    if (leftActive && rightActive) bothActiveMs += duration;
    if (!leftActive && !rightActive) neitherActiveMs += duration;
  }

  return {
    segmentStartedAtMs,
    segmentEndedAtMs,
    leftActiveMs,
    rightActiveMs,
    bothActiveMs,
    neitherActiveMs,
    leftScore: leftScore / segmentFrames.length,
    rightScore: rightScore / segmentFrames.length,
    leftFaceVisibilityRate: leftVisible / segmentFrames.length,
    rightFaceVisibilityRate: rightVisible / segmentFrames.length,
  };
}

export function detectSpeakerFromLipActivity(
  summary: LipActivitySummary,
  layout: ParticipantLayout,
): SpeakerDetectionResult {
  const leftVisible = summary.leftFaceVisibilityRate >= MIN_FACE_VISIBILITY;
  const rightVisible = summary.rightFaceVisibilityRate >= MIN_FACE_VISIBILITY;
  const leftScore = summary.leftScore;
  const rightScore = summary.rightScore;
  const difference = Math.abs(leftScore - rightScore);

  if (!leftVisible && !rightVisible) {
    return baseResult(summary, "unknown", 0, "both_faces_missing");
  }
  if (!leftVisible) return baseResult(summary, "unknown", 0.2, "left_face_missing");
  if (!rightVisible) return baseResult(summary, "unknown", 0.2, "right_face_missing");
  if (leftScore < MIN_LIP_SCORE && rightScore < MIN_LIP_SCORE) {
    return baseResult(summary, "unknown", 0.15, "insufficient_lip_activity");
  }
  if (
    summary.bothActiveMs > 0 &&
    summary.bothActiveMs >= Math.max(summary.leftActiveMs, summary.rightActiveMs) * 0.55
  ) {
    return baseResult(summary, "overlap", 0.55, "both_active");
  }
  if (difference < DOMINANCE_MARGIN) {
    return baseResult(summary, "unknown", Math.max(0.2, difference), "insufficient_difference");
  }
  if (leftScore > rightScore) {
    return baseResult(
      summary,
      speakerFromSide("left", layout),
      Math.min(0.95, 0.55 + difference),
      "left_dominant",
    );
  }

  return baseResult(
    summary,
    speakerFromSide("right", layout),
    Math.min(0.95, 0.55 + difference),
    "right_dominant",
  );
}

export function toStoredConversationSpeaker(
  speaker: DetectedSpeaker,
): StoredConversationSpeaker {
  return speaker === "elder" || speaker === "caregiver" ? speaker : "unknown";
}

function baseResult(
  summary: LipActivitySummary,
  detectedSpeaker: SpeakerDetectionResult["detectedSpeaker"],
  confidence: number,
  detectionReason: SpeakerDetectionResult["detectionReason"],
): SpeakerDetectionResult {
  return {
    detectedSpeaker,
    confidence,
    leftLipScore: summary.leftScore,
    rightLipScore: summary.rightScore,
    leftFaceVisibilityRate: summary.leftFaceVisibilityRate,
    rightFaceVisibilityRate: summary.rightFaceVisibilityRate,
    detectionReason,
  };
}

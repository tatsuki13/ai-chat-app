import { monotonicToSessionOffsetMs, type SessionClock } from "./media-session-service";

export type LipActivityFrame = {
  timestampMs: number;
  leftFaceVisible: boolean;
  rightFaceVisible: boolean;
  leftMouthOpenRatio: number;
  rightMouthOpenRatio: number;
  leftLipMovementScore: number;
  rightLipMovementScore: number;
  leftSpeakingLikelihood: number;
  rightSpeakingLikelihood: number;
};

type LipActivityCallback = (frame: LipActivityFrame) => void;

const SAMPLE_WIDTH = 192;
const SAMPLE_HEIGHT = 108;
const MIN_LIGHT_VARIANCE = 3.5;

export function createLipActivityService(
  video: HTMLVideoElement,
  clock: SessionClock,
) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const callbacks = new Set<LipActivityCallback>();
  let previousLeft: Float32Array | null = null;
  let previousRight: Float32Array | null = null;
  let frameId = 0;
  let running = false;
  let latestFrame: LipActivityFrame | null = null;

  function start() {
    if (running) return;
    running = true;
    tick();
  }

  function stop() {
    running = false;
    window.cancelAnimationFrame(frameId);
    previousLeft = null;
    previousRight = null;
  }

  function onFrame(callback: LipActivityCallback) {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  }

  function tick() {
    if (!running) return;

    const frame = sampleFrame();
    if (frame) {
      latestFrame = frame;
      callbacks.forEach((callback) => callback(frame));
    }

    frameId = window.requestAnimationFrame(tick);
  }

  function sampleFrame(): LipActivityFrame | null {
    if (!context || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }

    context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);

    const left = sampleRegion(context, 0, SAMPLE_WIDTH / 2);
    const right = sampleRegion(context, SAMPLE_WIDTH / 2, SAMPLE_WIDTH / 2);
    const leftMovement = previousLeft ? frameDiff(left.samples, previousLeft) : 0;
    const rightMovement = previousRight ? frameDiff(right.samples, previousRight) : 0;

    previousLeft = left.samples;
    previousRight = right.samples;

    const leftFaceVisible = left.variance > MIN_LIGHT_VARIANCE;
    const rightFaceVisible = right.variance > MIN_LIGHT_VARIANCE;
    const leftMouthOpenRatio = left.darkRatio;
    const rightMouthOpenRatio = right.darkRatio;
    const leftSpeakingLikelihood = toLikelihood(leftMovement, leftMouthOpenRatio, leftFaceVisible);
    const rightSpeakingLikelihood = toLikelihood(rightMovement, rightMouthOpenRatio, rightFaceVisible);

    return {
      timestampMs: monotonicToSessionOffsetMs(clock),
      leftFaceVisible,
      rightFaceVisible,
      leftMouthOpenRatio,
      rightMouthOpenRatio,
      leftLipMovementScore: leftMovement,
      rightLipMovementScore: rightMovement,
      leftSpeakingLikelihood,
      rightSpeakingLikelihood,
    };
  }

  return {
    start,
    stop,
    onFrame,
    getLatestFrame() {
      return latestFrame;
    },
  };
}

function sampleRegion(
  context: CanvasRenderingContext2D,
  x: number,
  width: number,
) {
  const y = Math.floor(SAMPLE_HEIGHT * 0.45);
  const height = Math.floor(SAMPLE_HEIGHT * 0.36);
  const image = context.getImageData(x, y, width, height);
  const samples = new Float32Array(width * height);
  let sum = 0;
  let darkPixels = 0;

  for (let index = 0, pixel = 0; index < image.data.length; index += 4, pixel += 1) {
    const value =
      image.data[index] * 0.2126 +
      image.data[index + 1] * 0.7152 +
      image.data[index + 2] * 0.0722;
    samples[pixel] = value;
    sum += value;
    if (value < 72) darkPixels += 1;
  }

  const mean = sum / samples.length;
  let varianceSum = 0;
  for (const value of samples) {
    varianceSum += (value - mean) ** 2;
  }

  return {
    samples,
    variance: Math.sqrt(varianceSum / samples.length),
    darkRatio: darkPixels / samples.length,
  };
}

function frameDiff(current: Float32Array, previous: Float32Array) {
  let diff = 0;
  for (let index = 0; index < current.length; index += 1) {
    diff += Math.abs(current[index] - previous[index]);
  }

  return Math.min(1, diff / current.length / 28);
}

function toLikelihood(movement: number, mouthOpenRatio: number, visible: boolean) {
  if (!visible) return 0;

  return Math.max(0, Math.min(1, movement * 0.82 + mouthOpenRatio * 0.18));
}

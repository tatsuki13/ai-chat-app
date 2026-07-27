import {
  createVoiceActivityDetector,
  type VoiceActivitySegment,
} from "./voice-activity-detector";
import type { SpeakerRole } from "./remote-microphone-service";

export type RemoteAudioChunk = {
  speaker: SpeakerRole;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  endedAt: number;
  sequence: number;
};

type RemoteAudioInputOptions = {
  role: SpeakerRole;
  stream: MediaStream;
  onChunk: (chunk: RemoteAudioChunk) => void;
  onLevel: (role: SpeakerRole, level: number) => void;
  onError: (role: SpeakerRole, error: Error) => void;
};

export function startRemoteAudioInput(options: RemoteAudioInputOptions) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is not available in this browser");
  }

  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser");
  }

  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(options.stream);
  const analyser = context.createAnalyser();
  const silentGain = context.createGain();
  const mimeType = getSupportedAudioMimeType();
  let frameId = 0;
  let stopped = false;
  let sequence = 0;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let currentSegment: VoiceActivitySegment | null = null;

  analyser.fftSize = 1024;
  const samples = new Float32Array(analyser.fftSize);
  silentGain.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silentGain);
  silentGain.connect(context.destination);

  const vad = createVoiceActivityDetector({
    onSpeechStart(startedAtMs) {
      startRecording(startedAtMs);
    },
    onSpeechEnd(segment) {
      stopRecording(segment);
    },
  });

  if (context.state === "suspended") {
    void context.resume().catch((error) => {
      options.onError(options.role, toError(error));
    });
  }

  tick();

  function tick() {
    if (stopped) return;

    analyser.getFloatTimeDomainData(samples);
    const level = calculateLevel(samples);
    const at = Date.now();

    options.onLevel(options.role, level);
    vad.update(level, at);
    frameId = window.requestAnimationFrame(tick);
  }

  function startRecording(startedAt: number) {
    if (stopped || recorder?.state === "recording") return;

    chunks = [];
    currentSegment = {
      startedAtMs: startedAt,
      endedAtMs: startedAt,
    };
    recorder = new MediaRecorder(
      options.stream,
      mimeType ? { mimeType } : undefined,
    );
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onerror = () => {
      options.onError(options.role, new Error("remote recorder error"));
    };
    recorder.onstop = () => {
      const segment = currentSegment;
      const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type });
      chunks = [];
      currentSegment = null;

      if (!segment || blob.size < 512) return;

      options.onChunk({
        speaker: options.role,
        blob,
        mimeType: blob.type || mimeType,
        startedAt: segment.startedAtMs,
        endedAt: segment.endedAtMs,
        sequence: ++sequence,
      });
    };
    recorder.start();
  }

  function stopRecording(segment: VoiceActivitySegment) {
    currentSegment = segment;
    if (!recorder || recorder.state !== "recording") return;

    try {
      recorder.stop();
    } catch (error) {
      options.onError(options.role, toError(error));
    }
  }

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
    vad.forceEnd(Date.now());
    if (recorder?.state === "recording") {
      try {
        recorder.stop();
      } catch {}
    }
    try {
      source.disconnect();
      analyser.disconnect();
      silentGain.disconnect();
    } catch {}
    void context.close().catch(() => {});
    options.onLevel(options.role, 0);
  };
}

function calculateLevel(samples: Float32Array) {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) peak = absolute;
  }

  const rms = Math.sqrt(sumSquares / samples.length);

  return Math.min(1, Math.max(rms * 8, peak));
}

function getSupportedAudioMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error("remote audio input error");
}

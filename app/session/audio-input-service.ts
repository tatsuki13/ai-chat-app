export type StereoSpeaker = "A" | "B";

export type StereoAudioChunk = {
  speaker: StereoSpeaker;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  endedAt: number;
  sequence: number;
};

export type AudioInputLevel = {
  speaker: StereoSpeaker;
  rms: number;
  peak: number;
  at: number;
};

export type SingleMicAudioChunk = StereoAudioChunk;

export type SingleMicInputLevel = {
  rms: number;
  peak: number;
  at: number;
};

type ChunkCallback = (chunk: StereoAudioChunk) => void;
type LevelCallback = (level: AudioInputLevel) => void;
type SingleMicChunkCallback = (chunk: SingleMicAudioChunk) => void;
type SingleMicLevelCallback = (level: SingleMicInputLevel) => void;

export type AudioInputStartOptions = {
  speakerADeviceId?: string;
  speakerBDeviceId?: string;
};

export type SingleMicInputStartOptions = {
  deviceId?: string;
};

const AUDIO_INPUT_CONFIG_STORAGE_KEY = "acp-audio-input-config-v1";

type StereoInputHandle = {
  streams: MediaStream[];
  context: AudioContext;
  nodes: AudioNode[];
  recorders: MediaRecorder[];
  stopLevelMeter: (() => void) | null;
};

export type StereoInputService = {
  startStereoInput: (options?: AudioInputStartOptions | null) => Promise<void>;
  stopStereoInput: () => void;
  onSpeakerAChunk: (callback: ChunkCallback) => () => void;
  onSpeakerBChunk: (callback: ChunkCallback) => () => void;
  onSpeakerALevel: (callback: LevelCallback) => () => void;
  onSpeakerBLevel: (callback: LevelCallback) => () => void;
  isRunning: () => boolean;
};

type SingleMicInputHandle = {
  stream: MediaStream;
  context: AudioContext;
  nodes: AudioNode[];
  recorder: MediaRecorder;
  stopLevelMeter: (() => void) | null;
};

export type SingleMicInputService = {
  startVoiceInput: (options?: SingleMicInputStartOptions | null) => Promise<void>;
  stopVoiceInput: () => void;
  startCapture: (speaker: StereoSpeaker) => void;
  stopCapture: () => void;
  onChunk: (callback: SingleMicChunkCallback) => () => void;
  onLevel: (callback: SingleMicLevelCallback) => () => void;
  isRunning: () => boolean;
  isCapturing: () => boolean;
};

export async function loadAudioInputs() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("audio input is not available in this browser");
  }

  const permissionStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  for (const track of permissionStream.getTracks()) {
    track.stop();
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const audioInputs = devices.filter((device) => device.kind === "audioinput");

  console.log("audioInputs", audioInputs);

  return audioInputs;
}

export function readSavedAudioInputConfig(): AudioInputStartOptions | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(AUDIO_INPUT_CONFIG_STORAGE_KEY);
    if (!rawValue) return null;

    const parsedValue = JSON.parse(rawValue) as AudioInputStartOptions;
    const speakerADeviceId =
      typeof parsedValue.speakerADeviceId === "string"
        ? parsedValue.speakerADeviceId
        : "";
    const speakerBDeviceId =
      typeof parsedValue.speakerBDeviceId === "string"
        ? parsedValue.speakerBDeviceId
        : "";

    if (!speakerADeviceId || !speakerBDeviceId) return null;

    return { speakerADeviceId, speakerBDeviceId };
  } catch {
    return null;
  }
}

export function saveAudioInputConfig(options: AudioInputStartOptions) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    AUDIO_INPUT_CONFIG_STORAGE_KEY,
    JSON.stringify({
      speakerADeviceId: options.speakerADeviceId || "",
      speakerBDeviceId: options.speakerBDeviceId || "",
    }),
  );
}

export async function startMic(deviceId: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

export function createSingleMicInputService(): SingleMicInputService {
  let handle: SingleMicInputHandle | null = null;
  let sequence = 0;
  let chunks: Blob[] = [];
  let chunkStartedAt = 0;
  let activeSpeaker: StereoSpeaker = "A";
  let activeMimeType = "";
  const chunkCallbacks = new Set<SingleMicChunkCallback>();
  const levelCallbacks = new Set<SingleMicLevelCallback>();

  async function startVoiceInput(options?: SingleMicInputStartOptions | null) {
    if (handle) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("audio input is not available in this browser");
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio API is not available in this browser");
    }

    const stream = await startSingleMicStream(options?.deviceId || "");
    const track = stream.getAudioTracks()[0];
    console.log("single mic settings:", track?.getSettings());

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const silentGain = context.createGain();
    const mimeType = getSupportedAudioMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    activeMimeType = mimeType;

    analyser.fftSize = 1024;
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(context.destination);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const endedAt = Date.now();
      const blob = new Blob(chunks, { type: mimeType || chunks[0]?.type });
      chunks = [];

      if (blob.size < 512 || !chunkStartedAt) return;

      chunkCallbacks.forEach((callback) =>
        callback({
          speaker: activeSpeaker,
          blob,
          mimeType: activeMimeType,
          startedAt: chunkStartedAt,
          endedAt,
          sequence: ++sequence,
        }),
      );
      chunkStartedAt = 0;
    };
    recorder.onerror = (event) => {
      console.warn("single mic recorder error", event);
    };

    handle = {
      stream,
      context,
      nodes: [source, analyser, silentGain],
      recorder,
      stopLevelMeter: null,
    };

    if (context.state === "suspended") {
      await context.resume();
    }

    handle.stopLevelMeter = startSingleMicLevelMeter(
      analyser,
      (level) => {
        levelCallbacks.forEach((callback) => callback(level));
      },
    );
  }

  function startCapture(speaker: StereoSpeaker) {
    if (!handle || handle.recorder.state !== "inactive") return;

    chunks = [];
    activeSpeaker = speaker;
    chunkStartedAt = Date.now();
    handle.recorder.start();
  }

  function stopCapture() {
    if (!handle || handle.recorder.state !== "recording") return;

    try {
      handle.recorder.stop();
    } catch {
      // Recorder may already be stopping after a device disconnect.
    }
  }

  function stopVoiceInput() {
    if (!handle) return;

    handle.stopLevelMeter?.();

    stopCapture();

    stopMediaStream(handle.stream);

    for (const node of handle.nodes) {
      try {
        node.disconnect();
      } catch {
        // Some browsers throw if a node was already disconnected.
      }
    }

    void handle.context.close().catch(() => {});
    handle = null;
  }

  return {
    startVoiceInput,
    stopVoiceInput,
    startCapture,
    stopCapture,
    onChunk(callback) {
      chunkCallbacks.add(callback);
      return () => chunkCallbacks.delete(callback);
    },
    onLevel(callback) {
      levelCallbacks.add(callback);
      return () => levelCallbacks.delete(callback);
    },
    isRunning() {
      return Boolean(handle);
    },
    isCapturing() {
      return handle?.recorder.state === "recording";
    },
  };
}

export function createStereoInputService(chunkMs = 4000): StereoInputService {
  let handle: StereoInputHandle | null = null;
  let sequence = 0;
  const speakerACallbacks = new Set<ChunkCallback>();
  const speakerBCallbacks = new Set<ChunkCallback>();
  const speakerALevelCallbacks = new Set<LevelCallback>();
  const speakerBLevelCallbacks = new Set<LevelCallback>();

  async function startStereoInput(options?: AudioInputStartOptions | null) {
    if (handle) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("audio input is not available in this browser");
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio API is not available in this browser");
    }

    if (options?.speakerADeviceId && options.speakerBDeviceId) {
      await startDualDeviceInput(
        AudioContextClass,
        options.speakerADeviceId,
        options.speakerBDeviceId,
      );
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings();

    console.log("audio settings:", settings);
    if (settings?.channelCount !== 2) {
      console.warn("2ch input not available", settings);
    }

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const splitter = context.createChannelSplitter(2);
    const leftDestination = context.createMediaStreamDestination();
    const rightDestination = context.createMediaStreamDestination();
    const leftAnalyser = context.createAnalyser();
    const rightAnalyser = context.createAnalyser();
    const silentGain = context.createGain();
    const mimeType = getSupportedAudioMimeType();

    leftAnalyser.fftSize = 1024;
    rightAnalyser.fftSize = 1024;
    silentGain.gain.value = 0;

    source.connect(splitter);

    // splitter output 0 = Left  = speakerA
    // splitter output 1 = Right = speakerB
    splitter.connect(leftDestination, 0);
    splitter.connect(rightDestination, 1);
    splitter.connect(leftAnalyser, 0);
    splitter.connect(rightAnalyser, 1);
    leftAnalyser.connect(silentGain);
    rightAnalyser.connect(silentGain);
    silentGain.connect(context.destination);

    const leftRecorder = createRecorder(
      leftDestination.stream,
      "A",
      mimeType,
      () => ++sequence,
      (chunk) => speakerACallbacks.forEach((callback) => callback(chunk)),
      chunkMs,
    );
    const rightRecorder = createRecorder(
      rightDestination.stream,
      "B",
      mimeType,
      () => ++sequence,
      (chunk) => speakerBCallbacks.forEach((callback) => callback(chunk)),
      chunkMs,
    );

    handle = {
      streams: [stream],
      context,
      nodes: [
        source,
        splitter,
        leftDestination,
        rightDestination,
        leftAnalyser,
        rightAnalyser,
        silentGain,
      ],
      recorders: [leftRecorder, rightRecorder],
      stopLevelMeter: null,
    };

    if (context.state === "suspended") {
      await context.resume();
    }

    handle.stopLevelMeter = startLevelMeter(
      leftAnalyser,
      rightAnalyser,
      (level) => speakerALevelCallbacks.forEach((callback) => callback(level)),
      (level) => speakerBLevelCallbacks.forEach((callback) => callback(level)),
    );
    leftRecorder.start(chunkMs);
    rightRecorder.start(chunkMs);
  }

  async function startDualDeviceInput(
    AudioContextClass: typeof AudioContext,
    speakerADeviceId: string,
    speakerBDeviceId: string,
  ) {
    const speakerAStream = await startMic(speakerADeviceId);
    let speakerBStream: MediaStream | null = null;

    try {
      speakerBStream = await startMic(speakerBDeviceId);
    } catch (error) {
      stopMediaStream(speakerAStream);
      throw error;
    }

    const speakerATrack = speakerAStream.getAudioTracks()[0];
    const speakerBTrack = speakerBStream.getAudioTracks()[0];

    console.log("micA settings:", speakerATrack?.getSettings());
    console.log("micB settings:", speakerBTrack?.getSettings());

    const context = new AudioContextClass();
    const speakerASource = context.createMediaStreamSource(speakerAStream);
    const speakerBSource = context.createMediaStreamSource(speakerBStream);
    const leftAnalyser = context.createAnalyser();
    const rightAnalyser = context.createAnalyser();
    const silentGain = context.createGain();
    const mimeType = getSupportedAudioMimeType();

    leftAnalyser.fftSize = 1024;
    rightAnalyser.fftSize = 1024;
    silentGain.gain.value = 0;

    speakerASource.connect(leftAnalyser);
    speakerBSource.connect(rightAnalyser);
    leftAnalyser.connect(silentGain);
    rightAnalyser.connect(silentGain);
    silentGain.connect(context.destination);

    const speakerARecorder = createRecorder(
      speakerAStream,
      "A",
      mimeType,
      () => ++sequence,
      (chunk) => speakerACallbacks.forEach((callback) => callback(chunk)),
      chunkMs,
    );
    const speakerBRecorder = createRecorder(
      speakerBStream,
      "B",
      mimeType,
      () => ++sequence,
      (chunk) => speakerBCallbacks.forEach((callback) => callback(chunk)),
      chunkMs,
    );

    handle = {
      streams: [speakerAStream, speakerBStream],
      context,
      nodes: [
        speakerASource,
        speakerBSource,
        leftAnalyser,
        rightAnalyser,
        silentGain,
      ],
      recorders: [speakerARecorder, speakerBRecorder],
      stopLevelMeter: null,
    };

    if (context.state === "suspended") {
      await context.resume();
    }

    handle.stopLevelMeter = startLevelMeter(
      leftAnalyser,
      rightAnalyser,
      (level) => speakerALevelCallbacks.forEach((callback) => callback(level)),
      (level) => speakerBLevelCallbacks.forEach((callback) => callback(level)),
    );
    speakerARecorder.start(chunkMs);
    speakerBRecorder.start(chunkMs);
  }

  function stopStereoInput() {
    if (!handle) return;

    for (const recorder of handle.recorders) {
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Recorder may already be stopping after a device disconnect.
        }
      }
    }

    handle.stopLevelMeter?.();

    for (const stream of handle.streams) {
      stopMediaStream(stream);
    }

    for (const node of handle.nodes) {
      try {
        node.disconnect();
      } catch {
        // Some browsers throw if a node was already disconnected.
      }
    }

    void handle.context.close().catch(() => {});
    handle = null;
  }

  return {
    startStereoInput,
    stopStereoInput,
    onSpeakerAChunk(callback) {
      speakerACallbacks.add(callback);
      return () => speakerACallbacks.delete(callback);
    },
    onSpeakerBChunk(callback) {
      speakerBCallbacks.add(callback);
      return () => speakerBCallbacks.delete(callback);
    },
    onSpeakerALevel(callback) {
      speakerALevelCallbacks.add(callback);
      return () => speakerALevelCallbacks.delete(callback);
    },
    onSpeakerBLevel(callback) {
      speakerBLevelCallbacks.add(callback);
      return () => speakerBLevelCallbacks.delete(callback);
    },
    isRunning() {
      return Boolean(handle);
    },
  };
}

function startLevelMeter(
  leftAnalyser: AnalyserNode,
  rightAnalyser: AnalyserNode,
  emitA: (level: AudioInputLevel) => void,
  emitB: (level: AudioInputLevel) => void,
) {
  const leftBuffer = new Float32Array(leftAnalyser.fftSize);
  const rightBuffer = new Float32Array(rightAnalyser.fftSize);
  let frameId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;

    leftAnalyser.getFloatTimeDomainData(leftBuffer);
    rightAnalyser.getFloatTimeDomainData(rightBuffer);

    emitA({ speaker: "A", ...calculateLevel(leftBuffer), at: Date.now() });
    emitB({ speaker: "B", ...calculateLevel(rightBuffer), at: Date.now() });

    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
  };
}

function startSingleMicLevelMeter(
  analyser: AnalyserNode,
  emit: (level: SingleMicInputLevel) => void,
) {
  const buffer = new Float32Array(analyser.fftSize);
  let frameId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);
    emit({ ...calculateLevel(buffer), at: Date.now() });

    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
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

  return {
    rms: Math.sqrt(sumSquares / samples.length),
    peak,
  };
}

function stopMediaStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function startSingleMicStream(deviceId: string) {
  if (deviceId) {
    return startMic(deviceId);
  }

  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

function createRecorder(
  stream: MediaStream,
  speaker: StereoSpeaker,
  mimeType: string,
  nextSequence: () => number,
  emitChunk: (chunk: StereoAudioChunk) => void,
  chunkMs: number,
) {
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  let chunkStartedAt = Date.now();

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;

    const endedAt = Date.now();
    emitChunk({
      speaker,
      blob: event.data,
      mimeType,
      startedAt: chunkStartedAt,
      endedAt,
      sequence: nextSequence(),
    });
    chunkStartedAt = endedAt;
  };
  recorder.onstart = () => {
    chunkStartedAt = Date.now();
  };
  recorder.onerror = (event) => {
    console.warn(`speaker${speaker} recorder error`, event);
  };

  return recorder;
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

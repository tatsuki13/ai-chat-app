import { createVoiceActivityDetector } from "./voice-activity-detector";

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
  stream?: MediaStream;
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

export type RemoteStreamInputService = {
  startRemoteInput: (speaker: StereoSpeaker, stream: MediaStream) => Promise<void>;
  stopRemoteInput: (speaker: StereoSpeaker) => void;
  stopAllRemoteInputs: () => void;
  onChunk: (callback: ChunkCallback) => () => void;
  onLevel: (callback: LevelCallback) => () => void;
  isRunning: (speaker?: StereoSpeaker) => boolean;
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

    const stream = options?.stream
      ? new MediaStream(options.stream.getAudioTracks().map((track) => track.clone()))
      : await startSingleMicStream(options?.deviceId || "");
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

export function createRemoteStreamInputService(
  recorderTimesliceMs = 250,
): RemoteStreamInputService {
  type BufferedRemoteBlob = {
    blob: Blob;
    at: number;
  };

  type RemoteHandle = {
    sourceStream: MediaStream;
    recordingStream: MediaStream;
    context: AudioContext;
    nodes: AudioNode[];
    recorder: MediaRecorder;
    mimeType: string;
    bufferedBlobs: BufferedRemoteBlob[];
    activeSegmentBlobs: Blob[];
    segmentStartedAt: number | null;
    pendingSegmentEndAt: number | null;
    voiceActivity: ReturnType<typeof createVoiceActivityDetector>;
    stopLevelMeter: (() => void) | null;
    active: boolean;
  };

  const REMOTE_PREROLL_MS = 700;
  const REMOTE_BUFFER_RETENTION_MS = 2500;
  const handles = new Map<StereoSpeaker, RemoteHandle>();
  const chunkCallbacks = new Set<ChunkCallback>();
  const levelCallbacks = new Set<LevelCallback>();
  let sequence = 0;

  async function startRemoteInput(speaker: StereoSpeaker, stream: MediaStream) {
    stopRemoteInput(speaker);

    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not available");
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio API is not available in this browser");
    }

    const sourceStream = new MediaStream(
      stream.getAudioTracks().map((track) => track.clone()),
    );

    if (sourceStream.getAudioTracks().length === 0) {
      throw new Error("Remote audio track is missing");
    }

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(sourceStream);
    const analyser = context.createAnalyser();
    const destination = context.createMediaStreamDestination();
    const mimeType = getSupportedAudioMimeType();
    const recorder = new MediaRecorder(
      destination.stream,
      mimeType ? { mimeType } : undefined,
    );

    analyser.fftSize = 1024;
    source.connect(analyser);
    source.connect(destination);

    if (context.state === "suspended") {
      try {
        await context.resume();
      } catch (error) {
        stopMediaStream(sourceStream);
        void context.close().catch(() => {});
        throw error;
      }
    }

    const recordingTracks = destination.stream.getAudioTracks();
    if (recordingTracks.length === 0) {
      stopMediaStream(sourceStream);
      void context.close().catch(() => {});
      throw new Error("Remote recording audio track is missing");
    }

    console.info("[remote-mic remote input start]", {
      speaker,
      role: remoteRoleLabel(speaker),
      audioTracks: sourceStream.getAudioTracks().length,
      trackState: sourceStream.getAudioTracks()[0]?.readyState,
      trackMuted: sourceStream.getAudioTracks()[0]?.muted,
    });
    console.info("[remote-mic recording pipeline]", {
      speaker,
      role: remoteRoleLabel(speaker),
      sourceTrackCount: sourceStream.getAudioTracks().length,
      sourceTrackReadyState: sourceStream.getAudioTracks()[0]?.readyState,
      sourceTrackMuted: sourceStream.getAudioTracks()[0]?.muted,
      destinationTrackCount: recordingTracks.length,
      destinationTrackReadyState: recordingTracks[0]?.readyState,
      audioContextState: context.state,
    });

    const voiceActivity = createVoiceActivityDetector({
      onSpeechStart: (segmentStartedAtMs) => {
        const currentHandle = handles.get(speaker);
        if (!currentHandle?.active) return;

        const prerollStartedAt = segmentStartedAtMs - REMOTE_PREROLL_MS;
        currentHandle.segmentStartedAt = segmentStartedAtMs;
        currentHandle.pendingSegmentEndAt = null;
        currentHandle.activeSegmentBlobs = currentHandle.bufferedBlobs
          .filter((item) => item.at >= prerollStartedAt)
          .map((item) => item.blob);
        console.info("[remote-mic vad speech start]", {
          speaker,
          role: remoteRoleLabel(speaker),
          segmentStartedAtMs,
          prerollBlobCount: currentHandle.activeSegmentBlobs.length,
        });
      },
      onSpeechEnd: (segment) => {
        const currentHandle = handles.get(speaker);
        if (!currentHandle?.active || currentHandle.segmentStartedAt === null) {
          return;
        }

        currentHandle.pendingSegmentEndAt = segment.endedAtMs;
        console.info("[remote-mic vad speech end]", {
          speaker,
          role: remoteRoleLabel(speaker),
          startedAt: segment.startedAtMs,
          endedAt: segment.endedAtMs,
        });
        requestRemoteRecorderData(currentHandle);
        window.setTimeout(() => {
          flushRemoteSpeechSegment(speaker);
        }, recorderTimesliceMs + 50);
      },
    });

    const handle: RemoteHandle = {
      sourceStream,
      recordingStream: destination.stream,
      context,
      nodes: [source, analyser, destination],
      recorder,
      mimeType,
      bufferedBlobs: [],
      activeSegmentBlobs: [],
      segmentStartedAt: null,
      pendingSegmentEndAt: null,
      voiceActivity,
      stopLevelMeter: startRemoteLevelMeter(analyser, speaker, (level) => {
        const normalizedLevel = Math.max(level.rms * 8, level.peak);
        voiceActivity.update(normalizedLevel, level.at);
        levelCallbacks.forEach((callback) => callback(level));
      }),
      active: true,
    };
    handles.set(speaker, handle);

    recorder.ondataavailable = (event) => {
      if (event.data.size <= 0) return;

      const currentHandle = handles.get(speaker);
      if (!currentHandle?.active) return;

      const at = Date.now();
      currentHandle.bufferedBlobs.push({ blob: event.data, at });
      currentHandle.bufferedBlobs = currentHandle.bufferedBlobs.filter(
        (item) => item.at >= at - REMOTE_BUFFER_RETENTION_MS,
      );

      if (currentHandle.segmentStartedAt !== null) {
        currentHandle.activeSegmentBlobs.push(event.data);
      }

      if (currentHandle.pendingSegmentEndAt !== null) {
        flushRemoteSpeechSegment(speaker);
      }
    };
    recorder.onerror = (event) => {
      console.error("[remote-mic remote recorder error]", {
        speaker,
        role: remoteRoleLabel(speaker),
        recorderState: recorder.state,
        eventType: event.type,
      });
    };

    console.info("[remote-mic remote recorder start]", {
      speaker,
      role: remoteRoleLabel(speaker),
      mimeType,
      recorderState: recorder.state,
      sourceTrackCount: handle.sourceStream.getAudioTracks().length,
      sourceTrackReadyState: handle.sourceStream.getAudioTracks()[0]?.readyState,
      sourceTrackMuted: handle.sourceStream.getAudioTracks()[0]?.muted,
      recordingTrackCount: handle.recordingStream.getAudioTracks().length,
      recordingTrackReadyState:
        handle.recordingStream.getAudioTracks()[0]?.readyState,
    });
    recorder.start(recorderTimesliceMs);
    console.info("[remote-mic remote recorder started]", {
      speaker,
      role: remoteRoleLabel(speaker),
      recorderState: recorder.state,
    });
  }

  function requestRemoteRecorderData(handle: RemoteHandle) {
    if (handle.recorder.state !== "recording") return;

    try {
      handle.recorder.requestData();
    } catch {
      // Some browsers can reject requestData while the recorder is stopping.
    }
  }

  function flushRemoteSpeechSegment(speaker: StereoSpeaker) {
    const handle = handles.get(speaker);
    if (
      !handle?.active ||
      handle.segmentStartedAt === null ||
      handle.pendingSegmentEndAt === null
    ) {
      return;
    }

    const startedAt = handle.segmentStartedAt;
    const endedAt = handle.pendingSegmentEndAt;
    const parts = handle.activeSegmentBlobs;
    const blob = new Blob(parts, {
      type: handle.recorder.mimeType || parts[0]?.type || handle.mimeType,
    });

    console.info("[remote-mic remote segment]", {
      speaker,
      role: remoteRoleLabel(speaker),
      size: blob.size,
      type: blob.type,
      parts: parts.length,
      durationMs: endedAt - startedAt,
      active: handle.active,
    });

    handle.segmentStartedAt = null;
    handle.pendingSegmentEndAt = null;
    handle.activeSegmentBlobs = [];

    if (blob.size < 512) return;

    chunkCallbacks.forEach((callback) =>
      callback({
        speaker,
        blob,
        mimeType: blob.type || handle.mimeType,
        startedAt,
        endedAt,
        sequence: ++sequence,
      }),
    );
  }

  function stopRemoteInput(speaker: StereoSpeaker) {
    const handle = handles.get(speaker);
    if (!handle) return;

    handle.voiceActivity.forceEnd(Date.now());
    flushRemoteSpeechSegment(speaker);
    handle.active = false;
    handle.stopLevelMeter?.();
    handle.stopLevelMeter = null;
    if (handle.recorder.state !== "inactive") {
      try {
        handle.recorder.stop();
      } catch {
        // Recorder may already be stopping after a peer disconnect.
      }
    }

    for (const node of handle.nodes) {
      try {
        node.disconnect();
      } catch {
        // Some browsers throw if a node was already disconnected.
      }
    }

    void handle.context.close().catch(() => {});
    stopMediaStream(handle.recordingStream);
    stopMediaStream(handle.sourceStream);
    handles.delete(speaker);
  }

  return {
    startRemoteInput,
    stopRemoteInput,
    stopAllRemoteInputs() {
      stopRemoteInput("A");
      stopRemoteInput("B");
    },
    onChunk(callback) {
      chunkCallbacks.add(callback);
      return () => chunkCallbacks.delete(callback);
    },
    onLevel(callback) {
      levelCallbacks.add(callback);
      return () => levelCallbacks.delete(callback);
    },
    isRunning(speaker) {
      if (speaker) return handles.has(speaker);

      return handles.size > 0;
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

function startRemoteLevelMeter(
  analyser: AnalyserNode,
  speaker: StereoSpeaker,
  emit: (level: AudioInputLevel) => void,
) {
  const buffer = new Float32Array(analyser.fftSize);
  let frameId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);
    emit({ speaker, ...calculateLevel(buffer), at: Date.now() });

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

function remoteRoleLabel(speaker: StereoSpeaker) {
  return speaker === "A" ? "elder" : "caregiver";
}

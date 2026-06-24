export type StereoSpeaker = "A" | "B";

export type StereoAudioChunk = {
  speaker: StereoSpeaker;
  blob: Blob;
  mimeType: string;
  startedAt: number;
  endedAt: number;
  sequence: number;
};

type ChunkCallback = (chunk: StereoAudioChunk) => void;

type StereoInputHandle = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  splitter: ChannelSplitterNode;
  leftDestination: MediaStreamAudioDestinationNode;
  rightDestination: MediaStreamAudioDestinationNode;
  recorders: MediaRecorder[];
};

export type StereoInputService = {
  startStereoInput: () => Promise<void>;
  stopStereoInput: () => void;
  onSpeakerAChunk: (callback: ChunkCallback) => () => void;
  onSpeakerBChunk: (callback: ChunkCallback) => () => void;
  isRunning: () => boolean;
};

export function createStereoInputService(chunkMs = 4000): StereoInputService {
  let handle: StereoInputHandle | null = null;
  let sequence = 0;
  const speakerACallbacks = new Set<ChunkCallback>();
  const speakerBCallbacks = new Set<ChunkCallback>();

  async function startStereoInput() {
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
    const mimeType = getSupportedAudioMimeType();

    source.connect(splitter);

    // splitter output 0 = Left  = speakerA
    // splitter output 1 = Right = speakerB
    splitter.connect(leftDestination, 0);
    splitter.connect(rightDestination, 1);

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
      stream,
      context,
      source,
      splitter,
      leftDestination,
      rightDestination,
      recorders: [leftRecorder, rightRecorder],
    };

    if (context.state === "suspended") {
      await context.resume();
    }

    leftRecorder.start(chunkMs);
    rightRecorder.start(chunkMs);
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

    for (const track of handle.stream.getTracks()) {
      track.stop();
    }

    for (const node of [
      handle.source,
      handle.splitter,
      handle.leftDestination,
      handle.rightDestination,
    ]) {
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
    isRunning() {
      return Boolean(handle);
    },
  };
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

export type RecordingStatus = "idle" | "recording" | "completed" | "failed";

export type RecordingMetadata = {
  sessionId: string;
  status: RecordingStatus;
  startedAt: string;
  endedAt: string | null;
  mimeType: string;
  chunkCount: number;
  storageKey: string;
  error: string | null;
};

const DB_NAME = "acp-session-recordings";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

export function createSessionRecordingService() {
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let metadata: RecordingMetadata | null = null;

  async function start(sessionId: string, stream: MediaStream) {
    if (recorder?.state === "recording") return metadata;
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not available in this browser");
    }

    chunks = [];
    const mimeType = getSupportedVideoMimeType();
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    metadata = {
      sessionId,
      status: "recording",
      startedAt: new Date().toISOString(),
      endedAt: null,
      mimeType,
      chunkCount: 0,
      storageKey: `session-recording:${sessionId}:${Date.now()}`,
      error: null,
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      chunks.push(event.data);
      if (metadata) metadata.chunkCount = chunks.length;
    };
    recorder.onerror = (event) => {
      console.warn("session recorder error", event);
      if (metadata) {
        metadata.status = "failed";
        metadata.error = "recording_failed";
      }
    };
    recorder.start(5000);
    return metadata;
  }

  async function stop() {
    const currentRecorder = recorder;
    if (!currentRecorder || currentRecorder.state === "inactive") return metadata;

    await new Promise<void>((resolve) => {
      currentRecorder.addEventListener("stop", () => resolve(), { once: true });
      currentRecorder.stop();
    });

    if (metadata) {
      metadata.status = metadata.status === "failed" ? "failed" : "completed";
      metadata.endedAt = new Date().toISOString();
      metadata.chunkCount = chunks.length;
      await saveRecording(metadata, new Blob(chunks, { type: metadata.mimeType }));
    }

    recorder = null;
    chunks = [];
    return metadata;
  }

  return {
    start,
    stop,
    getMetadata: () => metadata,
    isRecording: () => recorder?.state === "recording",
  };
}

async function saveRecording(metadata: RecordingMetadata, blob: Blob) {
  const db = await openRecordingDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      ...metadata,
      blob,
      savedAt: new Date().toISOString(),
    });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function openRecordingDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "storageKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getSupportedVideoMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

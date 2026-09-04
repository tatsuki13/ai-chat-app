type RemoteMicRuntimeStore = {
  activeState: unknown | null;
  aiSpeechSubscribers: Set<(event: unknown) => void>;
  partialTranscriptSubscribers: Set<(event: unknown) => void>;
  partialTranscriptLastByGroup: Map<string, string>;
};

const STORE_KEY = "__acpRemoteMicRuntimeStore";

type GlobalWithRemoteMicStore = typeof globalThis & {
  [STORE_KEY]?: RemoteMicRuntimeStore;
};

export function getRemoteMicRuntimeStore() {
  const globalStore = globalThis as GlobalWithRemoteMicStore;

  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = {
      activeState: null,
      aiSpeechSubscribers: new Set(),
      partialTranscriptSubscribers: new Set(),
      partialTranscriptLastByGroup: new Map(),
    };
  }

  return globalStore[STORE_KEY];
}

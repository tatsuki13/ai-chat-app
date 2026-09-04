type RemoteMicRuntimeStore = {
  activeState: unknown | null;
  aiSpeechSubscribers: Set<(event: unknown) => void>;
  transcriptSubscribers: Set<(event: unknown) => void>;
  transcriptLastPartialByGroup: Map<string, string>;
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
      transcriptSubscribers: new Set(),
      transcriptLastPartialByGroup: new Map(),
    };
  }

  return globalStore[STORE_KEY];
}

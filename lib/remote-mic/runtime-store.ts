type RemoteMicRuntimeStore = {
  activeState: unknown | null;
  aiSpeechSubscribers: Set<(event: unknown) => void>;
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
    };
  }

  return globalStore[STORE_KEY];
}

type RemoteMicRuntimeStore = {
  activeState: unknown | null;
  texts: Map<string, unknown>;
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
      texts: new Map<string, unknown>(),
    };
  }

  return globalStore[STORE_KEY];
}

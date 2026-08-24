type RemoteMicRuntimeStore = {
  activeState: unknown | null;
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
    };
  }

  return globalStore[STORE_KEY];
}

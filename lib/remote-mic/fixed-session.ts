import type { RemoteMicRole } from "./config";
import { getRemoteMicRuntimeStore } from "./runtime-store";

export type FixedRemoteMicState = {
  sessionId: string;
  participantCode: string | null;
  endedAt: string | null;
  dialogueStartedAt: string | null;
  updatedAt: number;
  roles: Record<
    RemoteMicRole,
    {
      connectedAt: number | null;
      lastSeenAt: number | null;
      muted: boolean;
      transmitting: boolean;
    }
  >;
};

const defaultRoleState = () => ({
  connectedAt: null,
  lastSeenAt: null,
  muted: true,
  transmitting: false,
});

export function setActiveFixedRemoteMicSession(input: {
  sessionId: string;
  participantCode: string | null;
  endedAt: string | null;
  dialogueStartedAt: string | null;
}) {
  const store = getRemoteMicRuntimeStore();
  const activeState = store.activeState as FixedRemoteMicState | null;

  if (!activeState || activeState.sessionId !== input.sessionId) {
    const nextState = {
      ...input,
      updatedAt: Date.now(),
      roles: {
        elder: defaultRoleState(),
        caregiver: defaultRoleState(),
      },
    };
    store.activeState = nextState;

    return nextState;
  }

  const nextState = {
    ...activeState,
    ...input,
    updatedAt: Date.now(),
  };
  store.activeState = nextState;

  return nextState;
}

export function getActiveFixedRemoteMicSession() {
  return getRemoteMicRuntimeStore().activeState as FixedRemoteMicState | null;
}

export function clearActiveFixedRemoteMicSession(sessionId?: string) {
  const store = getRemoteMicRuntimeStore();
  const activeState = store.activeState as FixedRemoteMicState | null;

  if (!sessionId || activeState?.sessionId === sessionId) {
    store.activeState = null;
  }
}

export function updateFixedRemoteMicRole(
  role: RemoteMicRole,
  input: Partial<FixedRemoteMicState["roles"][RemoteMicRole]>,
) {
  const store = getRemoteMicRuntimeStore();
  const activeState = store.activeState as FixedRemoteMicState | null;

  if (!activeState) return null;

  activeState.roles[role] = {
    ...activeState.roles[role],
    ...input,
    lastSeenAt: Date.now(),
  };
  activeState.updatedAt = Date.now();
  store.activeState = activeState;

  return activeState;
}

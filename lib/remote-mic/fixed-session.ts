import type { RemoteMicRole } from "./config";

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

let activeState: FixedRemoteMicState | null = null;

export function setActiveFixedRemoteMicSession(input: {
  sessionId: string;
  participantCode: string | null;
  endedAt: string | null;
  dialogueStartedAt: string | null;
}) {
  if (
    !activeState ||
    activeState.sessionId !== input.sessionId ||
    activeState.participantCode !== input.participantCode
  ) {
    activeState = {
      ...input,
      updatedAt: Date.now(),
      roles: {
        elder: defaultRoleState(),
        caregiver: defaultRoleState(),
      },
    };
    return activeState;
  }

  activeState = {
    ...activeState,
    ...input,
    updatedAt: Date.now(),
  };

  return activeState;
}

export function getActiveFixedRemoteMicSession() {
  return activeState;
}

export function clearActiveFixedRemoteMicSession(sessionId?: string) {
  if (!sessionId || activeState?.sessionId === sessionId) {
    activeState = null;
  }
}

export function updateFixedRemoteMicRole(
  role: RemoteMicRole,
  input: Partial<FixedRemoteMicState["roles"][RemoteMicRole]>,
) {
  if (!activeState) return null;

  activeState.roles[role] = {
    ...activeState.roles[role],
    ...input,
    lastSeenAt: Date.now(),
  };
  activeState.updatedAt = Date.now();

  return activeState;
}

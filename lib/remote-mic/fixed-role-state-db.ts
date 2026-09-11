import { prisma } from "../prisma";
import { isRemoteMicRole, type RemoteMicRole } from "./control-events";

export type RemoteMicCaptureState =
  | "idle"
  | "listening"
  | "suppressed"
  | "reconnecting"
  | "error";

export type FixedRemoteMicRoleState = {
  sessionId: string;
  role: RemoteMicRole;
  connectedAt: string | null;
  lastSeenAt: string | null;
  realtimeConnected: boolean;
  captureState: RemoteMicCaptureState;
  muted: boolean;
  reconnectAttempt: number | null;
  reconnectReason: string | null;
  updatedAt: string | null;
};

const FIXED_REMOTE_MIC_ROLES = ["elder", "caregiver"] as const;

export async function getFixedRemoteMicRoleStates(sessionId: string) {
  const rows = await prisma.remoteMicRoleState.findMany({
    where: { sessionId },
  });
  const byRole = new Map(rows.map((row) => [row.role, row]));

  return Object.fromEntries(
    FIXED_REMOTE_MIC_ROLES.map((role) => {
      const row = byRole.get(role);
      return [role, row ? serializeRoleState(row) : createEmptyRoleState(sessionId, role)];
    }),
  ) as Record<RemoteMicRole, FixedRemoteMicRoleState>;
}

export async function recordFixedRemoteMicHeartbeat(input: {
  sessionId: string;
  role: RemoteMicRole;
}) {
  const now = new Date();
  const existing = await prisma.remoteMicRoleState.findUnique({
    where: {
      sessionId_role: {
        sessionId: input.sessionId,
        role: input.role,
      },
    },
    select: { connectedAt: true },
  });
  const row = await prisma.remoteMicRoleState.upsert({
    where: {
      sessionId_role: {
        sessionId: input.sessionId,
        role: input.role,
      },
    },
    create: {
      sessionId: input.sessionId,
      role: input.role,
      connectedAt: now,
      lastSeenAt: now,
    },
    update: {
      connectedAt: existing?.connectedAt ?? now,
      lastSeenAt: now,
    },
  });

  return serializeRoleState(row);
}

export async function upsertFixedRemoteMicRoleState(input: {
  sessionId: string;
  role: RemoteMicRole;
  muted?: boolean;
  realtimeConnected?: boolean;
  captureState?: RemoteMicCaptureState;
  reconnectAttempt?: number | null;
  reconnectReason?: string | null;
}) {
  const now = new Date();
  const row = await prisma.remoteMicRoleState.upsert({
    where: {
      sessionId_role: {
        sessionId: input.sessionId,
        role: input.role,
      },
    },
    create: {
      sessionId: input.sessionId,
      role: input.role,
      connectedAt: now,
      lastSeenAt: now,
      muted: input.muted ?? true,
      realtimeConnected: input.realtimeConnected ?? false,
      captureState: input.captureState ?? "idle",
      reconnectAttempt: input.reconnectAttempt,
      reconnectReason: input.reconnectReason,
    },
    update: {
      lastSeenAt: now,
      ...(typeof input.muted === "boolean" ? { muted: input.muted } : {}),
      ...(typeof input.realtimeConnected === "boolean"
        ? { realtimeConnected: input.realtimeConnected }
        : {}),
      ...(input.captureState ? { captureState: input.captureState } : {}),
      ...(input.reconnectAttempt !== undefined
        ? { reconnectAttempt: input.reconnectAttempt }
        : {}),
      ...(input.reconnectReason !== undefined
        ? { reconnectReason: input.reconnectReason }
        : {}),
    },
  });

  return serializeRoleState(row);
}

export async function clearFixedRemoteMicRoleStates(sessionId?: string) {
  await prisma.remoteMicRoleState.deleteMany({
    where: sessionId ? { sessionId } : undefined,
  });
}

export function parseRemoteMicCaptureState(value: unknown) {
  return value === "idle" ||
    value === "listening" ||
    value === "suppressed" ||
    value === "reconnecting" ||
    value === "error"
    ? value
    : null;
}

function createEmptyRoleState(
  sessionId: string,
  role: RemoteMicRole,
): FixedRemoteMicRoleState {
  return {
    sessionId,
    role,
    connectedAt: null,
    lastSeenAt: null,
    realtimeConnected: false,
    captureState: "idle",
    muted: true,
    reconnectAttempt: null,
    reconnectReason: null,
    updatedAt: null,
  };
}

function serializeRoleState(row: {
  sessionId: string;
  role: string;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  realtimeConnected: boolean;
  captureState: string;
  muted: boolean;
  reconnectAttempt: number | null;
  reconnectReason: string | null;
  updatedAt: Date;
}): FixedRemoteMicRoleState {
  const role = isRemoteMicRole(row.role) ? row.role : "elder";
  return {
    sessionId: row.sessionId,
    role,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    realtimeConnected: row.realtimeConnected,
    captureState: parseRemoteMicCaptureState(row.captureState) ?? "idle",
    muted: row.muted,
    reconnectAttempt: row.reconnectAttempt,
    reconnectReason: row.reconnectReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

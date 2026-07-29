import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  isRemoteMicEnabled,
  parseRemoteMicRole,
  type RemoteMicRole,
} from "../../../../lib/remote-mic/config";

export const runtime = "nodejs";

type RemoteMicStatus =
  | "not-issued"
  | "waiting"
  | "connected"
  | "disconnected"
  | "expired"
  | "revoked";
type RemoteMicTokenStatusRow = {
  role: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  lastHeartbeatAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
};

const HEARTBEAT_STALE_MS = 15_000;

export async function GET(request: Request) {
  if (!isRemoteMicEnabled()) {
    return NextResponse.json(
      { error: "Remote microphone is disabled" },
      { status: 404 },
    );
  }

  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId || !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const rows = await prisma.remoteMicJoinToken.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      role: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      lastHeartbeatAt: true,
      disconnectedAt: true,
      createdAt: true,
    },
  });
  const now = Date.now();

  return NextResponse.json({
    now: new Date(now).toISOString(),
    roles: {
      caregiver: serializeRole(rows, "caregiver", now),
      elder: serializeRole(rows, "elder", now),
    },
  });
}

function serializeRole(
  rows: RemoteMicTokenStatusRow[],
  role: RemoteMicRole,
  now: number,
) {
  const row = rows.find((candidate) => parseRemoteMicRole(candidate.role) === role);

  if (!row) {
    return { status: "not-issued" satisfies RemoteMicStatus };
  }

  const status = getStatus(row, now);

  return {
    status,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
  };
}

function getStatus(
  row: {
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
    lastHeartbeatAt: Date | null;
    disconnectedAt: Date | null;
  },
  now: number,
): RemoteMicStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now) return "expired";
  if (!row.usedAt) return "waiting";
  if (row.disconnectedAt) return "disconnected";
  if (
    row.lastHeartbeatAt &&
    now - row.lastHeartbeatAt.getTime() <= HEARTBEAT_STALE_MS
  ) {
    return "connected";
  }

  return "disconnected";
}

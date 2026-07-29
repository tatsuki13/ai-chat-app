import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "../prisma";
import {
  REMOTE_MIC_COOKIE_NAME,
  getRemoteMicTokenTtlSeconds,
  isRemoteMicEnabled,
  parseRemoteMicRole,
  type RemoteMicRole,
} from "./config";

const TOKEN_BYTES = 32;
const COOKIE_MAX_AGE_SECONDS = 15 * 60;

export type RemoteMicSession = {
  tokenId: string;
  sessionId: string;
  role: RemoteMicRole;
  expiresAt: Date;
};

export async function issueRemoteMicJoinToken(input: {
  sessionId: string;
  role: RemoteMicRole;
}) {
  assertRemoteMicEnabled();

  const session = await prisma.session.findFirst({
    where: {
      id: input.sessionId,
      endedAt: null,
    },
    select: { id: true },
  });

  if (!session) {
    throw new RemoteMicError("Session not found or already ended", 404);
  }

  const now = new Date();
  await prisma.remoteMicJoinToken.updateMany({
    where: {
      sessionId: input.sessionId,
      role: input.role,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { revokedAt: now },
  });

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + getRemoteMicTokenTtlSeconds() * 1000);
  const record = await prisma.remoteMicJoinToken.create({
    data: {
      tokenHash: hashToken(token),
      sessionId: input.sessionId,
      role: input.role,
      expiresAt,
    },
  });

  return {
    token,
    tokenId: record.id,
    expiresAt,
  };
}

export async function exchangeRemoteMicJoinToken(token: string) {
  assertRemoteMicEnabled();

  if (!isLikelyToken(token)) {
    throw new RemoteMicError("Invalid join token", 400);
  }

  const tokenHash = hashToken(token);
  const now = new Date();
  const record = await prisma.remoteMicJoinToken.findUnique({
    where: { tokenHash },
    include: {
      session: {
        select: {
          id: true,
          endedAt: true,
        },
      },
    },
  });

  if (
    !record ||
    record.expiresAt <= now ||
    record.usedAt ||
    record.revokedAt ||
    record.session.endedAt
  ) {
    throw new RemoteMicError("Join token expired or already used", 401);
  }

  const role = parseRemoteMicRole(record.role);
  if (!role) {
    throw new RemoteMicError("Invalid join token role", 401);
  }

  const updated = await prisma.remoteMicJoinToken.updateMany({
    where: {
      id: record.id,
      usedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: {
      usedAt: now,
      lastHeartbeatAt: now,
      disconnectedAt: null,
    },
  });

  if (updated.count !== 1) {
    throw new RemoteMicError("Join token expired or already used", 401);
  }

  return {
    tokenId: record.id,
    sessionId: record.sessionId,
    role,
    expiresAt: record.expiresAt,
  };
}

export async function authenticateRemoteMicRequest() {
  assertRemoteMicEnabled();

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(REMOTE_MIC_COOKIE_NAME)?.value ?? "";
  const parsed = parseCookieValue(cookieValue);

  if (!parsed) {
    throw new RemoteMicError("Remote microphone authentication is required", 401);
  }

  const record = await prisma.remoteMicJoinToken.findUnique({
    where: { id: parsed.tokenId },
    include: {
      session: {
        select: {
          id: true,
          endedAt: true,
        },
      },
    },
  });

  const now = new Date();
  const role = parseRemoteMicRole(record?.role);

  if (
    !record ||
    !role ||
    record.sessionId !== parsed.sessionId ||
    record.role !== parsed.role ||
    record.expiresAt <= now ||
    record.revokedAt ||
    !record.usedAt ||
    record.session.endedAt
  ) {
    throw new RemoteMicError("Remote microphone authentication is invalid", 401);
  }

  return {
    tokenId: record.id,
    sessionId: record.sessionId,
    role,
    expiresAt: record.expiresAt,
  };
}

export async function setRemoteMicCookie(session: RemoteMicSession) {
  const cookieStore = await cookies();
  cookieStore.set(REMOTE_MIC_COOKIE_NAME, signCookieValue(session), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: Math.min(
      COOKIE_MAX_AGE_SECONDS,
      Math.max(1, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)),
    ),
  });
}

export async function clearRemoteMicCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(REMOTE_MIC_COOKIE_NAME);
}

export async function heartbeatRemoteMic(session: RemoteMicSession) {
  await prisma.remoteMicJoinToken.updateMany({
    where: {
      id: session.tokenId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      lastHeartbeatAt: new Date(),
      disconnectedAt: null,
    },
  });
}

export async function revokeRemoteMicSession(session: RemoteMicSession) {
  const now = new Date();
  await prisma.remoteMicJoinToken.update({
    where: { id: session.tokenId },
    data: {
      revokedAt: now,
      disconnectedAt: now,
    },
  });
}

export function createRemoteMicCookiePayload(session: RemoteMicSession) {
  return {
    sessionId: session.sessionId,
    role: session.role,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function remoteMicErrorResponse(error: unknown) {
  if (error instanceof RemoteMicError) {
    return {
      message: error.message,
      status: error.status,
    };
  }

  return {
    message: "Remote microphone request failed",
    status: 500,
  };
}

function assertRemoteMicEnabled() {
  if (!isRemoteMicEnabled()) {
    throw new RemoteMicError("Remote microphone is disabled", 404);
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isLikelyToken(value: string) {
  return /^[A-Za-z0-9_-]{32,160}$/.test(value);
}

function signCookieValue(session: RemoteMicSession) {
  const payload = Buffer.from(
    JSON.stringify({
      tokenId: session.tokenId,
      sessionId: session.sessionId,
      role: session.role,
    }),
  ).toString("base64url");
  const signature = createHash("sha256")
    .update(`${payload}.${getCookieSecret()}`)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function parseCookieValue(value: string) {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = createHash("sha256")
    .update(`${payload}.${getCookieSecret()}`)
    .digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const role = parseRemoteMicRole(parsed.role);
    if (
      typeof parsed.tokenId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      !role
    ) {
      return null;
    }

    return {
      tokenId: parsed.tokenId,
      sessionId: parsed.sessionId,
      role,
    };
  } catch {
    return null;
  }
}

function getCookieSecret() {
  const secret = process.env.REMOTE_MIC_COOKIE_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new RemoteMicError("REMOTE_MIC_COOKIE_SECRET is required", 500);
  }

  return "dev-remote-mic-cookie-secret";
}

export class RemoteMicError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";

const SESSION_TOKEN_BYTES = 32;

export type AuthFailure = {
  response: NextResponse;
};

export function issueSessionAccessToken() {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");

  return {
    token,
    tokenHash: hashToken(token),
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionAccessToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerToken = request.headers.get("x-session-token")?.trim();

  return bearer || headerToken || "";
}

export async function requireSessionAccess(request: Request, sessionId: string) {
  const token = getSessionAccessToken(request);

  if (!token) {
    return failAuth("Session token is required", 401);
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, sessionAccessTokenHash: true },
  });

  if (!session) {
    return failAuth("Session not found", 404);
  }

  if (!session.sessionAccessTokenHash) {
    return failAuth("Session token is not configured", 403);
  }

  const tokenHash = hashToken(token);
  if (safeEqual(tokenHash, session.sessionAccessTokenHash)) {
    return { session };
  }

  const tokenOwner = await prisma.session.findUnique({
    where: { sessionAccessTokenHash: tokenHash },
    select: { id: true },
  });

  return failAuth(
    tokenOwner
      ? "Session token is not authorized for this session"
      : "Invalid session token",
    tokenOwner ? 403 : 401,
  );
}

export function requireAdminAccess(request: Request) {
  const secret = process.env.ADMIN_API_SECRET?.trim();

  if (!secret) {
    return failAuth("Admin API is not configured", 401);
  }

  const provided =
    request.headers.get("x-admin-secret")?.trim() ||
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ||
    "";

  if (!provided) {
    return failAuth("Admin secret is required", 401);
  }

  return safeEqual(provided, secret)
    ? { ok: true as const }
    : failAuth("Invalid admin secret", 401);
}

export async function requireAdminOrSessionAccess(request: Request, sessionId: string) {
  const admin = requireAdminAccess(request);
  if (!("response" in admin)) return { scope: "admin" as const };

  const session = await requireSessionAccess(request, sessionId);
  if ("response" in session) return session;

  return { scope: "session" as const, session: session.session };
}

function failAuth(error: string, status: 401 | 403 | 404): AuthFailure {
  return {
    response: NextResponse.json({ error }, { status }),
  };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

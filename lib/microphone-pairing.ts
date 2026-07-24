import { createHash, randomBytes } from "crypto";
import { prisma } from "./prisma";

export type MicrophoneRole = "caregiver" | "elder";

const TOKEN_BYTES = 24;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export function isMicrophoneRole(value: unknown): value is MicrophoneRole {
  return value === "caregiver" || value === "elder";
}

export function createPairingToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashPairingToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPairingExpiry() {
  return new Date(Date.now() + TOKEN_TTL_MS);
}

export async function validatePairingToken(input: {
  sessionId: string;
  role: MicrophoneRole;
  token: string;
}) {
  if (!input.token || input.token.length > 200) return false;

  const now = new Date();
  const tokenHash = hashPairingToken(input.token);
  const row = await prisma.microphonePairingToken.findFirst({
    where: {
      sessionId: input.sessionId,
      role: input.role,
      tokenHash,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
      session: {
        endedAt: null,
      },
    },
    select: {
      id: true,
    },
  });

  if (!row) return false;

  await prisma.microphonePairingToken.update({
    where: { id: row.id },
    data: { lastUsedAt: now },
  });

  return true;
}

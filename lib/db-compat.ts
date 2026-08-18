import { Prisma } from "@prisma/client";

const globalForCompat = globalThis as unknown as {
  sessionTokenHashes?: Map<string, string>;
};

export function isMissingColumnError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2022" || error.message.includes("does not exist"))
  );
}

export function rememberSessionTokenHash(sessionId: string, tokenHash: string) {
  const hashes =
    globalForCompat.sessionTokenHashes ??
    (globalForCompat.sessionTokenHashes = new Map<string, string>());

  hashes.set(sessionId, tokenHash);
}

export function getRememberedSessionTokenHash(sessionId: string) {
  return globalForCompat.sessionTokenHashes?.get(sessionId) ?? null;
}

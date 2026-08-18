import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const globalForCompat = globalThis as unknown as {
  sessionTokenHashes?: Map<string, string>;
  dbColumnCache?: Map<string, boolean>;
  dbTableCache?: Map<string, boolean>;
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

export async function hasDatabaseColumn(tableName: string, columnName: string) {
  const cache =
    globalForCompat.dbColumnCache ??
    (globalForCompat.dbColumnCache = new Map<string, boolean>());
  const key = `${tableName}.${columnName}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS "exists"
  `;
  const exists = rows[0]?.exists === true;
  cache.set(key, exists);

  return exists;
}

export async function hasDatabaseTable(tableName: string) {
  const cache =
    globalForCompat.dbTableCache ??
    (globalForCompat.dbTableCache = new Map<string, boolean>());
  const cached = cache.get(tableName);
  if (cached !== undefined) return cached;

  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS "exists"
  `;
  const exists = rows[0]?.exists === true;
  cache.set(tableName, exists);

  return exists;
}

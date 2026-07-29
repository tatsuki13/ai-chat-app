import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import {
  getRemoteMicBaseUrl,
  isRemoteMicEnabled,
  isSafeRemoteMicBaseUrl,
  shouldStoreRawRemoteMicAudio,
} from "../../../../lib/remote-mic/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const baseUrl = getRemoteMicBaseUrl(request);
  let db = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  return NextResponse.json({
    enabled: isRemoteMicEnabled(),
    database: db ? "ok" : "error",
    baseUrlConfigured: Boolean(process.env.REMOTE_MIC_BASE_URL),
    baseUrlLooksSafe: isSafeRemoteMicBaseUrl(baseUrl),
    https: baseUrl.startsWith("https://"),
    storeRawAudio: shouldStoreRawRemoteMicAudio(),
    now: new Date().toISOString(),
  });
}

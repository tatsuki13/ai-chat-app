import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

const LOG_DIR = path.join(process.cwd(), "logs", "acp");

export async function POST(request: Request) {
  const payload = await request.json();
  const sessionId = sanitizeSessionId(String(payload?.sessionId || "acp-session"));
  const fileName = `${sessionId}.json`;
  const filePath = path.join(LOG_DIR, fileName);

  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  return NextResponse.json({
    ok: true,
    file: path.join("logs", "acp", fileName),
  });
}

function sanitizeSessionId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 160);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    const log = body.log;

    if (!log || typeof log !== "object") {
      return Response.json({ error: "log is required" }, { status: 400 });
    }

    const sessionId = sanitizeFileName(
      String(body.sessionId || log.sessionId || `session-${Date.now()}`)
    );
    const logsDir = path.join(process.cwd(), "logs");
    const filePath = path.join(logsDir, `${sessionId}.json`);

    await mkdir(logsDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(log, null, 2), "utf8");

    return Response.json({
      ok: true,
      sessionId,
      fileName: `${sessionId}.json`
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Failed to save log" },
      { status: 500 }
    );
  }
}

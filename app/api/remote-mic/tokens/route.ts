import { NextResponse } from "next/server";
import {
  getRemoteMicBaseUrl,
  isRemoteMicEnabled,
  isSafeRemoteMicBaseUrl,
  parseRemoteMicRole,
} from "../../../../lib/remote-mic/config";
import {
  issueRemoteMicJoinToken,
  remoteMicErrorResponse,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isRemoteMicEnabled()) {
      return NextResponse.json(
        { error: "Remote microphone is disabled" },
        { status: 404 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const sessionId = requiredString(body.sessionId ?? body.session_id);
    const role = parseRemoteMicRole(body.role);
    const baseUrl = getRemoteMicBaseUrl(request);
    const configuredBaseUrl = requiredString(process.env.REMOTE_MIC_BASE_URL);

    if (!sessionId || !role || !/^[A-Za-z0-9_-]{8,80}$/.test(sessionId)) {
      return NextResponse.json(
        { error: "sessionId and role are required" },
        { status: 400 },
      );
    }

    if (!configuredBaseUrl || !baseUrl.startsWith("https://") || !isSafeRemoteMicBaseUrl(baseUrl)) {
      return NextResponse.json(
        { error: "REMOTE_MIC_BASE_URL must be configured as an HTTPS URL" },
        { status: 400 },
      );
    }

    const token = await issueRemoteMicJoinToken({ sessionId, role });
    const joinUrl = `${baseUrl}/mic/join?token=${encodeURIComponent(token.token)}`;

    return NextResponse.json({
      joinUrl,
      expiresAt: token.expiresAt.toISOString(),
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

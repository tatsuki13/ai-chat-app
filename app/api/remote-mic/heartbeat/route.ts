import { NextResponse } from "next/server";
import {
  authenticateRemoteMicRequest,
  heartbeatRemoteMic,
  remoteMicErrorResponse,
  setRemoteMicCookie,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await authenticateRemoteMicRequest();
    const refreshedSession = await heartbeatRemoteMic(session);
    await setRemoteMicCookie(refreshedSession);

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      expiresAt: refreshedSession.expiresAt.toISOString(),
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

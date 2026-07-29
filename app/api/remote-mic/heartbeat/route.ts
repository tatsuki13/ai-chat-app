import { NextResponse } from "next/server";
import {
  authenticateRemoteMicRequest,
  heartbeatRemoteMic,
  remoteMicErrorResponse,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await authenticateRemoteMicRequest();
    await heartbeatRemoteMic(session);

    return NextResponse.json({ ok: true, at: new Date().toISOString() });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

import { NextResponse } from "next/server";
import {
  authenticateRemoteMicRequest,
  clearRemoteMicCookie,
  remoteMicErrorResponse,
  revokeRemoteMicSession,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function POST() {
  try {
    const session = await authenticateRemoteMicRequest();
    await revokeRemoteMicSession(session);
    await clearRemoteMicCookie();

    return NextResponse.json({ ok: true });
  } catch (error) {
    await clearRemoteMicCookie().catch(() => {});
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

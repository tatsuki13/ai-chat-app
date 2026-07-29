import { NextResponse } from "next/server";
import {
  createRemoteMicCookiePayload,
  exchangeRemoteMicJoinToken,
  remoteMicErrorResponse,
  setRemoteMicCookie,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const session = await exchangeRemoteMicJoinToken(token);
    await setRemoteMicCookie(session);

    return NextResponse.json({
      remoteMic: createRemoteMicCookiePayload(session),
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

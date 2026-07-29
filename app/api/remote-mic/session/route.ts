import { NextResponse } from "next/server";
import {
  authenticateRemoteMicRequest,
  createRemoteMicCookiePayload,
  remoteMicErrorResponse,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await authenticateRemoteMicRequest();

    return NextResponse.json({
      remoteMic: createRemoteMicCookiePayload(session),
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

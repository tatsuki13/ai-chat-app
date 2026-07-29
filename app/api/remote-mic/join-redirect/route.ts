import { NextResponse } from "next/server";
import {
  exchangeRemoteMicJoinToken,
  remoteMicErrorResponse,
  setRemoteMicCookie,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  try {
    const session = await exchangeRemoteMicJoinToken(token);
    await setRemoteMicCookie(session);

    return NextResponse.redirect(new URL("/mic", request.url));
  } catch (error) {
    const response = remoteMicErrorResponse(error);
    const errorUrl = new URL("/mic/join/error", request.url);
    errorUrl.searchParams.set("message", response.message);

    return NextResponse.redirect(errorUrl);
  }
}

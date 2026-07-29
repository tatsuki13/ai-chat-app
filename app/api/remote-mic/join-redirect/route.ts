import { NextResponse } from "next/server";
import { getRemoteMicBaseUrl } from "../../../../lib/remote-mic/config";
import {
  exchangeRemoteMicJoinToken,
  remoteMicErrorResponse,
  setRemoteMicCookie,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? "";
  const baseUrl = getRemoteMicBaseUrl(request);

  try {
    const session = await exchangeRemoteMicJoinToken(token);
    await setRemoteMicCookie(session);

    return NextResponse.redirect(new URL("/mic", baseUrl));
  } catch (error) {
    const response = remoteMicErrorResponse(error);
    const errorUrl = new URL("/mic/join/error", baseUrl);
    errorUrl.searchParams.set("message", response.message);

    return NextResponse.redirect(errorUrl);
  }
}

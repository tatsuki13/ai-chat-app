import { NextResponse } from "next/server";
import {
  authenticateRemoteMicRequest,
  remoteMicErrorResponse,
} from "../../../../../lib/remote-mic/token-service";
import {
  createRemoteMicWebRtcOffer,
  getRemoteMicWebRtcAnswer,
} from "../../../../../lib/remote-mic/webrtc-signaling";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const remoteMic = await authenticateRemoteMicRequest();
    const body = (await request.json().catch(() => null)) as {
      offer?: unknown;
    } | null;

    if (!body?.offer) {
      return NextResponse.json({ error: "offer is required" }, { status: 400 });
    }

    const offer = createRemoteMicWebRtcOffer({
      tokenId: remoteMic.tokenId,
      sessionId: remoteMic.sessionId,
      role: remoteMic.role,
      offer: body.offer,
    });

    return NextResponse.json({ peerId: offer.peerId });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

export async function GET(request: Request) {
  try {
    const remoteMic = await authenticateRemoteMicRequest();
    const params = new URL(request.url).searchParams;
    const peerId = params.get("peerId")?.trim() ?? "";

    if (!peerId) {
      return NextResponse.json({ error: "peerId is required" }, { status: 400 });
    }

    return NextResponse.json({
      answer: getRemoteMicWebRtcAnswer({
        tokenId: remoteMic.tokenId,
        peerId,
      }),
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

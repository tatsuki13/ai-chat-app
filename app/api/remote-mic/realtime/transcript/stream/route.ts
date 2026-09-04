import { NextResponse } from "next/server";
import {
  getRemoteMicTranscriptEventTtlMs,
  subscribeRemoteMicTranscriptEvents,
  type RemoteMicTranscriptEvent,
} from "../../../../../../lib/remote-mic/transcript-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RemoteMicTranscriptEvent) => {
        if (event.sessionId !== sessionId) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const unsubscribe = subscribeRemoteMicTranscriptEvents(send);
      const heartbeat = setInterval(() => {
        controller.enqueue(
          encoder.encode(
            `event: heartbeat\ndata: ${JSON.stringify({
              ok: true,
              ttlMs: getRemoteMicTranscriptEventTtlMs(),
              at: new Date().toISOString(),
            })}\n\n`,
          ),
        );
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

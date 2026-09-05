import { NextResponse } from "next/server";
import {
  getAiSpeechState,
  subscribeAiSpeechEvents,
} from "../../../../../lib/ai/speech-state";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("sessionId")?.trim() ?? "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };
      let state: Awaited<ReturnType<typeof getAiSpeechState>> = null;
      try {
        state = await getAiSpeechState(sessionId);
      } catch (error) {
        console.warn("[ai speech state stream snapshot db lookup failed]", {
          sessionId,
          error,
        });
      }
      const activeMicState = getActiveFixedRemoteMicSession();
      send({
        type: "ai_speech_snapshot",
        sessionId,
        sessionEnded:
          !activeMicState ||
          activeMicState.sessionId !== sessionId ||
          Boolean(activeMicState.endedAt),
        active: state?.active ?? false,
        activePlaybackId: state?.playbackId ?? null,
        playbackId: state?.playbackId ?? null,
        contentType: state?.contentType ?? null,
        revision: state?.revision ?? 0,
        startedAt: state?.startedAt?.toISOString() ?? null,
        releaseAfter: state?.releaseAfter?.toISOString() ?? null,
        speechPhase:
          state?.active
            ? "playing"
            : state?.releaseAfter && Date.now() <= state.releaseAfter.getTime()
              ? "echo-guard"
              : "idle",
        roles:
          activeMicState?.sessionId === sessionId
            ? activeMicState.roles
            : null,
        timestamp: new Date().toISOString(),
      });

      const unsubscribe = subscribeAiSpeechEvents((event) => {
        if (event.sessionId !== sessionId) return;
        send(event);
      });
      const heartbeatId = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 20_000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeatId);
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

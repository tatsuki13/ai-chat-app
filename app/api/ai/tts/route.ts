import { NextResponse } from "next/server";
import { getOrCreateTTSAudio, type SpokenContentType } from "../../../../lib/ai/tts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      participantCode?: unknown;
      topicId?: unknown;
      contentType?: unknown;
      text?: unknown;
    } | null;
    const text = requiredString(body?.text);
    const contentType = parseSpokenContentType(requiredString(body?.contentType));

    if (!text || !contentType) {
      return NextResponse.json(
        { error: "text and contentType are required" },
        { status: 400 },
      );
    }

    const audio = await getOrCreateTTSAudio({
      text,
      contentType,
      topicId: optionalString(body?.topicId),
      sessionId: optionalString(body?.sessionId),
      participantCode: optionalString(body?.participantCode),
    });

    return NextResponse.json({
      audio: {
        reference: audio.audioReference,
        cacheKey: audio.cacheKey,
        model: audio.model,
        voice: audio.voice,
        format: audio.format,
        byteLength: audio.byteLength,
        cached: audio.cached,
        generationDurationMs: audio.generationDurationMs,
      },
    });
  } catch (error) {
    console.error("[ai tts prepare failed]", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to prepare TTS audio" },
      { status: 500 },
    );
  }
}

function parseSpokenContentType(value: string): SpokenContentType | null {
  return value === "topic" || value === "question" ? value : null;
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

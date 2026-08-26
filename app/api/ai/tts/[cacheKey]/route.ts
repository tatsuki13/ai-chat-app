import { NextResponse } from "next/server";
import { getTTSAudioByCacheKey } from "../../../../../lib/ai/tts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ cacheKey: string }> },
) {
  const params = await context.params;
  const cacheKey = params.cacheKey?.trim() ?? "";

  if (!cacheKey) {
    return NextResponse.json({ error: "cacheKey is required" }, { status: 400 });
  }

  const audio = await getTTSAudioByCacheKey(cacheKey);
  if (!audio) {
    return NextResponse.json({ error: "TTS audio not found" }, { status: 404 });
  }

  return new Response(audio.audio, {
    headers: {
      "Content-Type": `audio/${audio.format}`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-TTS-Model": audio.model,
      "X-TTS-Voice": audio.voice,
    },
  });
}

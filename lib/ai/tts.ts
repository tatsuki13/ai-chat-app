import { createHash } from "crypto";
import {
  createOpenAIClient,
  getDefaultOpenAITimeoutMs,
  getTTSOpenAIModel,
  getTTSOpenAIVoice,
} from "./client";
import { prisma } from "../prisma";

export type SpokenContentType = "topic" | "question";

export const TTS_AUDIO_FORMAT = "mp3";
export const TTS_INSTRUCTIONS =
  "落ち着いた自然な日本語で、ゆっくり、明瞭に読み上げてください。高齢者に問いかけるため、急かす印象や強い感情を避けてください。入力された文章をそのまま読み上げ、前置き、説明、言い換え、補足を追加しないでください。";

export function buildTTSCacheKey(input: {
  text: string;
  model?: string;
  voice?: string;
  instructions?: string;
  format?: string;
}) {
  const model = input.model ?? getTTSOpenAIModel();
  const voice = input.voice ?? getTTSOpenAIVoice();
  const instructions = input.instructions ?? TTS_INSTRUCTIONS;
  const format = input.format ?? TTS_AUDIO_FORMAT;

  return createHash("sha256")
    .update(JSON.stringify({
      text: input.text,
      model,
      voice,
      instructions,
      format,
    }))
    .digest("hex");
}

export async function getOrCreateTTSAudio(input: {
  text: string;
  contentType: SpokenContentType;
  topicId?: string | null;
  sessionId?: string | null;
  participantCode?: string | null;
}) {
  const text = input.text.trim();
  if (!text) {
    throw new Error("TTS text is required");
  }

  const model = getTTSOpenAIModel();
  const voice = getTTSOpenAIVoice();
  const instructions = TTS_INSTRUCTIONS;
  const format = TTS_AUDIO_FORMAT;
  const cacheKey = buildTTSCacheKey({ text, model, voice, instructions, format });
  const existing = await prisma.tTSAudioCache.findUnique({
    where: { cacheKey },
    select: {
      id: true,
      cacheKey: true,
      model: true,
      voice: true,
      format: true,
      byteLength: true,
      createdAt: true,
    },
  });

  if (existing) {
    await prisma.tTSAudioCache.update({
      where: { cacheKey },
      data: {
        lastUsedAt: new Date(),
        sessionId: input.sessionId ?? undefined,
        participantCode: input.participantCode ?? undefined,
      },
    });

    return {
      ...existing,
      audioReference: `/api/ai/tts/${existing.cacheKey}`,
      cached: true,
      generationDurationMs: 0,
    };
  }

  const started = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for TTS");
  }

  const client = createOpenAIClient({
    apiKey,
    timeout: Number(process.env.OPENAI_TTS_TIMEOUT_MS || getDefaultOpenAITimeoutMs()),
  });
  const response = await client.audio.speech.create({
    model,
    voice,
    input: text,
    instructions,
    response_format: format,
    speed: 0.92,
  });
  const audio = new Uint8Array(await response.arrayBuffer());
  const generationDurationMs = Date.now() - started;
  const cache = await prisma.tTSAudioCache.create({
    data: {
      cacheKey,
      participantCode: input.participantCode ?? undefined,
      sessionId: input.sessionId ?? undefined,
      contentType: input.contentType,
      topicId: input.topicId ?? undefined,
      text,
      model,
      voice,
      instructions,
      format,
      audio,
      byteLength: audio.byteLength,
      durationMs: null,
    },
    select: {
      id: true,
      cacheKey: true,
      model: true,
      voice: true,
      format: true,
      byteLength: true,
      createdAt: true,
    },
  });

  return {
    ...cache,
    audioReference: `/api/ai/tts/${cache.cacheKey}`,
    cached: false,
    generationDurationMs,
  };
}

export async function getTTSAudioByCacheKey(cacheKey: string) {
  return prisma.tTSAudioCache.findUnique({
    where: { cacheKey },
    select: {
      audio: true,
      format: true,
      model: true,
      voice: true,
      text: true,
    },
  });
}

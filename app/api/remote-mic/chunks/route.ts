import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { transcribeAudioFile } from "../../../../lib/server/transcription/transcribe-audio";
import { isRemoteMicDedupEnabled } from "../../../../lib/remote-mic/config";
import {
  authenticateRemoteMicRequest,
  remoteMicErrorResponse,
} from "../../../../lib/remote-mic/token-service";

export const runtime = "nodejs";

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const MIN_AUDIO_BYTES = 512;
const MAX_DURATION_MS = 15_000;
const ALLOWED_AUDIO_BASE_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/x-m4a",
]);

export async function POST(request: Request) {
  try {
    const remoteMic = await authenticateRemoteMicRequest();
    const formData = await request.formData();
    const audio = formData.get("audio");
    const clientChunkId = requiredString(formData.get("client_chunk_id"));
    const sequence = parseInteger(formData.get("sequence"));
    const capturedAtMs = parseInteger(formData.get("captured_at"));
    const durationMs = parseInteger(formData.get("duration_ms"));
    const averageLevel = parseOptionalFloat(formData.get("average_level"));
    const peakLevel = parseOptionalFloat(formData.get("peak_level"));

    if (
      !(audio instanceof File) ||
      !clientChunkId ||
      sequence === null ||
      capturedAtMs === null ||
      durationMs === null
    ) {
      return NextResponse.json(
        { error: "audio and chunk metadata are required" },
        { status: 400 },
      );
    }

    if (!isSafeChunkId(clientChunkId) || sequence < 0) {
      return NextResponse.json({ error: "Invalid chunk metadata" }, { status: 400 });
    }

    if (durationMs <= 0 || durationMs > MAX_DURATION_MS) {
      return NextResponse.json({ error: "Invalid chunk duration" }, { status: 400 });
    }

    if (audio.size > MAX_AUDIO_BYTES || audio.size < MIN_AUDIO_BYTES) {
      return NextResponse.json({ skipped: true });
    }

    console.info("[remote-mic chunk received]", {
      type: audio.type,
      name: audio.name,
      size: audio.size,
      sequence,
      durationMs,
    });

    if (!isAllowedMime(audio.type)) {
      console.warn("[remote-mic unsupported audio type]", {
        type: audio.type,
        normalizedType: normalizeAudioMimeType(audio.type),
        name: audio.name,
        size: audio.size,
      });

      return NextResponse.json(
        {
          error: "Unsupported audio type",
          receivedType:
            process.env.NODE_ENV === "production" ? undefined : audio.type,
        },
        { status: 415 },
      );
    }

    if (isRemoteMicDedupEnabled()) {
      const existing = await prisma.remoteMicAudioChunk.findUnique({
        where: {
          remoteMicTokenId_clientChunkId: {
            remoteMicTokenId: remoteMic.tokenId,
            clientChunkId,
          },
        },
        select: {
          utteranceId: true,
          skipped: true,
        },
      });

      if (existing) {
        return NextResponse.json({
          duplicate: true,
          skipped: existing.skipped,
          utteranceId: existing.utteranceId,
        });
      }
    }

    const capturedAt = new Date(capturedAtMs);
    const transcript = await transcribeAudioFile(audio);

    if (!transcript) {
      await prisma.remoteMicAudioChunk.create({
        data: {
          remoteMicTokenId: remoteMic.tokenId,
          sessionId: remoteMic.sessionId,
          role: remoteMic.role,
          clientChunkId,
          sequence,
          capturedAt,
          durationMs,
          averageLevel,
          peakLevel,
          skipped: true,
        },
      });

      return NextResponse.json({ skipped: true });
    }

    const utterance = await prisma.sessionUtterance.create({
      data: {
        sessionId: remoteMic.sessionId,
        speaker: remoteMic.role,
        text: transcript,
        createdAt: capturedAt,
      },
    });

    await prisma.remoteMicAudioChunk.create({
      data: {
        remoteMicTokenId: remoteMic.tokenId,
        sessionId: remoteMic.sessionId,
        role: remoteMic.role,
        clientChunkId,
        sequence,
        capturedAt,
        durationMs,
        averageLevel,
        peakLevel,
        utteranceId: utterance.id,
      },
    });

    return NextResponse.json({
      utterance: {
        id: utterance.id,
        session_id: utterance.sessionId,
        speaker: utterance.speaker,
        text: utterance.text,
        created_at: utterance.createdAt.toISOString(),
      },
    });
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}

function requiredString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const number = Number(value);

  return Number.isInteger(number) ? number : null;
}

function parseOptionalFloat(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function isSafeChunkId(value: string) {
  return /^[A-Za-z0-9_-]{8,120}$/.test(value);
}

function isAllowedMime(value: string) {
  if (!value) return true;

  return ALLOWED_AUDIO_BASE_TYPES.has(normalizeAudioMimeType(value));
}

function normalizeAudioMimeType(value: string) {
  return value.toLowerCase().split(";")[0].trim();
}

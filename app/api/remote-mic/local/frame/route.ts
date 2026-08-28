import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { prisma } from "../../../../../lib/prisma";
import {
  createUtteranceTiming,
  pickUtteranceTimingBase,
} from "../../../../../lib/server/utterance-timing";
import { UTTERANCE_ANALYSIS_VERSION } from "../../../../../lib/server/utterance-metadata";
import {
  getAiSpeechState,
  isAiSpeechBlockingTranscription,
} from "../../../../../lib/ai/speech-state";

export const runtime = "nodejs";

const LOCAL_ASR_BASE_URL =
  process.env.LOCAL_ASR_BASE_URL || "http://127.0.0.1:8765";
const LOCAL_ASR_TIMEOUT_MS = Number(process.env.LOCAL_ASR_TIMEOUT_MS || 8000);

type LocalAsrTranscript = {
  status?: "accepted" | "suppressed_crosstalk" | "suppressed_ai_speech" | "empty" | "error";
  sessionId?: string;
  role?: string;
  streamId?: string;
  segmentId?: string;
  utteranceGroupId?: string;
  text?: string;
  startMs?: number;
  endMs?: number;
  finalized?: boolean;
  asrProvider?: string;
  asrModel?: string;
};

export async function POST(request: Request) {
  let sessionId = "";
  let role: "elder" | "caregiver" | null = null;
  let streamId = "";
  let sequence: number | null = null;

  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      role?: unknown;
      streamId?: unknown;
      sequence?: unknown;
      capturedAt?: unknown;
      durationMs?: unknown;
      sampleRate?: unknown;
      averageLevel?: unknown;
      peakLevel?: unknown;
      pcmBase64?: unknown;
    } | null;

    sessionId = requiredString(body?.sessionId);
    role = parseRemoteMicRole(requiredString(body?.role));
    streamId = requiredString(body?.streamId);
    sequence = toInteger(body?.sequence);
    const pcmBase64 = requiredString(body?.pcmBase64);

    if (!sessionId || !role || !streamId || sequence === null || !pcmBase64) {
      return NextResponse.json(
        { error: "sessionId, role, streamId, sequence, and pcmBase64 are required" },
        { status: 400 },
      );
    }

    const active = await getFixedRemoteMicActiveSession();
    if (!active || active.sessionId !== sessionId || active.endedAt) {
      return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
    }

    const aiSpeechState = await getAiSpeechState(sessionId);
    if (isAiSpeechBlockingTranscription(aiSpeechState)) {
      return NextResponse.json({
        ok: true,
        transcripts: [],
        skipped: true,
        reason: "ai_speech_active",
      });
    }

    const workerResponse = await postToLocalAsr({
      sessionId,
      role,
      streamId,
      sequence,
      capturedAt: requiredString(body?.capturedAt),
      durationMs: toNumber(body?.durationMs),
      sampleRate: toNumber(body?.sampleRate),
      averageLevel: toNumber(body?.averageLevel),
      peakLevel: toNumber(body?.peakLevel),
      pcmBase64,
    });

    const transcripts = Array.isArray(workerResponse.transcripts)
      ? (workerResponse.transcripts as LocalAsrTranscript[])
      : [];
    const saved = [];

    for (const transcript of transcripts) {
      if (transcript.status !== "accepted") continue;
      if (!transcript.finalized) continue;
      const text = requiredString(transcript.text);
      const utteranceGroupId = requiredString(transcript.utteranceGroupId);
      if (!text || !utteranceGroupId) continue;

      saved.push(
        await appendOrCreateLocalAsrUtterance({
          sessionId,
          participantCode: active.participantCode,
          role,
          text,
          sourceGroupId: utteranceGroupId,
          startMs: toInteger(transcript.startMs),
          endMs: toInteger(transcript.endMs),
          asrProvider: requiredString(transcript.asrProvider) || "local-asr",
          asrModel: requiredString(transcript.asrModel) || null,
        }),
      );
    }

    return NextResponse.json({
      ok: true,
      worker: workerResponse.worker ?? "connected",
      transcripts,
      saved: saved.map((utterance) => ({
        id: utterance.id,
        session_id: utterance.sessionId,
        speaker: utterance.speaker,
        text: utterance.text,
        start_ms: utterance.startMs,
        end_ms: utterance.endMs,
        source: utterance.source,
        source_group_id: utterance.sourceGroupId,
        asr_provider: utterance.asrProvider,
        asr_model: utterance.asrModel,
        created_at: utterance.createdAt.toISOString(),
        updated_at: utterance.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[remote-mic local frame save failed]", {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      role,
      streamId,
      sequence,
    });

    return NextResponse.json(
      { error: "Failed to process local ASR frame" },
      { status: 500 },
    );
  }
}

async function postToLocalAsr(payload: Record<string, unknown>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_ASR_TIMEOUT_MS);

  try {
    const response = await fetch(`${LOCAL_ASR_BASE_URL.replace(/\/+$/, "")}/frame`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[local-asr frame failed]", {
        status: response.status,
        errorText,
        sessionId: payload.sessionId,
        role: payload.role,
        streamId: payload.streamId,
        sequence: payload.sequence,
      });
      throw new Error(`Local ASR worker failed: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.error("[local-asr frame error]", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: payload.sessionId,
      role: payload.role,
      streamId: payload.streamId,
      sequence: payload.sequence,
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function appendOrCreateLocalAsrUtterance(input: {
  sessionId: string;
  participantCode: string | null;
  role: "elder" | "caregiver";
  text: string;
  sourceGroupId: string;
  startMs: number | null;
  endMs: number | null;
  asrProvider: string;
  asrModel: string | null;
}) {
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    select: {
      startedAt: true,
      dialogueStartedAt: true,
    },
  });
  if (!session) {
    throw new Error("Session not found");
  }

  const timing = createUtteranceTiming({
    baseAt: pickUtteranceTimingBase(session),
    startedAt: null,
    endedAt: null,
  });
  const startMs = input.startMs ?? timing.startMs;
  const endMs = input.endMs ?? input.startMs ?? timing.endMs;
  const source = `remote_local_asr:${input.sourceGroupId}`;
  const existing = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId: input.sessionId,
      sourceGroupId: input.sourceGroupId,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return prisma.sessionUtterance.update({
      where: { id: existing.id },
      data: {
        text: input.text,
        speaker: input.role,
        source,
        startMs,
        endMs,
        sourceGroupId: input.sourceGroupId,
        asrProvider: input.asrProvider,
        asrModel: input.asrModel,
        analysisVersion: UTTERANCE_ANALYSIS_VERSION,
      },
    });
  }

  return prisma.sessionUtterance.create({
    data: {
      sessionId: input.sessionId,
      participantCode: input.participantCode,
      speaker: input.role,
      text: input.text,
      source,
      startMs,
      endMs,
      sourceGroupId: input.sourceGroupId,
      asrProvider: input.asrProvider,
      asrModel: input.asrModel,
      analysisVersion: UTTERANCE_ANALYSIS_VERSION,
    },
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

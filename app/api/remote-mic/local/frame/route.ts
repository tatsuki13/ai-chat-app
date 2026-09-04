import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import {
  appendOrCreateLocalAsrUtterance,
  serializeLocalAsrUtterance,
  type LocalAsrTranscript,
} from "../../../../../lib/remote-mic/local-asr-save";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import {
  getAiSpeechState,
  isAiSpeechBlockingTranscription,
} from "../../../../../lib/ai/speech-state";
import { publishRemoteMicPartialTranscript } from "../../../../../lib/remote-mic/partial-transcripts";

export const runtime = "nodejs";

const LOCAL_ASR_BASE_URL =
  process.env.LOCAL_ASR_BASE_URL || "http://127.0.0.1:8765";
const LOCAL_ASR_TIMEOUT_MS = Number(process.env.LOCAL_ASR_TIMEOUT_MS || 8000);

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
      console.warn("[remote-mic local frame rejected]", {
        reason: "active_session_mismatch",
        sessionId,
        activeSessionId: active?.sessionId ?? null,
        role,
        streamId,
        sequence,
      });
      return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
    }

    const runtimeState = getActiveFixedRemoteMicSession();
    const roleState =
      runtimeState?.sessionId === sessionId ? runtimeState.roles[role] : null;
    if (roleState?.muted) {
      return NextResponse.json({
        ok: true,
        transcripts: [],
        skipped: true,
        reason: "remote_mic_muted",
      });
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
    const shouldLogFrame =
      sequence === 0 || sequence % 20 === 0 || transcripts.length > 0;
    if (shouldLogFrame) {
      console.info("[remote-mic local frame processed]", {
        sessionId,
        role,
        streamId,
        sequence,
        averageLevel: toNumber(body?.averageLevel),
        peakLevel: toNumber(body?.peakLevel),
        transcriptStatuses: summarizeTranscriptStatuses(transcripts),
        transcriptReasons: summarizeTranscriptReasons(transcripts),
      });
    }

    for (const transcript of transcripts) {
      const utteranceGroupId = requiredString(transcript.utteranceGroupId);
      if (transcript.status === "partial" && transcript.finalized === false) {
        const text = requiredString(transcript.text);
        if (text && utteranceGroupId) {
          publishRemoteMicPartialTranscript({
            sessionId,
            role,
            streamId,
            utteranceGroupId,
            text,
            audioCapturedAt: requiredString(transcript.audioCapturedAt) || null,
            speechStartedAt: requiredString(transcript.speechStartedAt) || null,
            firstPartialAt: requiredString(transcript.firstPartialAt) || null,
          });
        }
        continue;
      }

      if (transcript.status !== "accepted") continue;
      if (!transcript.finalized) continue;
      const text = requiredString(transcript.text);
      if (!text || !utteranceGroupId) continue;

      const utterance = await appendOrCreateLocalAsrUtterance({
        sessionId,
        participantCode: active.participantCode,
        role,
        text,
        sourceGroupId: utteranceGroupId,
        startMs: toInteger(transcript.startMs),
        endMs: toInteger(transcript.endMs),
        startedAt: requiredString(transcript.startedAt) || null,
        endedAt: requiredString(transcript.endedAt) || null,
        asrProvider: requiredString(transcript.asrProvider) || "local-asr",
        asrModel: requiredString(transcript.asrModel) || null,
      });
      const dbSavedAt = new Date().toISOString();
      saved.push(utterance);
      publishRemoteMicPartialTranscript({
        sessionId,
        role,
        streamId,
        utteranceGroupId,
        clear: true,
        audioCapturedAt: requiredString(transcript.audioCapturedAt) || null,
        speechStartedAt: requiredString(transcript.speechStartedAt) || null,
        firstPartialAt: requiredString(transcript.firstPartialAt) || null,
        speechEndedDetectedAt: requiredString(transcript.speechEndedDetectedAt) || null,
        transcribedAt: requiredString(transcript.transcribedAt) || null,
        dbSavedAt,
      });
      console.info("[remote-mic final timing]", {
        sessionId,
        role,
        streamId,
        utteranceGroupId,
        audioCapturedAt: transcript.audioCapturedAt ?? null,
        speechStartedAt: transcript.speechStartedAt ?? null,
        firstPartialAt: transcript.firstPartialAt ?? null,
        speechEndedDetectedAt: transcript.speechEndedDetectedAt ?? null,
        transcribedAt: transcript.transcribedAt ?? null,
        dbSavedAt,
      });
    }
    if (saved.length > 0) {
      console.info("[remote-mic local utterance saved]", {
        sessionId,
        role,
        streamId,
        sequence,
        savedCount: saved.length,
        savedIds: saved.map((utterance) => utterance.id),
      });
    }

    return NextResponse.json({
      ok: true,
      worker: workerResponse.worker ?? "connected",
      transcripts,
      saved: saved.map(serializeLocalAsrUtterance),
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

function summarizeTranscriptStatuses(transcripts: LocalAsrTranscript[]) {
  return transcripts.reduce<Record<string, number>>((summary, transcript) => {
    const status = transcript.status ?? "unknown";
    summary[status] = (summary[status] ?? 0) + 1;
    return summary;
  }, {});
}

function summarizeTranscriptReasons(transcripts: LocalAsrTranscript[]) {
  return transcripts
    .map((transcript) => {
      const reason = requiredString(transcript.reason);
      if (!reason) return null;
      return {
        status: transcript.status ?? "unknown",
        reason: reason.slice(0, 240),
      };
    })
    .filter((reason): reason is { status: string; reason: string } => Boolean(reason));
}

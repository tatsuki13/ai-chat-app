import { NextResponse } from "next/server";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import {
  appendOrCreateLocalAsrUtterance,
  serializeLocalAsrUtterance,
  type LocalAsrTranscript,
} from "../../../../../lib/remote-mic/local-asr-save";
import { publishRemoteMicPartialTranscript } from "../../../../../lib/remote-mic/partial-transcripts";

export const runtime = "nodejs";

const LOCAL_ASR_BASE_URL =
  process.env.LOCAL_ASR_BASE_URL || "http://127.0.0.1:8765";
const LOCAL_ASR_TIMEOUT_MS = Number(process.env.LOCAL_ASR_TIMEOUT_MS || 8000);

export async function POST(request: Request) {
  let sessionId = "";
  let role: "elder" | "caregiver" | null = null;
  let streamId = "";

  try {
    const body = (await request.json().catch(() => null)) as {
      sessionId?: unknown;
      role?: unknown;
      streamId?: unknown;
    } | null;

    sessionId = requiredString(body?.sessionId);
    role = parseRemoteMicRole(requiredString(body?.role));
    streamId = requiredString(body?.streamId);

    if (!sessionId || !role || !streamId) {
      return NextResponse.json(
        { error: "sessionId, role, and streamId are required" },
        { status: 400 },
      );
    }

    const active = await getFixedRemoteMicActiveSession();
    if (!active || active.sessionId !== sessionId) {
      console.warn("[remote-mic local flush rejected]", {
        reason: "active_session_mismatch",
        sessionId,
        activeSessionId: active?.sessionId ?? null,
        role,
        streamId,
      });
      return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
    }

    const workerResponse = await postFlushToLocalAsr({ sessionId, role, streamId });
    const transcripts = Array.isArray(workerResponse.transcripts)
      ? (workerResponse.transcripts as LocalAsrTranscript[])
      : [];
    const saved = [];
    console.info("[remote-mic local flush processed]", {
      sessionId,
      role,
      streamId,
      transcriptStatuses: summarizeTranscriptStatuses(transcripts),
      transcriptReasons: summarizeTranscriptReasons(transcripts),
    });

    for (const transcript of transcripts) {
      const utteranceGroupId = requiredString(transcript.utteranceGroupId);
      if (transcript.status === "partial" && transcript.finalized === false) {
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
        source: "flush",
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
        source: "flush",
        sessionId,
        role,
        streamId,
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
    console.error("[remote-mic local flush failed]", {
      sessionId,
      role,
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to flush local ASR stream" },
      { status: 500 },
    );
  }
}

async function postFlushToLocalAsr(payload: {
  sessionId: string;
  role: "elder" | "caregiver";
  streamId: string;
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LOCAL_ASR_TIMEOUT_MS);

  try {
    const response = await fetch(`${LOCAL_ASR_BASE_URL.replace(/\/+$/, "")}/flush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[local-asr flush failed]", {
        status: response.status,
        errorText,
        sessionId: payload.sessionId,
        role: payload.role,
        streamId: payload.streamId,
      });
      throw new Error(`Local ASR worker flush failed: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeoutId);
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

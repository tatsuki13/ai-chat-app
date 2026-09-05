import { NextResponse } from "next/server";
import {
  isRemoteMicRole,
  isRemoteMicSpeechContentType,
  type RemoteMicRealtimeEvent,
} from "../../../../../lib/remote-mic/control-events";
import { publishRemoteMicRealtimeEvent } from "../../../../../lib/ai/speech-state";

export const runtime = "nodejs";

const MAX_TRANSCRIPT_TEXT_LENGTH = 10_000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const event = parseRemoteMicRealtimeEvent(body);

  if (!event) {
    return NextResponse.json(
      { error: "invalid remote mic control event" },
      { status: 400 },
    );
  }

  publishRemoteMicRealtimeEvent(event);

  return NextResponse.json({ ok: true, event });
}

function parseRemoteMicRealtimeEvent(
  body: Record<string, unknown> | null,
): RemoteMicRealtimeEvent | null {
  const type = body?.type;
  const sessionId = requiredString(body?.sessionId);
  const playbackId = requiredString(body?.playbackId);
  const revision =
    typeof body?.revision === "number" && Number.isFinite(body.revision)
      ? body.revision
      : null;
  const timestamp = optionalString(body?.timestamp) ?? new Date().toISOString();

  if (!sessionId) return null;

  if (type === "speech.prepare") {
    if (!playbackId || revision === null) return null;
    const contentType = body.contentType;
    if (!isRemoteMicSpeechContentType(contentType)) return null;
    return { type, sessionId, playbackId, contentType, revision, timestamp };
  }

  if (type === "speech.ended" || type === "speech.cancelled") {
    if (!playbackId || revision === null) return null;
    return {
      type,
      sessionId,
      playbackId,
      revision,
      timestamp,
      releaseAfter: optionalString(body.releaseAfter) ?? null,
    };
  }

  if (type === "mic.suppressed" || type === "mic.resumed") {
    if (!playbackId || revision === null) return null;
    const role = body.role;
    if (!isRemoteMicRole(role) || typeof body.trackLive !== "boolean") {
      return null;
    }
    return {
      type,
      sessionId,
      playbackId,
      role,
      trackLive: body.trackLive,
      revision,
      timestamp,
    };
  }

  if (type === "transcript.flush_request") {
    const requestId = requiredString(body.requestId);
    const reason = body.reason;
    if (!requestId || reason !== "question_generation") return null;

    return {
      type,
      sessionId,
      requestId,
      reason,
      timestamp,
    };
  }

  if (type === "transcript.flush_ack") {
    const requestId = requiredString(body.requestId);
    const role = body.role;
    const outcome = body.outcome;
    const pendingCount =
      typeof body.pendingCount === "number" && Number.isFinite(body.pendingCount)
        ? body.pendingCount
        : null;
    const failedTranscriptKeys = Array.isArray(body.failedTranscriptKeys)
      ? body.failedTranscriptKeys.filter(
          (key): key is string => typeof key === "string" && key.trim().length > 0,
        )
      : [];
    if (
      !requestId ||
      !isRemoteMicRole(role) ||
      (outcome !== "complete" && outcome !== "failed") ||
      pendingCount === null
    ) {
      return null;
    }

    return {
      type,
      sessionId,
      requestId,
      role,
      outcome,
      pendingCount,
      failedTranscriptKeys,
      timestamp,
    };
  }

  if (type === "transcript.partial" || type === "transcript.final") {
    if (revision === null) return null;
    const role = body.role;
    const streamId = requiredString(body.streamId);
    const transcriptId = requiredString(body.transcriptId);
    const text = requiredString(body.text);
    const captureEpoch =
      typeof body.captureEpoch === "number" && Number.isFinite(body.captureEpoch)
        ? body.captureEpoch
        : null;
    if (
      !isRemoteMicRole(role) ||
      !streamId ||
      !transcriptId ||
      !text ||
      captureEpoch === null ||
      text.length > MAX_TRANSCRIPT_TEXT_LENGTH
    ) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      streamId,
      transcriptId,
      revision,
      captureEpoch,
      text,
      startedAt: optionalString(body.startedAt),
      firstPartialAt: optionalString(body.firstPartialAt),
      finalizedAt: optionalString(body.finalizedAt),
      eventId: optionalString(body.eventId),
      model: optionalString(body.model),
    };
  }

  if (type === "mic.speech_started" || type === "mic.speech_finalized") {
    const role = body.role;
    const streamId = requiredString(body.streamId);
    const transcriptId = requiredString(body.transcriptId);
    const captureEpoch =
      typeof body.captureEpoch === "number" && Number.isFinite(body.captureEpoch)
        ? body.captureEpoch
        : null;
    if (
      !isRemoteMicRole(role) ||
      !streamId ||
      !transcriptId ||
      captureEpoch === null
    ) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      streamId,
      transcriptId,
      captureEpoch,
      timestamp,
    };
  }

  if (type === "transcript.discarded") {
    const role = body.role;
    const streamId = requiredString(body.streamId);
    const transcriptId = requiredString(body.transcriptId);
    const reason = requiredString(body.reason);
    if (!isRemoteMicRole(role) || !streamId || !transcriptId || !reason) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      streamId,
      transcriptId,
      reason,
    };
  }

  if (type === "mic.reconnecting") {
    const role = body.role;
    const previousStreamId = requiredString(body.previousStreamId);
    const attempt =
      typeof body.attempt === "number" && Number.isFinite(body.attempt)
        ? body.attempt
        : null;
    const reason = requiredString(body.reason);
    if (!isRemoteMicRole(role) || !previousStreamId || attempt === null || !reason) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      previousStreamId,
      attempt,
      reason,
    };
  }

  if (type === "mic.reconnected") {
    const role = body.role;
    const streamId = requiredString(body.streamId);
    const micPhase = body.micPhase;
    if (
      !isRemoteMicRole(role) ||
      !streamId ||
      (micPhase !== "listening" && micPhase !== "suppressed")
    ) {
      return null;
    }

    return { type, sessionId, role, streamId, micPhase };
  }

  if (type === "mic.reconnect_failed") {
    const role = body.role;
    const attempts =
      typeof body.attempts === "number" && Number.isFinite(body.attempts)
        ? body.attempts
        : null;
    const reason = requiredString(body.reason);
    if (!isRemoteMicRole(role) || attempts === null || !reason) return null;

    return { type, sessionId, role, attempts, reason };
  }

  return null;
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

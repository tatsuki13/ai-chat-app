import { NextResponse } from "next/server";
import {
  isRemoteMicRole,
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
  const revision =
    typeof body?.revision === "number" && Number.isFinite(body.revision)
      ? body.revision
      : null;
  const timestamp = optionalString(body?.timestamp) ?? new Date().toISOString();

  if (!sessionId) return null;

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

  if (type === "mic.capture_state") {
    const role = body.role;
    const playbackId = requiredString(body.playbackId);
    const captureState = body.captureState;
    if (
      !isRemoteMicRole(role) ||
      !playbackId ||
      revision === null ||
      (captureState !== "suppressed" && captureState !== "resumed")
    ) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      playbackId,
      revision,
      captureState,
      timestamp,
    };
  }

  if (type === "mic.capture_error") {
    const role = body.role;
    const playbackId = requiredString(body.playbackId);
    const captureState = body.captureState;
    const reason = requiredString(body.reason);
    if (
      !isRemoteMicRole(role) ||
      !playbackId ||
      revision === null ||
      (captureState !== "suppressed" && captureState !== "resumed") ||
      !reason
    ) {
      return null;
    }

    return {
      type,
      sessionId,
      role,
      playbackId,
      revision,
      captureState,
      reason,
      timestamp,
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
    const captureState = body.captureState;
    if (
      !isRemoteMicRole(role) ||
      !streamId ||
      (captureState !== "listening" && captureState !== "suppressed")
    ) {
      return null;
    }

    return { type, sessionId, role, streamId, captureState };
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

import { NextResponse } from "next/server";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import { prisma } from "../../../../../lib/prisma";

export const runtime = "nodejs";

const CROSSTALK_SUPPRESSION_WINDOW_MS = 4_000;
const CROSSTALK_MIN_NORMALIZED_LENGTH = 8;
const SAME_SPEAKER_MERGE_WINDOW_MS = 30_000;
const SAME_SPEAKER_MERGE_MAX_TEXT_LENGTH = 900;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
    transcriptId?: unknown;
    text?: unknown;
    status?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
    eventId?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));
  const transcriptId = requiredString(body?.transcriptId);
  const text = requiredString(body?.text);
  const status = parseTranscriptStatus(requiredString(body?.status));

  if (!sessionId || !role || !transcriptId || status !== "final") {
    return NextResponse.json(
      { error: "sessionId, role, transcriptId, and final status are required" },
      { status: 400 },
    );
  }

  if (!text) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const active = getActiveFixedRemoteMicSession();
  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }
  const timing = toUtteranceTiming({
    baseAt: active.dialogueStartedAt,
    startedAt: requiredString(body?.startedAt),
    endedAt: requiredString(body?.endedAt),
  });

  const source = `remote_realtime:${transcriptId}`;
  const existing = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId,
      OR: [
        { source },
        {
          source: {
            contains: transcriptId,
          },
        },
      ],
    },
  });

  if (!existing) {
    const crosstalkSource = await findRecentCrosstalkUtterance({
      sessionId,
      role,
      text,
    });

    if (crosstalkSource) {
      console.info("[remote-mic realtime transcript skipped as crosstalk]", {
        sessionId,
        role,
        transcriptId,
        sourceUtteranceId: crosstalkSource.id,
      });

      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "crosstalk_duplicate",
        sourceUtteranceId: crosstalkSource.id,
      });
    }
  }

  const utterance = existing ?? (await appendOrCreateRemoteUtterance({
    sessionId,
    participantCode: active.participantCode,
    role,
    text,
    source,
    transcriptId,
    timing,
  }));

  console.info("[remote-mic realtime transcript saved]", {
    sessionId,
    role,
    transcriptId,
    textLength: text.length,
    duplicate: Boolean(existing),
    merged: utterance.source !== source,
  });

  return NextResponse.json({
    ok: true,
    utterance: {
      id: utterance.id,
      session_id: utterance.sessionId,
      speaker: utterance.speaker,
      text: utterance.text,
      start_ms: utterance.startMs,
      end_ms: utterance.endMs,
      created_at: utterance.createdAt.toISOString(),
    },
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTranscriptStatus(value: string) {
  return value === "partial" || value === "final" ? value : null;
}

function toUtteranceTiming(input: {
  baseAt: string | null;
  startedAt: string;
  endedAt: string;
}): UtteranceTiming {
  const baseMs = parseTimestampMs(input.baseAt);
  const startedAtMs = parseTimestampMs(input.startedAt);
  const endedAtMs = parseTimestampMs(input.endedAt);

  if (baseMs === null) {
    return {
      startMs: null,
      endMs: null,
    };
  }

  const startMs =
    startedAtMs === null ? null : Math.max(0, Math.round(startedAtMs - baseMs));
  const endMs =
    endedAtMs === null ? null : Math.max(startMs ?? 0, Math.round(endedAtMs - baseMs));

  return {
    startMs,
    endMs,
  };
}

function parseTimestampMs(value: string | null) {
  if (!value) return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function appendOrCreateRemoteUtterance(input: {
  sessionId: string;
  participantCode: string | null;
  role: "elder" | "caregiver";
  text: string;
  source: string;
  transcriptId: string;
  timing: UtteranceTiming;
}) {
  const latestUtterance = await prisma.sessionUtterance.findFirst({
    where: {
      sessionId: input.sessionId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      speaker: true,
      text: true,
      source: true,
      startMs: true,
      endMs: true,
      createdAt: true,
    },
  });

  if (canMergeWithLatestRemoteUtterance(latestUtterance, input.role, input.text)) {
    const nextSource = appendTranscriptIdToSource(
      latestUtterance.source,
      input.transcriptId,
    );

    return prisma.sessionUtterance.update({
      where: {
        id: latestUtterance.id,
      },
      data: {
        text: joinTranscriptText(latestUtterance.text, input.text),
        source: nextSource,
        startMs: latestUtterance.startMs ?? input.timing.startMs,
        endMs: input.timing.endMs ?? latestUtterance.endMs,
      },
    });
  }

  return prisma.sessionUtterance.create({
    data: {
      sessionId: input.sessionId,
      participantCode: input.participantCode,
      speaker: input.role,
      text: input.text,
      source: input.source,
      startMs: input.timing.startMs,
      endMs: input.timing.endMs,
    },
  });
}

type UtteranceTiming = {
  startMs: number | null;
  endMs: number | null;
};

function canMergeWithLatestRemoteUtterance(
  latestUtterance: {
    speaker: string;
    text: string;
    source: string | null;
    createdAt: Date;
  } | null,
  role: "elder" | "caregiver",
  text: string,
) {
  if (!latestUtterance) return false;
  if (latestUtterance.speaker !== role) return false;
  if (!latestUtterance.source?.startsWith("remote_realtime:")) return false;
  if (Date.now() - latestUtterance.createdAt.getTime() > SAME_SPEAKER_MERGE_WINDOW_MS) {
    return false;
  }

  return (
    joinTranscriptText(latestUtterance.text, text).length <=
    SAME_SPEAKER_MERGE_MAX_TEXT_LENGTH
  );
}

function appendTranscriptIdToSource(source: string | null, transcriptId: string) {
  if (!source) return `remote_realtime:${transcriptId}`;
  if (source.includes(transcriptId)) return source;

  return `${source},${transcriptId}`;
}

function joinTranscriptText(currentText: string, nextText: string) {
  const current = currentText.trim();
  const next = nextText.trim();

  if (!current) return next;
  if (!next) return current;

  return `${current} ${next}`;
}

async function findRecentCrosstalkUtterance(input: {
  sessionId: string;
  role: "elder" | "caregiver";
  text: string;
}) {
  const normalizedText = normalizeTranscriptForCrosstalk(input.text);

  if (normalizedText.length < CROSSTALK_MIN_NORMALIZED_LENGTH) {
    return null;
  }

  const recentOppositeRoleUtterances = await prisma.sessionUtterance.findMany({
    where: {
      sessionId: input.sessionId,
      speaker: input.role === "elder" ? "caregiver" : "elder",
      createdAt: {
        gte: new Date(Date.now() - CROSSTALK_SUPPRESSION_WINDOW_MS),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      text: true,
    },
  });

  return (
    recentOppositeRoleUtterances.find((utterance) =>
      isLikelySameTranscript(normalizedText, utterance.text),
    ) ?? null
  );
}

function isLikelySameTranscript(normalizedText: string, candidateText: string) {
  const normalizedCandidate = normalizeTranscriptForCrosstalk(candidateText);

  if (normalizedCandidate.length < CROSSTALK_MIN_NORMALIZED_LENGTH) {
    return false;
  }

  return (
    normalizedText === normalizedCandidate ||
    normalizedText.includes(normalizedCandidate) ||
    normalizedCandidate.includes(normalizedText)
  );
}

function normalizeTranscriptForCrosstalk(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s、。,.，．！？!?「」『』（）()[\]{}]/g, "");
}

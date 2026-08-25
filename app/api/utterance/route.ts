import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { normalizeConversationSpeaker } from "../../../lib/acp-mvp";
import {
  createUtteranceTiming,
  pickUtteranceTimingBase,
} from "../../../lib/server/utterance-timing";
import {
  normalizeUtteranceSource,
  UTTERANCE_ANALYSIS_VERSION,
} from "../../../lib/server/utterance-metadata";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);
    const rawSpeaker = requiredString(body.speaker);
    const speaker = normalizeSpeaker(rawSpeaker);
    const text = requiredString(body.text);
    const requestedAt = new Date();
    const source = normalizeUtteranceSource(
      body.source,
      body.source === "local_voice" ? "local_voice" : "manual",
    );

    if (!sessionId || !isSpeaker(rawSpeaker) || !text) {
      return NextResponse.json(
        { error: "session_id, speaker, and text are required" },
        { status: 400 },
      );
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        participantCode: true,
        startedAt: true,
        dialogueStartedAt: true,
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const timing = createUtteranceTiming({
      baseAt: pickUtteranceTimingBase(session),
      startedAt: body.startedAt ?? body.started_at,
      endedAt: body.endedAt ?? body.ended_at,
      fallbackAt: requestedAt,
    });

    const utterance = await prisma.sessionUtterance.create({
      data: {
        sessionId,
        participantCode: session.participantCode,
        speaker,
        text,
        startMs: timing.startMs,
        endMs: timing.endMs,
        source,
        analysisVersion: UTTERANCE_ANALYSIS_VERSION,
      },
    });
    return NextResponse.json({
      utterance: {
        id: utterance.id,
        session_id: utterance.sessionId,
        speaker: utterance.speaker,
        text: utterance.text,
        start_ms: utterance.startMs,
        end_ms: utterance.endMs,
        source: utterance.source,
        analysis_version: utterance.analysisVersion,
        created_at: utterance.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to save utterance" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSpeaker(value: string) {
  return normalizeConversationSpeaker(value);
}

function isSpeaker(value: string): value is "elder" | "caregiver" {
  return value === "elder" || value === "caregiver";
}

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { createInitialSlotStates } from "../../../../lib/acp-store";
import { issueSessionAccessToken } from "../../../../lib/auth";
import { AI_POLICY_VERSION } from "../../../../lib/llm";
import { DISCUSSION_TOPICS } from "../../../../lib/acp-mvp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedParticipantCode = optionalString(
      body.participant_code ?? body.participantCode,
    );
    const participantCode =
      requestedParticipantCode ?? (await createUniqueParticipantCode());
    const condition = optionalString(body.condition);
    const accessToken = issueSessionAccessToken();

    if (requestedParticipantCode) {
      const existing = await prisma.session.findFirst({
        where: { participantCode: requestedParticipantCode },
        select: { id: true },
      });

      if (existing) {
        return NextResponse.json(
          { error: "participant_code already exists" },
          { status: 409 },
        );
      }
    }

    const session = await prisma.session.create({
      data: {
        participantCode,
        condition,
        sessionAccessTokenHash: accessToken.tokenHash,
        currentTopicIndex: 0,
        currentTopicId: DISCUSSION_TOPICS[0]?.id ?? null,
        conversationPhase: "created",
        protocolVersion: optionalString(body.protocol_version ?? body.protocolVersion),
        appVersion: process.env.npm_package_version ?? null,
        aiPolicyVersion: AI_POLICY_VERSION,
      },
    });
    const slotStates = await createInitialSlotStates(session.id);

    return NextResponse.json({
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        current_topic_id: session.currentTopicId,
        current_topic_index: session.currentTopicIndex,
        topic_started_at: session.topicStartedAt?.toISOString() ?? null,
        conversation_phase: session.conversationPhase,
        topic_paused_ms: session.topicPausedMs,
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      session_access_token: accessToken.token,
      slot_states: slotStates,
    });
  } catch (error) {
    console.error(error);

    if (isUniqueConstraintError(error)) {
      return NextResponse.json(
        { error: "participant_code already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 },
    );
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function createUniqueParticipantCode() {
  const base = createParticipantCodeBase(new Date());

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.session.findFirst({
      where: { participantCode: candidate },
      select: { id: true },
    });

    if (!existing) return candidate;
  }

  return `${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function createParticipantCodeBase(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return [
    "P-",
    byType.get("year"),
    byType.get("month"),
    byType.get("day"),
    "-",
    byType.get("hour"),
    byType.get("minute"),
    byType.get("second"),
  ].join("");
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

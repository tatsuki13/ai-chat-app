import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../../../lib/prisma";
import { createInitialSlotStates } from "../../../../lib/acp-store";
import { issueSessionAccessToken } from "../../../../lib/auth";
import { AI_POLICY_VERSION } from "../../../../lib/llm";
import { DISCUSSION_TOPICS } from "../../../../lib/acp-mvp";
import { isMissingColumnError, rememberSessionTokenHash } from "../../../../lib/db-compat";

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

    if (condition === "dev") {
      if (!requestedParticipantCode) {
        return NextResponse.json(
          { error: "source participant_code is required for dev condition" },
          { status: 400 },
        );
      }

      const sourceSession = await findSourceSession(requestedParticipantCode);

      if (!sourceSession) {
        return NextResponse.json(
          { error: "source session not found" },
          { status: 404 },
        );
      }

      const devParticipantCode = await createUniqueDevParticipantCode(
        requestedParticipantCode,
      );
      const session = await createDevSessionWithCompat({
        participantCode: devParticipantCode,
        accessTokenHash: accessToken.tokenHash,
        protocolVersion: optionalString(body.protocol_version ?? body.protocolVersion),
        utterances: sourceSession.utterances,
      });
      const slotStates = await createInitialSlotStates(session.id);

      return NextResponse.json({
        session: serializeSession(session),
        source_session: {
          id: sourceSession.id,
          participant_code: sourceSession.participantCode,
          utterance_count: sourceSession.utterances.length,
        },
        session_access_token: accessToken.token,
        slot_states: slotStates,
      });
    }

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

    const session = await createSessionWithCompat({
      participantCode,
      condition,
      accessTokenHash: accessToken.tokenHash,
      protocolVersion: optionalString(body.protocol_version ?? body.protocolVersion),
    });
    const slotStates = await createInitialSlotStates(session.id);

    return NextResponse.json({
      session: serializeSession(session),
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

async function createSessionWithCompat(input: {
  participantCode: string | undefined;
  condition: string | undefined;
  accessTokenHash: string;
  protocolVersion?: string;
}) {
  try {
    return await prisma.session.create({
      data: {
        participantCode: input.participantCode,
        condition: input.condition,
        sessionAccessTokenHash: input.accessTokenHash,
        currentTopicIndex: 0,
        currentTopicId: DISCUSSION_TOPICS[0]?.id ?? null,
        conversationPhase: "created",
        protocolVersion: input.protocolVersion,
        appVersion: process.env.npm_package_version ?? null,
        aiPolicyVersion: AI_POLICY_VERSION,
      },
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;

    const session = await createLegacySessionRaw({
      participantCode: input.participantCode,
      condition: input.condition,
    });
    rememberSessionTokenHash(session.id, input.accessTokenHash);

    return {
      ...session,
      currentTopicId: DISCUSSION_TOPICS[0]?.id ?? null,
      currentTopicIndex: 0,
      topicStartedAt: null,
      conversationPhase: "created",
      topicPausedMs: 0,
    };
  }
}

async function findSourceSession(participantCode: string) {
  return prisma.session.findFirst({
    where: {
      participantCode,
      condition: { notIn: ["dev", "replay"] },
    },
    orderBy: [{ endedAt: "desc" }, { startedAt: "desc" }],
    select: {
      id: true,
      participantCode: true,
      utterances: {
        orderBy: { createdAt: "asc" },
        select: {
          speaker: true,
          text: true,
          createdAt: true,
        },
      },
    },
  });
}

async function createDevSessionWithCompat(input: {
  participantCode: string;
  accessTokenHash: string;
  protocolVersion?: string;
  utterances: Array<{ speaker: string; text: string; createdAt: Date }>;
}) {
  const utterances = {
    create: input.utterances.map((utterance) => ({
      speaker: utterance.speaker,
      text: utterance.text,
      createdAt: utterance.createdAt,
    })),
  };

  try {
    return await prisma.session.create({
      data: {
        participantCode: input.participantCode,
        condition: "dev",
        sessionAccessTokenHash: input.accessTokenHash,
        currentTopicId: DISCUSSION_TOPICS[0]?.id ?? null,
        currentTopicIndex: 0,
        conversationPhase: "created",
        protocolVersion: input.protocolVersion,
        appVersion: process.env.npm_package_version ?? null,
        aiPolicyVersion: AI_POLICY_VERSION,
        utterances,
      },
    });
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;

    const session = await createLegacySessionRaw({
      participantCode: input.participantCode,
      condition: "dev",
    });
    await prisma.sessionUtterance.createMany({
      data: input.utterances.map((utterance) => ({
        sessionId: session.id,
        speaker: utterance.speaker,
        text: utterance.text,
        createdAt: utterance.createdAt,
      })),
    });
    rememberSessionTokenHash(session.id, input.accessTokenHash);

    return {
      ...session,
      currentTopicId: DISCUSSION_TOPICS[0]?.id ?? null,
      currentTopicIndex: 0,
      topicStartedAt: null,
      conversationPhase: "created",
      topicPausedMs: 0,
    };
  }
}

async function createLegacySessionRaw(input: {
  participantCode: string | undefined;
  condition: string | undefined;
}) {
  const id = randomUUID();
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      participant_code: string | null;
      condition: string | null;
      started_at: Date;
      dialogue_started_at: Date | null;
      ended_at: Date | null;
    }>
  >`
    INSERT INTO sessions (id, participant_code, condition)
    VALUES (${id}, ${input.participantCode ?? null}, ${input.condition ?? null})
    RETURNING id, participant_code, condition, started_at, dialogue_started_at, ended_at
  `;
  const [session] = rows;
  if (!session) throw new Error("Failed to create legacy session");

  return {
    id: session.id,
    participantCode: session.participant_code,
    condition: session.condition,
    startedAt: session.started_at,
    dialogueStartedAt: session.dialogue_started_at,
    endedAt: session.ended_at,
  };
}

function serializeSession(session: {
  id: string;
  participantCode: string | null;
  condition: string | null;
  startedAt: Date;
  dialogueStartedAt: Date | null;
  currentTopicId: string | null;
  currentTopicIndex: number | null;
  topicStartedAt: Date | null;
  conversationPhase: string | null;
  topicPausedMs: number;
  endedAt: Date | null;
}) {
  return {
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
  };
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

async function createUniqueDevParticipantCode(sourceParticipantCode: string) {
  const normalized = sourceParticipantCode.replace(/[^A-Za-z0-9_-]/g, "-");
  const base = `dev_${normalized}`;

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

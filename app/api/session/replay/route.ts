import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { createInitialSlotStates, getSessionContext } from "../../../../lib/acp-store";
import { normalizeConversationSpeaker } from "../../../../lib/acp-mvp";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

const REPLAY_PREFIX = "tatsuki_";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const replayParticipantCode = requiredString(
      body.participant_code ?? body.participantCode,
    );

    if (!replayParticipantCode.startsWith(REPLAY_PREFIX)) {
      return NextResponse.json(
        { error: "participant_code must start with tatsuki_" },
        { status: 400 },
      );
    }

    const sourceParticipantCode = replayParticipantCode.slice(REPLAY_PREFIX.length).trim();
    if (!sourceParticipantCode) {
      return NextResponse.json(
        { error: "source participant_code is required" },
        { status: 400 },
      );
    }

    const existingSessionWithReplayCode = await prisma.session.findFirst({
      where: {
        participantCode: replayParticipantCode,
      },
      select: { id: true, condition: true },
    });

    if (existingSessionWithReplayCode && existingSessionWithReplayCode.condition !== "replay") {
      return NextResponse.json(
        { error: "replay participant_code already exists as a normal session" },
        { status: 409 },
      );
    }

    if (existingSessionWithReplayCode) {
      const sourceSession = await findSourceSession(sourceParticipantCode);
      if (!sourceSession) {
        return NextResponse.json(
          { error: "source session not found" },
          { status: 404 },
        );
      }
      await createInitialSlotStates(existingSessionWithReplayCode.id);
      const utteranceIdMap = await syncReplayUtterancesFromSource({
        replaySessionId: existingSessionWithReplayCode.id,
        replayParticipantCode,
        sourceUtterances: sourceSession.utterances,
      });
      await syncReplaySlotStatesFromSource({
        replaySessionId: existingSessionWithReplayCode.id,
        replayParticipantCode,
        sourceSlotStates: sourceSession.slotStates,
        sourceSubSlotStates: sourceSession.subSlotStates,
        utteranceIdMap,
      });

      return NextResponse.json(
        await buildReplayResponse({
          sessionId: existingSessionWithReplayCode.id,
          sourceParticipantCode,
          sourceSession,
          reused: true,
        }),
      );
    }

    const sourceSession = await findSourceSession(sourceParticipantCode);

    if (!sourceSession) {
      return NextResponse.json(
        { error: "source session not found" },
        { status: 404 },
      );
    }

    const session = await prisma.session.create({
      data: {
        participantCode: replayParticipantCode,
        condition: "replay",
      },
      include: {
        utterances: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const slotStates = await createInitialSlotStates(session.id);
    const utteranceIdMap = await syncReplayUtterancesFromSource({
      replaySessionId: session.id,
      replayParticipantCode,
      sourceUtterances: sourceSession.utterances,
    });
    await syncReplaySlotStatesFromSource({
      replaySessionId: session.id,
      replayParticipantCode,
      sourceSlotStates: sourceSession.slotStates,
      sourceSubSlotStates: sourceSession.subSlotStates,
      utteranceIdMap,
    });

    return NextResponse.json(
      await buildReplayResponse({
        sessionId: session.id,
        sourceParticipantCode,
        sourceSession,
        slotStates,
        reused: false,
      }),
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to create replay session" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function syncReplayUtterancesFromSource(input: {
  replaySessionId: string;
  replayParticipantCode: string;
  sourceUtterances: Array<{
    id: string;
    speaker: string;
    text: string;
    startMs: number | null;
    endMs: number | null;
    source: string | null;
    analysisVersion: string | null;
    createdAt: Date;
  }>;
}): Promise<Map<string, string>> {
  const existingReplayUtterances = await prisma.sessionUtterance.findMany({
    where: {
      sessionId: input.replaySessionId,
    },
    select: {
      id: true,
      speaker: true,
      text: true,
      source: true,
      createdAt: true,
    },
  });
  const existingBySourceId = new Map(
    existingReplayUtterances
      .map((utterance) => [parseReplaySourceUtteranceId(utterance.source), utterance] as const)
      .filter((entry): entry is readonly [string, typeof existingReplayUtterances[number]] =>
        Boolean(entry[0]),
      ),
  );
  const utteranceIdMap = new Map<string, string>();

  for (const sourceUtterance of input.sourceUtterances) {
    const existing =
      existingBySourceId.get(sourceUtterance.id) ??
      existingReplayUtterances.find((utterance) =>
        isLegacyReplayUtteranceMatch(utterance, sourceUtterance),
      );

    if (existing) {
      utteranceIdMap.set(sourceUtterance.id, existing.id);
      if (existing.source?.startsWith("replay:")) continue;

      await prisma.sessionUtterance.update({
        where: { id: existing.id },
        data: {
          participantCode: input.replayParticipantCode,
          startMs: sourceUtterance.startMs,
          endMs: sourceUtterance.endMs,
          source: buildReplaySource(sourceUtterance),
          analysisVersion: sourceUtterance.analysisVersion,
        },
      });
      continue;
    }

    const created = await prisma.sessionUtterance.create({
      data: {
        sessionId: input.replaySessionId,
        participantCode: input.replayParticipantCode,
        speaker: sourceUtterance.speaker,
        text: sourceUtterance.text,
        startMs: sourceUtterance.startMs,
        endMs: sourceUtterance.endMs,
        source: buildReplaySource(sourceUtterance),
        analysisVersion: sourceUtterance.analysisVersion,
        createdAt: sourceUtterance.createdAt,
      },
      select: { id: true },
    });
    utteranceIdMap.set(sourceUtterance.id, created.id);
  }

  return utteranceIdMap;
}

function parseReplaySourceUtteranceId(source: string | null) {
  if (!source?.startsWith("replay:")) return null;

  return source.slice("replay:".length).split(":")[0] || null;
}

function buildReplaySource(utterance: { id: string; source: string | null }) {
  return utterance.source
    ? `replay:${utterance.id}:${utterance.source}`
    : `replay:${utterance.id}`;
}

function isLegacyReplayUtteranceMatch(
  replayUtterance: {
    speaker: string;
    text: string;
    createdAt: Date;
  },
  sourceUtterance: {
    speaker: string;
    text: string;
    createdAt: Date;
  },
) {
  return (
    replayUtterance.speaker === sourceUtterance.speaker &&
    replayUtterance.text === sourceUtterance.text &&
    replayUtterance.createdAt.getTime() === sourceUtterance.createdAt.getTime()
  );
}

async function syncReplaySlotStatesFromSource(input: {
  replaySessionId: string;
  replayParticipantCode: string;
  sourceSlotStates: Array<{
    slotName: string;
    status: string;
    summary: string;
    evidenceUtterance: string | null;
  }>;
  sourceSubSlotStates: Array<{
    mainSlotId: string;
    subSlotId: string;
    completion: string;
    responseState: string;
    reasonCode: string | null;
    evidenceUtteranceIds: Prisma.JsonValue;
    canAskAgain: boolean;
    isDeferred: boolean;
    lastUpdatedTopicId: string | null;
    depth: string | null;
  }>;
  utteranceIdMap: Map<string, string>;
}) {
  await Promise.all(
    input.sourceSlotStates.map((state) =>
      prisma.slotState.upsert({
        where: {
          sessionId_slotName: {
            sessionId: input.replaySessionId,
            slotName: state.slotName,
          },
        },
        create: {
          sessionId: input.replaySessionId,
          participantCode: input.replayParticipantCode,
          slotName: state.slotName,
          status: state.status,
          summary: state.summary,
          evidenceUtterance: state.evidenceUtterance,
        },
        update: {
          participantCode: input.replayParticipantCode,
          status: state.status,
          summary: state.summary,
          evidenceUtterance: state.evidenceUtterance,
        },
      }),
    ),
  );

  await Promise.all(
    input.sourceSubSlotStates.map((state) =>
      prisma.slotSubState.upsert({
        where: {
          sessionId_mainSlotId_subSlotId: {
            sessionId: input.replaySessionId,
            mainSlotId: state.mainSlotId,
            subSlotId: state.subSlotId,
          },
        },
        create: {
          sessionId: input.replaySessionId,
          participantCode: input.replayParticipantCode,
          mainSlotId: state.mainSlotId,
          subSlotId: state.subSlotId,
          completion: state.completion,
          responseState: state.responseState,
          reasonCode: state.reasonCode,
          evidenceUtteranceIds: remapEvidenceUtteranceIds(
            state.evidenceUtteranceIds,
            input.utteranceIdMap,
          ) as Prisma.InputJsonValue,
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
          depth: state.depth,
        },
        update: {
          participantCode: input.replayParticipantCode,
          completion: state.completion,
          responseState: state.responseState,
          reasonCode: state.reasonCode,
          evidenceUtteranceIds: remapEvidenceUtteranceIds(
            state.evidenceUtteranceIds,
            input.utteranceIdMap,
          ) as Prisma.InputJsonValue,
          canAskAgain: state.canAskAgain,
          isDeferred: state.isDeferred,
          lastUpdatedTopicId: state.lastUpdatedTopicId,
          depth: state.depth,
        },
      }),
    ),
  );
}

function remapEvidenceUtteranceIds(
  value: Prisma.JsonValue,
  utteranceIdMap: Map<string, string>,
) {
  if (!Array.isArray(value)) return [];

  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item : String(item)))
        .map((id) => utteranceIdMap.get(id.trim()))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

async function findSourceSession(sourceParticipantCode: string) {
  return prisma.session.findFirst({
    where: {
      participantCode: sourceParticipantCode,
      condition: { not: "replay" },
    },
    orderBy: [{ endedAt: "desc" }, { startedAt: "desc" }],
    include: {
      utterances: {
        orderBy: { createdAt: "asc" },
      },
      slotStates: true,
      subSlotStates: true,
    },
  });
}

async function buildReplayResponse(input: {
  sessionId: string;
  sourceParticipantCode: string;
  sourceSession: Awaited<ReturnType<typeof findSourceSession>>;
  slotStates?: Awaited<ReturnType<typeof createInitialSlotStates>>;
  reused: boolean;
}) {
  const context = await getSessionContext(input.sessionId);

  return {
    reused: input.reused,
    session: {
      id: context.session.id,
      participant_code: context.session.participantCode,
      condition: context.session.condition,
      started_at: context.session.startedAt.toISOString(),
      dialogue_started_at: context.session.dialogueStartedAt?.toISOString() ?? null,
      ended_at: context.session.endedAt?.toISOString() ?? null,
    },
    source_session: {
      participant_code:
        input.sourceSession?.participantCode ?? input.sourceParticipantCode,
      started_at:
        input.sourceSession?.startedAt.toISOString() ??
        context.session.startedAt.toISOString(),
      ended_at: input.sourceSession?.endedAt?.toISOString() ?? null,
      utterance_count: input.sourceSession?.utterances.length ?? context.utterances.length,
    },
    utterance_count: context.utterances.length,
    utterances: context.utterances.map((utterance) => ({
      id: utterance.id,
      speaker: normalizeConversationSpeaker(utterance.speaker),
      text: utterance.text,
      start_ms: utterance.start_ms,
      end_ms: utterance.end_ms,
      source: utterance.source,
      analysis_version: utterance.analysis_version,
      created_at: utterance.created_at,
    })),
    slot_states: input.slotStates ?? context.slotStates,
  };
}

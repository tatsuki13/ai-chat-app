import { NextResponse } from "next/server";
import {
  buildSlotControlDebugState,
  createEmptySlotStates,
  isSlotClassificationResponseState,
  isSlotCompletion,
  isSlotReasonCode,
  mergeSlotStates,
  normalizeConversationSpeaker,
  normalizeSlotStatus,
  type StoredSubSlotState,
} from "../../../../../lib/acp-mvp";
import { buildSemanticSlotControlDebugState } from "../../../../../lib/llm";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminOrSessionAccess } from "../../../../../lib/auth";
import { hasDatabaseColumn } from "../../../../../lib/db-compat";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireAdminOrSessionAccess(_request, id);
    if ("response" in auth) return auth.response;

    const session = await loadAdminSessionDetail(id);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const slotStates = mergeSlotStates(
      createEmptySlotStates(),
      session.slotStates.map((slot) => ({
        slot_name: slot.slotName,
        status: normalizeSlotStatus(slot.status),
        summary: slot.summary,
        evidence_utterance: slot.evidenceUtterance ?? "",
        updated_at: slot.updatedAt.toISOString(),
      })),
    );

    const normalizedUtterances = session.utterances.map((utterance) => ({
      id: utterance.id,
      speaker: normalizeConversationSpeaker(utterance.speaker),
      text: utterance.text,
      created_at: utterance.createdAt.toISOString(),
    }));
    const searchParams = new URL(_request.url).searchParams;
    const currentTopic = optionalString(searchParams.get("current_topic"));
    const useSemanticSlotControl = searchParams.get("semantic") === "1";
    const subSlotStates = session.subSlotStates.map((state): StoredSubSlotState => ({
      mainSlotId: state.mainSlotId,
      subSlotId: state.subSlotId,
      completion: isSlotCompletion(state.completion) ? state.completion : "none",
      responseState: isSlotClassificationResponseState(state.responseState)
        ? state.responseState
        : "no_response",
      reasonCode:
        state.reasonCode && isSlotReasonCode(state.reasonCode)
          ? state.reasonCode
          : null,
      evidenceUtteranceIds: Array.isArray(state.evidenceUtteranceIds)
        ? state.evidenceUtteranceIds.map(String)
        : [],
      canAskAgain: state.canAskAgain,
      isDeferred: state.isDeferred,
      depth:
        state.depth === "none" || state.depth === "minimal" || state.depth === "elaborated"
          ? state.depth
          : undefined,
      lastUpdatedTopicId: state.lastUpdatedTopicId,
      updatedAt: state.updatedAt.toISOString(),
    }));
    const slotControl = useSemanticSlotControl
      ? await buildSemanticSlotControlDebugState({
          utterances: normalizedUtterances,
          slots: slotStates,
          currentTopic,
        })
      : buildSlotControlDebugState({
          slots: slotStates,
          currentTopic,
          subSlotStates,
        });

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
      utterances: normalizedUtterances.map((utterance) => ({
        id: utterance.id,
        session_id: session.id,
        participant_code: session.participantCode,
        speaker: utterance.speaker,
        text: utterance.text,
        created_at: utterance.created_at,
      })),
      slot_states: slotStates,
      sub_slot_states: subSlotStates,
      slot_control: slotControl,
      final_minutes: session.finalMinutes.map((minutes) => ({
        id: minutes.id,
        session_id: minutes.sessionId,
        participant_code: session.participantCode,
        markdown: minutes.markdown,
        json: minutes.json,
        created_at: minutes.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load session detail" },
      { status: 500 },
    );
  }
}

async function loadAdminSessionDetail(id: string) {
  const hasProgressColumns = await hasDatabaseColumn("sessions", "current_topic_id");
  const hasDepthColumn = await hasDatabaseColumn("slot_sub_states", "depth");

  return prisma.session.findUnique({
    where: { id },
    select: {
      id: true,
      participantCode: true,
      condition: true,
      startedAt: true,
      dialogueStartedAt: true,
      endedAt: true,
      ...(hasProgressColumns
        ? {
            currentTopicId: true,
            currentTopicIndex: true,
            topicStartedAt: true,
            conversationPhase: true,
            topicPausedMs: true,
          }
        : {}),
      utterances: {
        orderBy: { createdAt: "asc" },
      },
      slotStates: true,
      subSlotStates: hasDepthColumn
        ? true
        : {
            select: {
              id: true,
              sessionId: true,
              mainSlotId: true,
              subSlotId: true,
              completion: true,
              responseState: true,
              reasonCode: true,
              evidenceUtteranceIds: true,
              canAskAgain: true,
              isDeferred: true,
              lastUpdatedTopicId: true,
              updatedAt: true,
            },
          },
      finalMinutes: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  }).then((session) =>
    session
      ? {
          ...session,
          currentTopicId: hasProgressColumns ? session.currentTopicId : null,
          currentTopicIndex: hasProgressColumns ? session.currentTopicIndex : 0,
          topicStartedAt: hasProgressColumns ? session.topicStartedAt : null,
          conversationPhase: hasProgressColumns ? session.conversationPhase : null,
          topicPausedMs: hasProgressColumns ? session.topicPausedMs : 0,
        }
      : null,
  );
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

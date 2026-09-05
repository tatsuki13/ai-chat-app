import { NextResponse } from "next/server";
import {
  getSessionContext,
} from "../../../../lib/acp-store";
import {
  buildSlotControlDebugState,
  resolveDiscussionTopic,
} from "../../../../lib/acp-mvp";
import { generateNextQuestion } from "../../../../lib/ai/next-question";
import { logAIIntervention } from "../../../../lib/ai/intervention-log";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const requestedAt = new Date();
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);
    const preparedQuestionId = requiredString(
      body.prepared_question_id ?? body.preparedQuestionId,
    );

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    if (preparedQuestionId) {
      return displayPreparedQuestion({
        sessionId,
        preparedQuestionId,
        requestedAt,
      });
    }

    const currentTopic = optionalString(body.current_topic ?? body.currentTopic);
    const currentTopicTitle = optionalString(
      body.current_topic_title ?? body.currentTopicTitle,
    );
    const context = await getSessionContext(sessionId);
    const topic = resolveDiscussionTopic(currentTopic);
    const aiQuestionLogs = await prisma.aIInterventionLog.findMany({
      where: {
        sessionId,
        type: "NEXT_QUESTION",
        OR: [
          { topicId: topic.id },
          { topicId: topic.slot_name },
          { metadata: { path: ["targetMainSlotId"], equals: topic.id } },
        ],
      },
      orderBy: { generatedAt: "asc" },
      take: 50,
      select: {
        content: true,
        topicId: true,
        generatedAt: true,
        metadata: true,
      },
    });
    const result = await generateNextQuestion({
      ...context,
      currentTopic,
      currentTopicTitle,
      currentTopicQuestionCount: aiQuestionLogs.length,
      aiQuestionHistory: aiQuestionLogs.map((log) => {
        const metadata =
          log.metadata && typeof log.metadata === "object" && !Array.isArray(log.metadata)
            ? (log.metadata as Record<string, unknown>)
            : {};

        return {
          content: log.content,
          topicId: log.topicId,
          generatedAt: log.generatedAt.toISOString(),
          targetMainSlotId:
            typeof metadata.targetMainSlotId === "string"
              ? metadata.targetMainSlotId
              : null,
          targetSubSlotId:
            typeof metadata.targetSubSlotId === "string"
              ? metadata.targetSubSlotId
              : null,
          questionPurpose:
            typeof metadata.questionPurpose === "string"
              ? metadata.questionPurpose
              : null,
        };
      }),
    });
    const generatedAt = new Date();
    const suggestion = {
      suggestion_type: "next_question",
      content: result.question,
      question: result.question,
      transition_phrase: result.transition_phrase,
      target_slot: result.target_slot,
      targetMainSlotId: result.targetMainSlotId,
      targetSubSlotId: result.targetSubSlotId,
      questionPurpose: result.questionPurpose,
      reasonForSelection: result.reasonForSelection,
      no_relevant_followup: result.no_relevant_followup === true,
      reason: result.reason,
      sensitivity: result.sensitivity,
      slot_states_updated: false,
      control_debug: buildSlotControlDebugState({
        slots: context.slotStates,
        currentTopic,
        subSlotStates: context.subSlotStates,
      }),
      created_at: generatedAt.toISOString(),
    };
    if (result.question) {
      await logAIIntervention({
        sessionId,
        participantCode: context.session.participantCode,
        type: "NEXT_QUESTION",
        content: suggestion.content,
        topicId: currentTopic ?? null,
        requestedAt,
        generatedAt,
        metadata: {
          currentTopic,
          currentTopicTitle,
          targetSlot: result.target_slot,
          targetMainSlotId: result.targetMainSlotId,
          targetSubSlotId: result.targetSubSlotId,
          questionPurpose: result.questionPurpose,
          reasonForSelection: result.reasonForSelection,
          noRelevantFollowup: result.no_relevant_followup === true,
          sensitivity: result.sensitivity,
        },
      });
    }

    return NextResponse.json({
      suggestion,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to generate next question" },
      { status: 500 },
    );
  }
}

async function displayPreparedQuestion(input: {
  sessionId: string;
  preparedQuestionId: string;
  requestedAt: Date;
}) {
  const prepared = await prisma.preparedQuestion.findFirst({
    where: {
      id: input.preparedQuestionId,
      sessionId: input.sessionId,
      status: "prepared",
    },
    include: {
      session: {
        select: {
          participantCode: true,
        },
      },
    },
  });

  if (!prepared) {
    return NextResponse.json(
      { error: "Prepared question not found" },
      { status: 404 },
    );
  }

  const displayedAt = new Date();
  const [latestUtterance, activeState] = await Promise.all([
    prisma.sessionUtterance.findFirst({
      where: { sessionId: input.sessionId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.aIProcessingState.findUnique({
      where: { sessionId: input.sessionId },
      select: { slotRevision: true },
    }),
  ]);
  const currentConversationRevision = latestUtterance?.id ?? null;
  if (
    prepared.basedOnUtteranceId !== currentConversationRevision ||
    (activeState && prepared.slotRevision !== activeState.slotRevision)
  ) {
    await prisma.preparedQuestion.updateMany({
      where: {
        id: prepared.id,
        sessionId: input.sessionId,
        status: "prepared",
      },
      data: {
        status: "invalidated",
        invalidatedAt: displayedAt,
        invalidationReason: "conversation_revision_changed",
      },
    });
    console.info("[ai prepared question display rejected]", {
      sessionId: input.sessionId,
      preparedQuestionId: prepared.id,
      preparedQuestionInvalidationReason: "conversation_revision_changed",
      conversationRevision: currentConversationRevision,
      basedOnUtteranceId: prepared.basedOnUtteranceId,
      slotRevision: prepared.slotRevision,
      activeSlotRevision: activeState?.slotRevision ?? null,
    });

    return NextResponse.json(
      { error: "Prepared question is stale" },
      { status: 409 },
    );
  }

  const updated = await prisma.preparedQuestion.updateMany({
    where: {
      id: prepared.id,
      sessionId: input.sessionId,
      status: "prepared",
      displayLogCommittedAt: null,
    },
    data: {
      status: "displayed",
      displayedAt,
      displayLogCommittedAt: displayedAt,
    },
  });

  const suggestion = {
    suggestion_type: "next_question",
    content: prepared.question,
    question: prepared.question,
    transition_phrase: prepared.transitionPhrase,
    target_slot: prepared.topicSlotName,
    targetMainSlotId: prepared.targetMainSlotId,
    targetSubSlotId: prepared.targetSubSlotId,
    questionPurpose: prepared.questionPurpose,
    reasonForSelection: prepared.reasonForSelection,
    no_relevant_followup: false,
    reason: prepared.reasonForSelection,
    sensitivity: "low",
    slot_states_updated: false,
    prepared_question_id: prepared.id,
    basedOnUtteranceId: prepared.basedOnUtteranceId,
    slotRevision: prepared.slotRevision,
    created_at: displayedAt.toISOString(),
  };

  if (updated.count > 0) {
    await logAIIntervention({
      sessionId: input.sessionId,
      participantCode: prepared.session.participantCode,
      type: "NEXT_QUESTION",
      content: prepared.question,
      topicId: prepared.topicId,
      requestedAt: input.requestedAt,
      generatedAt: displayedAt,
      displayedAt,
      metadata: {
        preparedQuestionId: prepared.id,
        topicSlotName: prepared.topicSlotName,
        targetMainSlotId: prepared.targetMainSlotId,
        targetSubSlotId: prepared.targetSubSlotId,
        questionPurpose: prepared.questionPurpose,
        reasonForSelection: prepared.reasonForSelection,
        basedOnUtteranceId: prepared.basedOnUtteranceId,
        slotRevision: prepared.slotRevision,
      },
    });
  }

  return NextResponse.json({ suggestion });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

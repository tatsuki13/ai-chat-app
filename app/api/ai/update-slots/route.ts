import { NextResponse } from "next/server";
import {
  getUnprocessedSlotUtterances,
  getSessionContext,
  saveSubSlotStates,
  saveSlotStates,
} from "../../../../lib/acp-store";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { updateSlotStateBundleFromConversation } from "../../../../lib/ai/slot-state";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const currentTopic = optionalString(body.current_topic ?? body.currentTopic);
    const currentTopicTitle = optionalString(
      body.current_topic_title ?? body.currentTopicTitle,
    );
    const context = await getSessionContext(sessionId);
    const processingState = await prisma.aIProcessingState.findUnique({
      where: { sessionId },
    });
    const utterancesToClassify = getUnprocessedSlotUtterances(
      context.utterances,
      processingState?.lastProcessedUtteranceId,
    );
    const bundle = await updateSlotStateBundleFromConversation({
      ...context,
      currentTopic,
      currentTopicTitle,
      utterancesToClassify,
    });
    if (
      utterancesToClassify.length > 0 &&
      bundle.debug.summary.llmSucceeded !== true
    ) {
      return NextResponse.json(
        { error: "Failed to update slots from new utterances" },
        { status: 502 },
      );
    }
    await saveSlotStates(sessionId, bundle.slotStates);
    await saveSubSlotStates(sessionId, bundle.subSlotStates);
    const latestProcessedUtterance = utterancesToClassify.at(-1);
    if (latestProcessedUtterance?.id) {
      await prisma.aIProcessingState.upsert({
        where: { sessionId },
        create: {
          sessionId,
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: latestProcessedUtterance.id,
          lastProcessedAt: new Date(),
          slotRevision: 1,
          processingStatus: "ready",
          processingFinishedAt: new Date(),
        },
        update: {
          participantCode: context.session.participantCode,
          lastProcessedUtteranceId: latestProcessedUtterance.id,
          lastProcessedAt: new Date(),
          slotRevision: { increment: 1 },
          processingStatus: "ready",
          processingFinishedAt: new Date(),
          lastError: null,
        },
      });
    }
    const slotControl = buildSlotControlDebugState({
      slots: bundle.slotStates,
      currentTopic,
      subSlotStates: bundle.subSlotStates,
      classificationDebug: bundle.debug.summary,
    });

    return NextResponse.json({
      slot_states: bundle.slotStates,
      sub_slot_states: bundle.subSlotStates,
      slot_control: slotControl,
      slot_classification_debug: bundle.debug,
      final_minutes: null,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to update slots" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

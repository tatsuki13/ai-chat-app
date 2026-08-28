import { NextResponse } from "next/server";
import {
  getChangedSlotStates,
  getChangedSubSlotStates,
  getUnprocessedSlotUtterances,
  getSessionContext,
  saveSubSlotStates,
  saveSlotStates,
} from "../../../../lib/acp-store";
import { buildSlotControlDebugState } from "../../../../lib/acp-mvp";
import { updateSlotStateBundleFromConversation } from "../../../../lib/ai/slot-state";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

const SLOT_UPDATE_TRANSACTION_MAX_WAIT_MS = 10_000;
const SLOT_UPDATE_TRANSACTION_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  let sessionId = "";

  try {
    const startedAt = Date.now();
    const body = await request.json();
    sessionId = requiredString(body.session_id ?? body.sessionId);

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
    console.info("[ai update-slots start]", {
      sessionId,
      utterancesToClassifyCount: utterancesToClassify.length,
      slotStateCount: context.slotStates.length,
      subSlotStateCount: context.subSlotStates.length,
      lastProcessedUtteranceId: processingState?.lastProcessedUtteranceId ?? null,
    });
    const bundle = await updateSlotStateBundleFromConversation({
      ...context,
      currentTopic,
      currentTopicTitle,
      utterancesToClassify,
    });
    const classificationFinishedAt = Date.now();
    if (
      utterancesToClassify.length > 0 &&
      bundle.debug.summary.llmSucceeded !== true
    ) {
      await prisma.aIProcessingState.upsert({
        where: { sessionId },
        create: {
          sessionId,
          participantCode: context.session.participantCode,
          processingStatus: "failed",
          lastError: "slot_classification_failed",
          processingStartedAt: new Date(),
          processingFinishedAt: new Date(),
        },
        update: {
          participantCode: context.session.participantCode,
          processingStatus: "failed",
          lastError: "slot_classification_failed",
          processingFinishedAt: new Date(),
        },
      });
      console.error("[ai update-slots classification failed]", {
        sessionId,
        utterancesToClassifyCount: utterancesToClassify.length,
        source: bundle.debug.summary.source,
        llmSucceeded: bundle.debug.summary.llmSucceeded,
      });

      return NextResponse.json(
        { error: "Failed to update slots from new utterances" },
        { status: 502 },
      );
    }
    const latestProcessedUtterance = utterancesToClassify.at(-1);
    const changedSlotStates = getChangedSlotStates(
      context.slotStates,
      bundle.slotStates,
    );
    const changedSubSlotStates = getChangedSubSlotStates(
      context.subSlotStates,
      bundle.subSlotStates,
    );
    console.info("[ai update-slots diff]", {
      sessionId,
      slotTotal: bundle.slotStates.length,
      slotChanged: changedSlotStates.length,
      subSlotTotal: bundle.subSlotStates.length,
      subSlotChanged: changedSubSlotStates.length,
    });
    const transactionStartedAt = Date.now();
    await prisma.$transaction(
      async (tx) => {
        if (changedSlotStates.length > 0) {
          await saveSlotStates(sessionId, changedSlotStates, tx);
        }
        if (changedSubSlotStates.length > 0) {
          await saveSubSlotStates(sessionId, changedSubSlotStates, tx);
        }
        if (latestProcessedUtterance?.id) {
          await tx.preparedQuestion.updateMany({
            where: {
              sessionId,
              status: "prepared",
            },
            data: {
              status: "invalidated",
              invalidatedAt: new Date(),
              invalidationReason: "slot_state_updated",
            },
          });

          await tx.aIProcessingState.upsert({
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
      },
      {
        maxWait: SLOT_UPDATE_TRANSACTION_MAX_WAIT_MS,
        timeout: SLOT_UPDATE_TRANSACTION_TIMEOUT_MS,
      },
    );
    console.info("[ai update-slots saved]", {
      sessionId,
      utterancesToClassifyCount: utterancesToClassify.length,
      slotStateCount: bundle.slotStates.length,
      subSlotStateCount: bundle.subSlotStates.length,
      slotWrites: changedSlotStates.length,
      subSlotWrites: changedSubSlotStates.length,
      classificationMs: classificationFinishedAt - startedAt,
      transactionMs: Date.now() - transactionStartedAt,
      totalMs: Date.now() - startedAt,
    });
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
    console.error("[ai update-slots failed]", {
      sessionId,
      stage: "update_slots",
      error: error instanceof Error ? error.message : String(error),
    });

    if (sessionId) {
      await prisma.aIProcessingState
        .upsert({
          where: { sessionId },
          create: {
            sessionId,
            processingStatus: "failed",
            lastError: error instanceof Error ? error.message : "Failed to update slots",
            processingStartedAt: new Date(),
            processingFinishedAt: new Date(),
          },
          update: {
            processingStatus: "failed",
            lastError: error instanceof Error ? error.message : "Failed to update slots",
            processingFinishedAt: new Date(),
          },
        })
        .catch((stateError) => {
          console.error("[ai update-slots failed to record state]", {
            sessionId,
            error: stateError instanceof Error ? stateError.message : String(stateError),
          });
        });
    }

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

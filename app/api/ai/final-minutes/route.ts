import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { toJsonValue } from "../../../../lib/acp-mvp";
import {
  getSessionContext,
  saveFinalMinutes,
} from "../../../../lib/acp-store";
import { generateFinalMinutes } from "../../../../lib/ai";
import { logAIIntervention } from "../../../../lib/ai/intervention-log";
import { prisma } from "../../../../lib/prisma";
import { updateSlotsForAllTopics } from "../../../../lib/server/slot-processing";

export const runtime = "nodejs";

const FINAL_MINUTES_ACTION_TYPE = "FINAL_MINUTES_REQUEST";
const FINAL_MINUTES_PROCESSING_TIMEOUT_MS = 180_000;

export async function POST(request: Request) {
  let requestId = "";
  let sessionId = "";

  try {
    const requestedAt = new Date();
    const body = await request.json();
    requestId = requiredString(body.request_id ?? body.requestId);
    sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const currentTopic = optionalString(body.current_topic ?? body.currentTopic);
    const currentTopicTitle = optionalString(
      body.current_topic_title ?? body.currentTopicTitle,
    );
    const finalize = body.finalize === true;
    const requestState = await claimFinalMinutesRequest({
      requestId,
      sessionId,
      currentTopic,
      currentTopicTitle,
      requestedAt,
      finalize,
    });

    if (requestState.status === "completed" && requestState.result) {
      return NextResponse.json({
        ...requestState.result,
        requestId,
        request_status: "completed",
        idempotent_replay: true,
      });
    }

    if (requestState.status === "processing") {
      return NextResponse.json(
        {
          requestId,
          request_status: "processing",
          in_progress: true,
          error: "final_minutes_processing",
        },
        { status: 409 },
      );
    }

    if (requestState.status === "failed") {
      return NextResponse.json(
        {
          requestId,
          request_status: "failed",
          failed: true,
          error: requestState.error ?? "final_minutes_request_failed",
        },
        { status: 409 },
      );
    }

    const slotUpdate = await updateSlotsForAllTopics({
      sessionId,
    });

    const context = await getSessionContext(sessionId);
    const minutes = await generateFinalMinutes({
      ...context,
      currentTopic,
      currentTopicTitle,
      sessionId: context.session.id,
      participantCode: context.session.participantCode,
    });
    const savedMinutes = await saveFinalMinutes(sessionId, minutes);
    const session = finalize
      ? await prisma.session.update({
          where: { id: sessionId },
          data: { endedAt: context.session.endedAt ?? new Date() },
        })
      : context.session;
    const generatedAt = savedMinutes.createdAt;
    await logAIIntervention({
      sessionId,
      type: "FINAL_MINUTES",
      content: savedMinutes.markdown,
      topicId: currentTopic ?? null,
      requestedAt,
      generatedAt,
      metadata: {
        currentTopic,
        currentTopicTitle,
        finalMinuteId: savedMinutes.id,
        finalizedSession: finalize,
        participantCode: session.participantCode,
      },
    });

    const response = {
      requestId,
      request_status: "completed",
      session: {
        id: session.id,
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        dialogue_started_at: session.dialogueStartedAt?.toISOString() ?? null,
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      slot_states: context.slotStates,
      sub_slot_states: context.subSlotStates,
      slot_update_outcome:
        slotUpdate.updated.length > 0 ? "updated" : "already_current",
      slot_update_results: slotUpdate.results,
      final_minutes: {
        id: savedMinutes.id,
        markdown: savedMinutes.markdown,
        json: savedMinutes.json,
        created_at: savedMinutes.createdAt.toISOString(),
      },
    };

    await completeFinalMinutesRequest({
      requestId,
      response,
      finalMinuteId: savedMinutes.id,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (requestId) {
      await failFinalMinutesRequest({ requestId, error });
    }
    console.error("[ai final-minutes failed]", {
      requestId: requestId || null,
      sessionId: sessionId || null,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to generate final minutes" },
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

async function claimFinalMinutesRequest(input: {
  requestId: string;
  sessionId: string;
  currentTopic?: string | null;
  currentTopicTitle?: string | null;
  requestedAt: Date;
  finalize: boolean;
}): Promise<{
  status: "claimed" | "processing" | "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
}> {
  const existing = await prisma.aIActionEvent.findUnique({
    where: { id: input.requestId },
    select: {
      sessionId: true,
      actionType: true,
      result: true,
      metadata: true,
      createdAt: true,
    },
  });

  if (existing) {
    return interpretExistingFinalMinutesRequest(input, existing);
  }

  const staleBefore = new Date(
    input.requestedAt.getTime() - FINAL_MINUTES_PROCESSING_TIMEOUT_MS,
  );
  const lockKey = `final-minutes:${input.sessionId}`;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existingAfterLock = await tx.aIActionEvent.findUnique({
        where: { id: input.requestId },
        select: {
          sessionId: true,
          actionType: true,
          result: true,
          metadata: true,
          createdAt: true,
        },
      });
      if (existingAfterLock) {
        return interpretExistingFinalMinutesRequest(input, existingAfterLock);
      }

      const activeSameSessionRequest = await tx.aIActionEvent.findFirst({
        where: {
          sessionId: input.sessionId,
          actionType: FINAL_MINUTES_ACTION_TYPE,
          result: "processing",
          createdAt: { gte: staleBefore },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
        },
      });

      if (activeSameSessionRequest) {
        await tx.aIActionEvent.create({
          data: {
            id: input.requestId,
            sessionId: input.sessionId,
            actionType: FINAL_MINUTES_ACTION_TYPE,
            currentTopicId: input.currentTopic ?? null,
            currentTopicTitle: input.currentTopicTitle ?? null,
            result: "failed",
            metadata: toPrismaJson({
              requestId: input.requestId,
              status: "failed",
              requestedAt: input.requestedAt.toISOString(),
              failedAt: input.requestedAt.toISOString(),
              error: "duplicate_final_minutes_request_in_progress",
              activeRequestId: activeSameSessionRequest.id,
              finalize: input.finalize,
            }),
          },
        });
        console.info("[ai final-minutes request duplicate blocked]", {
          requestId: input.requestId,
          activeRequestId: activeSameSessionRequest.id,
          sessionId: input.sessionId,
          activeCreatedAt: activeSameSessionRequest.createdAt.toISOString(),
        });
        return {
          status: "failed" as const,
          error: "duplicate_final_minutes_request_in_progress",
        };
      }

      await tx.aIActionEvent.create({
        data: {
          id: input.requestId,
          sessionId: input.sessionId,
          actionType: FINAL_MINUTES_ACTION_TYPE,
          currentTopicId: input.currentTopic ?? null,
          currentTopicTitle: input.currentTopicTitle ?? null,
          result: "processing",
          metadata: toPrismaJson({
            requestId: input.requestId,
            status: "processing",
            requestedAt: input.requestedAt.toISOString(),
            processingStartedAt: input.requestedAt.toISOString(),
            currentTopic: input.currentTopic ?? null,
            currentTopicTitle: input.currentTopicTitle ?? null,
            finalize: input.finalize,
          }),
        },
      });

      console.info("[ai final-minutes request claimed]", {
        requestId: input.requestId,
        sessionId: input.sessionId,
        finalize: input.finalize,
      });
      return { status: "claimed" as const };
    });

    return result;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const createdByOtherRequest = await prisma.aIActionEvent.findUnique({
      where: { id: input.requestId },
      select: {
        sessionId: true,
        actionType: true,
        result: true,
        metadata: true,
        createdAt: true,
      },
    });
    if (!createdByOtherRequest) throw error;
    return interpretExistingFinalMinutesRequest(input, createdByOtherRequest);
  }
}

function interpretExistingFinalMinutesRequest(
  input: {
    requestId: string;
    sessionId: string;
  },
  existing: {
    sessionId: string;
    actionType: string;
    result: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  },
): {
  status: "processing" | "completed" | "failed";
  result?: Record<string, unknown> | null;
  error?: string | null;
} {
  if (
    existing.sessionId !== input.sessionId ||
    existing.actionType !== FINAL_MINUTES_ACTION_TYPE
  ) {
    throw new Error("final_minutes_request_id_reused_for_different_scope");
  }

  const metadata = asRecord(existing.metadata) ?? {};
  const status = normalizeRequestStatus(metadata.status, existing.result);
  const result = asRecord(metadata.result);

  if (status === "completed" && result) {
    console.info("[ai final-minutes request replay completed]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
    });
    return { status: "completed", result };
  }

  if (status === "failed") {
    return {
      status: "failed",
      error: typeof metadata.error === "string" ? metadata.error : null,
    };
  }

  const staleBefore = Date.now() - FINAL_MINUTES_PROCESSING_TIMEOUT_MS;
  if (existing.createdAt.getTime() < staleBefore) {
    console.warn("[ai final-minutes request stale processing]", {
      requestId: input.requestId,
      sessionId: input.sessionId,
      createdAt: existing.createdAt.toISOString(),
    });
  }

  return { status: "processing" };
}

async function completeFinalMinutesRequest(input: {
  requestId: string;
  response: Record<string, unknown>;
  finalMinuteId: string;
}) {
  const completedAt = new Date();
  await prisma.aIActionEvent.update({
    where: { id: input.requestId },
    data: {
      result: "completed",
      generatedText: input.finalMinuteId,
      metadata: toPrismaJson({
        requestId: input.requestId,
        status: "completed",
        completedAt: completedAt.toISOString(),
        finalMinuteId: input.finalMinuteId,
        result: input.response,
      }),
    },
  });
}

async function failFinalMinutesRequest(input: {
  requestId: string;
  error: unknown;
}) {
  const failedAt = new Date();
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await prisma.aIActionEvent
    .update({
      where: { id: input.requestId },
      data: {
        result: "failed",
        metadata: toPrismaJson({
          requestId: input.requestId,
          status: "failed",
          failedAt: failedAt.toISOString(),
          error: message,
        }),
      },
    })
    .catch((updateError) => {
      console.warn("[ai final-minutes failed-state save failed]", {
        requestId: input.requestId,
        error:
          updateError instanceof Error ? updateError.message : String(updateError),
      });
    });
}

function normalizeRequestStatus(
  metadataStatus: unknown,
  result: string | null,
): "processing" | "completed" | "failed" {
  if (metadataStatus === "completed" || result === "completed") return "completed";
  if (metadataStatus === "failed" || result === "failed") return "failed";
  return "processing";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toPrismaJson(value: Record<string, unknown>) {
  return toJsonValue(value) as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown) {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

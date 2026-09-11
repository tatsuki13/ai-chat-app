import { NextResponse } from "next/server";
import { generateAiQuestionForTopic } from "../../../../lib/server/ai-question";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requestId = requiredString(body.request_id ?? body.requestId);
    const sessionId = requiredString(body.session_id ?? body.sessionId);

    if (!requestId) {
      return NextResponse.json({ error: "request_id is required" }, { status: 400 });
    }
    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const result = await generateAiQuestionForTopic({
      requestId,
      sessionId,
      currentTopicId: optionalString(
        body.current_topic_id ?? body.currentTopicId,
      ),
      currentTopic: optionalString(body.current_topic ?? body.currentTopic),
      currentTopicTitle: optionalString(
        body.current_topic_title ?? body.currentTopicTitle,
      ),
    });

    return NextResponse.json(result);
  } catch (error) {
    const errorDetails = classifyAiQuestionError(error);
    console.error("[ai next-question failed]", {
      stage: errorDetails.stage,
      category: errorDetails.category,
      error: errorDetails.log,
    });

    return NextResponse.json(
      {
        error: "Failed to generate next question",
        error_code: errorDetails.category,
      },
      { status: errorDetails.status },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function classifyAiQuestionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : null;
  const log = {
    name: error instanceof Error ? error.name : null,
    code,
    message,
  };

  if (
    message.includes("slot_processing_in_progress") ||
    message.includes("duplicate_ai_question_request_in_progress")
  ) {
    return {
      status: 409,
      category: "processing_conflict",
      stage: "request_claim",
      log,
    };
  }

  if (code?.startsWith("P")) {
    return {
      status: 500,
      category: "database_error",
      stage: "database",
      log,
    };
  }

  if (message.includes("llm") || message.includes("OpenAI")) {
    return {
      status: 502,
      category: "llm_error",
      stage: "llm",
      log,
    };
  }

  return {
    status: 500,
    category: "question_generation_error",
    stage: "unknown",
    log,
  };
}

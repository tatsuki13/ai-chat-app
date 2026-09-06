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
    console.error("[ai next-question failed]", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "Failed to generate next question" },
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

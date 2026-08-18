import { NextResponse } from "next/server";
import {
  getSessionContext,
} from "../../../../lib/acp-store";
import { generateTopicSwitch } from "../../../../lib/llm";
import {
  buildSlotControlDebugState,
  DISCUSSION_TOPICS,
  resolveDiscussionTopic,
} from "../../../../lib/acp-mvp";

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
    const nextTopic = optionalString(body.next_topic ?? body.nextTopic);
    const nextTopicTitle = optionalString(body.next_topic_title ?? body.nextTopicTitle);
    const forceSwitch = Boolean(body.force_switch ?? body.forceSwitch);
    const context = await getSessionContext(sessionId);
    const result =
      forceSwitch && nextTopic
        ? createForcedTopicSwitch(nextTopic, nextTopicTitle)
        : await generateTopicSwitch({
            ...context,
            currentTopic,
            currentTopicTitle,
            nextTopic,
            nextTopicTitle,
          });

    return NextResponse.json({
      suggestion: {
        suggestion_type: "switch_topic",
        content: result.message,
        message: result.message,
        target_slot: result.target_slot,
        should_switch: result.should_switch,
        next_topic: result.next_topic,
        reason: result.reason,
        sensitivity: result.sensitivity,
        slot_states_updated: false,
        control_debug: buildSlotControlDebugState({
          slots: context.slotStates,
          currentTopic,
          subSlotStates: context.subSlotStates,
        }),
        created_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to generate topic switch" },
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

function createForcedTopicSwitch(nextTopic: string, nextTopicTitle?: string) {
  const resolvedTopic = resolveDiscussionTopic(nextTopic);
  const topic = DISCUSSION_TOPICS.find((item) => item.id === resolvedTopic.id);
  const resolvedSlotName = resolvedTopic.slot_name;
  const title = nextTopicTitle || resolvedTopic.title;
  const openingPrompt =
    topic?.opening_prompt ??
    `${resolvedTopic.title}について少し伺ってもよいですか。`;

  return {
    should_switch: true,
    message: `ここまでのお話を大切にしながら、次に「${title}」について少し伺ってもよいですか。\n${openingPrompt}`,
    target_slot: resolvedSlotName,
    next_topic: resolvedSlotName,
    reason:
      "次の話題へ進む操作が選択されたため、時間配分に合わせて話題を切り替えました。",
    sensitivity: "low" as const,
  };
}

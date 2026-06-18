import { NextResponse } from "next/server";
import {
  analyzeTranscript,
  createExitJudgement,
  createMemoJson,
  createMemoMarkdown,
  createQuestionCandidates,
  createTopicShiftSuggestions,
  type AcpSlotRecord,
  type ActionButtonType,
  type Utterance,
} from "../../../lib/acp";
import {
  buildExitJudgementPrompt,
  buildMemoPrompt,
  buildQuestionSuggestionPrompt,
  buildTopicShiftPrompt,
} from "../../../lib/acp-prompts";

type AcpRequestBody = {
  action: ActionButtonType;
  transcript: Utterance[];
  slots?: AcpSlotRecord[];
};

export async function POST(request: Request) {
  const body = (await request.json()) as AcpRequestBody;
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const slots = Array.isArray(body.slots) ? body.slots : analyzeTranscript(transcript);

  if (body.action === "update_memo") {
    const updatedSlots = analyzeTranscript(transcript);

    return NextResponse.json({
      slots: updatedSlots,
      json_minutes: createMemoJson(transcript, updatedSlots),
      markdown_minutes: createMemoMarkdown(updatedSlots, transcript),
      llm_prompt: buildMemoPrompt(transcript),
    });
  }

  if (body.action === "question_suggestions") {
    return NextResponse.json({
      slots,
      suggestions: createQuestionCandidates(slots, transcript),
      llm_prompt: buildQuestionSuggestionPrompt(transcript, slots),
    });
  }

  if (body.action === "topic_shift") {
    return NextResponse.json({
      slots,
      suggestions: createTopicShiftSuggestions(slots, transcript),
      llm_prompt: buildTopicShiftPrompt(transcript, slots),
    });
  }

  if (body.action === "exit_check") {
    return NextResponse.json({
      slots,
      exit_judgement: createExitJudgement(slots),
      llm_prompt: buildExitJudgementPrompt(slots),
    });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

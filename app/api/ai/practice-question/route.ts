import { NextResponse } from "next/server";
import {
  createOpenAIClient,
  getDefaultOpenAITimeoutMs,
  getDialogueOpenAIModel,
} from "../../../../lib/ai/client";

export const runtime = "nodejs";

const FALLBACK_QUESTION = "その動物のことを思い出すと、どんな気持ちになりますか。";
const MAX_UTTERANCE_COUNT = 12;
const MAX_TEXT_LENGTH = 4000;

type PracticeUtterance = {
  speaker: "elder" | "caregiver" | "unknown";
  text: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const utterances = parseUtterances(body?.utterances);
  const topic = optionalString(body?.topic) ?? "動物についての練習";

  if (utterances.length === 0) {
    return NextResponse.json({
      suggestion: {
        question: "好きな動物のどんなところが好きですか。",
        transition_phrase: "",
      },
      fallback: true,
    });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");

    const client = createOpenAIClient({
      apiKey,
      timeout: getDefaultOpenAITimeoutMs(),
    });
    const response = await client.chat.completions.create({
      model: getDialogueOpenAIModel(),
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: [
            "あなたは実験前の操作練習を手伝う日本語の対話支援AIです。",
            "ACP、医療、介護、将来の意思決定には触れないでください。",
            "直近の会話から、高齢者にも分かりやすい短い質問を1件だけ作ってください。",
            "返答はJSONのみ: {\"transition_phrase\":\"\",\"question\":\"...\"}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            topic,
            conversation: utterances.map((utterance) => ({
              speaker: getSpeakerLabel(utterance.speaker),
              text: utterance.text,
            })),
          }),
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = parseQuestionJson(response.choices[0]?.message?.content);
    return NextResponse.json({
      suggestion: {
        transition_phrase: parsed.transition_phrase,
        question: parsed.question,
      },
      fallback: false,
    });
  } catch (error) {
    console.warn("[practice question generation failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({
      suggestion: {
        transition_phrase: "",
        question: FALLBACK_QUESTION,
      },
      fallback: true,
    });
  }
}

function parseUtterances(value: unknown): PracticeUtterance[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const record = item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};
      const speaker = parseSpeaker(record.speaker);
      const text = optionalString(record.text)?.slice(0, 400) ?? "";
      return text ? { speaker, text } : null;
    })
    .filter((item): item is PracticeUtterance => Boolean(item))
    .slice(-MAX_UTTERANCE_COUNT);
}

function parseSpeaker(value: unknown): PracticeUtterance["speaker"] {
  return value === "elder" || value === "caregiver" ? value : "unknown";
}

function parseQuestionJson(value: string | null | undefined) {
  const fallback = {
    transition_phrase: "",
    question: FALLBACK_QUESTION,
  };
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const question = optionalString(parsed.question);
    return {
      transition_phrase: optionalString(parsed.transition_phrase) ?? "",
      question: question && question.length <= 80 ? question : fallback.question,
    };
  } catch {
    return fallback;
  }
}

function getSpeakerLabel(speaker: PracticeUtterance["speaker"]) {
  if (speaker === "elder") return "本人";
  if (speaker === "caregiver") return "介護者";
  return "話者";
}

function optionalString(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_TEXT_LENGTH) : undefined;
}

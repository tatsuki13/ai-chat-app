import OpenAI from "openai";

export const runtime = "nodejs";

const FALLBACK_REPLIES = [
  "少し考える時間が必要な話題かもしれません。話しやすいところからで大丈夫です。",
  "今の話で、特に大切にしたい点はありますか。",
  "無理に結論を出さなくても大丈夫です。思いつく範囲で話してみてください。",
];

function clampReply(value: unknown, interventionCount = 0) {
  const fallback = FALLBACK_REPLIES[interventionCount % FALLBACK_REPLIES.length];
  const text = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (text.length <= 80) return text;

  return `${text.slice(0, 79)}…`;
}

function getFallbackReply(interventionCount: number) {
  return FALLBACK_REPLIES[interventionCount % FALLBACK_REPLIES.length];
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      current_topic,
      recent_transcript,
      silence_duration_ms,
      intervention_count,
    } = body;

    if (!current_topic || typeof current_topic !== "object") {
      return Response.json(
        { error: "current_topic is required" },
        { status: 400 }
      );
    }

    const parsedInterventionCount = Number.isFinite(Number(intervention_count))
      ? Number(intervention_count)
      : 0;

    if (!process.env.OPENAI_API_KEY) {
      return Response.json({
        reply: getFallbackReply(parsedInterventionCount),
        source: "fallback",
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      input: [
        {
          role: "system",
          content:
            "あなたはACP対話を見守る中立的司会者です。会話の主役にならず、長い要約、医療助言、価値判断、結論誘導をしません。返答は日本語で1〜2文、80文字以内。質問は最大1つ。会話を再開しやすくする短い促しだけを返してください。",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              current_topic,
              recent_transcript,
              silence_duration_ms,
              intervention_count: parsedInterventionCount,
            },
            null,
            2
          ),
        },
      ],
      max_output_tokens: 80,
    });

    return Response.json({
      reply: clampReply(response.output_text, parsedInterventionCount),
      source: "openai",
    });
  } catch (error) {
    console.error(error);

    return Response.json({
      reply: getFallbackReply(0),
      source: "fallback",
      error: "Failed to generate moderator prompt",
    });
  }
}

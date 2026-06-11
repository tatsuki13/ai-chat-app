import OpenAI from "openai";

export const runtime = "nodejs";

const FALLBACK_REPLIES = [
  "ここまでで、この話題について考え始めたことや、少し気になっていることが言葉になりつつあります。もし続けるなら、話しやすい観点を一つ選んで触れてみてもよさそうです。",
  "ここまでで、大切にしたいことを少しずつ探している様子が出ています。もし続けるなら、まだ言葉にしきれていない不安について触れてみてもよさそうです。",
];

function clampReply(value: unknown, interventionCount = 0) {
  const fallback = FALLBACK_REPLIES[interventionCount % FALLBACK_REPLIES.length];
  const text = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (text.length <= 120) return text;

  return `${text.slice(0, 119)}…`;
}

function getFallbackReply(
  interventionCount: number,
  expressedPoints: unknown[] = [],
  promptedSlot?: unknown
) {
  const fallback = FALLBACK_REPLIES[interventionCount % FALLBACK_REPLIES.length];
  const nextSlot =
    typeof promptedSlot === "string" && promptedSlot.trim()
      ? promptedSlot.trim()
      : "まだ言葉にしきれていないこと";
  const firstExpressedPoint =
    expressedPoints.length > 0
      ? String(expressedPoints[0]).split(":")[0]
      : "";

  if (!firstExpressedPoint) return fallback;

  return `ここまでで、${firstExpressedPoint}についての思いが少しずつ言葉になっています。もし続けるなら、${nextSlot}について、話しやすい範囲で触れてみてもよさそうです。`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      current_topic,
      acpSlots,
      recent_transcript,
      already_expressed_points,
      missing_or_unclear_slots,
      silence_duration_ms,
      intervention_count,
      intervention_reason,
      prompted_slot,
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
    const slots = Array.isArray(acpSlots) ? acpSlots : [];
    const expressedPoints = Array.isArray(already_expressed_points)
      ? already_expressed_points
      : [];
    const missingSlots = Array.isArray(missing_or_unclear_slots)
      ? missing_or_unclear_slots
      : [];

    if (!process.env.OPENAI_API_KEY) {
      return Response.json({
        reply: getFallbackReply(
          parsedInterventionCount,
          expressedPoints,
          prompted_slot
        ),
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
          content: [
            "あなたはACP対話を支える中立的司会者です。",
            "役割は、参加者の発言を評価することではなく、言語化された希望・不安・価値観を短く整理し、次に話しやすい観点を提示することです。",
            "",
            "制約:",
            "- 医療助言をしない",
            "- 介護方針を決めない",
            "- 価値判断をしない",
            "- 結論を急がせない",
            "- 「〜すべき」「〜しなければならない」と言わない",
            "- 参加者の発言を断定的に解釈しない",
            "- 1回の介入で質問は1つまで",
            "- 80〜120文字以内",
            "- やわらかく、安心できる表現にする",
            "- JSONではなく、通常文だけを返す",
            "",
            "返答の構成:",
            "1文目: ここまで言語化できたことを短く受け止める。",
            "2文目: missing_or_unclear_slots または prompted_slot から、まだ話せていない観点を1つだけやわらかく促す。",
            "話題を勝手に次へ進めず、医療や介護の判断を提案しない。"
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              current_topic,
              acpSlots: slots,
              recent_transcript,
              already_expressed_points: expressedPoints,
              missing_or_unclear_slots: missingSlots,
              silence_duration_ms,
              intervention_count: parsedInterventionCount,
              intervention_reason,
              prompted_slot,
            },
            null,
            2
          ),
        },
      ],
      max_output_tokens: 160,
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

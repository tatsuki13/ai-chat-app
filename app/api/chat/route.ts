import OpenAI from "openai";

export const runtime = "nodejs";

const FALLBACK_REPLIES_BY_REASON: Record<string, string[]> = {
  silence: [
    "少し間が空いても大丈夫です。答えを急がず、話しやすいところから続けられそうです。",
    "まだ考えがまとまっていなくても大丈夫です。思いつくことをそのまま置いてみるところからでもよさそうです。",
  ],
  short_answer: [
    "短い言葉の中にも、大切にしたい感覚が少し含まれていそうです。無理にまとめず、そのまま続けても大丈夫です。",
    "ひとことでも、今大事にしたい感覚の手がかりになりそうです。急がず、そのまま続けても大丈夫です。",
  ],
  manual_reflection: [
    "ここまでのお話には、大切にしたいことを探している様子がありました。今の言葉を手がかりに、無理なく続けられそうです。",
    "ここまでに出た言葉を大事にしながら、急いで結論を出さなくても大丈夫です。話しやすいところから続けられそうです。",
  ],
  default: [
    "ここまでで、少しずつ言葉になってきていることがあります。無理にまとめず、今浮かんでいることをそのまま続けても大丈夫です。",
  ],
};

function clampReply(value: unknown, fallback: string) {
  const text = String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (text.length <= 120) return text;

  return `${text.slice(0, 119)}…`;
}

function getFallbackTemplates(interventionReason: unknown) {
  const reason = typeof interventionReason === "string" ? interventionReason : "";

  return (
    FALLBACK_REPLIES_BY_REASON[reason] || FALLBACK_REPLIES_BY_REASON.default
  );
}

function getExpressedPointLabels(expressedPoints: unknown[] = []) {
  return expressedPoints
    .map((point) => String(point).split(":")[0].trim())
    .filter(Boolean);
}

function getFallbackReply(
  interventionCount: number,
  interventionReason?: unknown,
  expressedPoints: unknown[] = []
) {
  const fallbackTemplates = getFallbackTemplates(interventionReason);
  const fallback =
    fallbackTemplates[interventionCount % fallbackTemplates.length];
  const expressedLabels = getExpressedPointLabels(expressedPoints).slice(0, 2);

  if (interventionReason !== "manual_reflection" || expressedLabels.length === 0) {
    return fallback;
  }

  return `ここまでのお話では、${expressedLabels.join("や")}が言葉になっていました。その感覚を大事にしながら、話しやすいところから続けられそうです。`;
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
    const fallbackReply = getFallbackReply(
      parsedInterventionCount,
      intervention_reason,
      expressedPoints
    );

    if (!process.env.OPENAI_API_KEY) {
      return Response.json({
        reply: fallbackReply,
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
            "研究上の主役は、本人と相手の人間同士の会話です。",
            "AIの役割は、深掘り質問を続けることではありません。話題開始責任の一部を担い、沈黙や気まずさが生じたときの安全網になり、会話を人間同士へ戻す短い橋渡しをしてください。",
            "介入の目的は、不足観点を埋めることではなく、会話再開の心理的負担を下げ、人間同士の対話に戻すことである。",
            "",
            "制約:",
            "- 医療助言をしない",
            "- 介護方針を決めない",
            "- 価値判断をしない",
            "- 結論を急がせない",
            "- 「〜すべき」「〜しなければならない」と言わない",
            "- 参加者の発言を断定的に解釈しない",
            "- AIが話題を奪わない",
            "- 原則として質問で深掘りしない。必要な場合でも質問は1つまで",
            "- 80〜120文字以内",
            "- やわらかく、安心できる表現にする",
            "- JSONではなく、通常文だけを返す",
            "- acpSlots、missing_or_unclear_slots、prompted_slot は内部参考情報にとどめ、スロットを埋める質問に見せない",
            "- 「〜について話してみましょう」「〜についても触れてみてください」「次は〜です」「まだ〜が話せていません」という表現を避ける",
            "",
            "intervention_reason 別の方針:",
            "silence: 沈黙の気まずさを和らげる。答えがまとまっていなくてもよいと伝える。新しい重い質問を投げず、必要なら「話しやすいところから」で終える。",
            "short_answer: 短い回答を肯定的に受け止める。回答者を評価せず、理由を無理に聞き出さず、続ける余白を作る。",
            "manual_reflection: already_expressed_points や recent_transcript を使い、ここまで出た言葉や価値観を短く映し返す。不足スロットを埋める質問にしない。新しい話題を強く促さない。",
            "",
            "返答の構成:",
            "1文目: ここまで出た言葉、または間が空いたことを短く受け止める。",
            "2文目: 答えを急がなくてよいこと、話しやすいところから人間同士で続けてよいことを伝える。",
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
      reply: clampReply(response.output_text, fallbackReply),
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

import OpenAI from "openai";
import {
  ACP_SLOT_NAMES,
  buildFallbackMinutes,
  getUnfilledSlots,
  mergeSlotStates,
  normalizeSlotStatus,
  recentUtterances,
  renderTranscript,
  type AcpSlotName,
  type AcpSlotState,
  type ConversationUtterance,
  type EndCheckResult,
  type FinalMinutesResult,
  type NextQuestionResult,
  type Sensitivity,
  type TopicSwitchResult,
} from "./acp-mvp";

type ConversationContext = {
  utterances: ConversationUtterance[];
  slotStates: AcpSlotState[];
};

const SYSTEM_NEXT_QUESTION = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、会話を支配することではなく、介護者が自然に次の質問を行えるように、現在の文脈に最も合う質問を1つだけ生成することです。",
  "未充足スロットを機械的に埋めるのではなく、直前の会話から自然につながる質問を選んでください。",
  "質問は高齢者を責めず、答えやすく、介護者がそのまま読み上げられる日本語にしてください。",
  "重すぎる話題へ急に飛ばず、既に十分話されている内容を繰り返さないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"question":"...","transition_phrase":"...","target_slot":"...","reason":"...","sensitivity":"low | medium | high"}',
].join("\n");

const SYSTEM_UPDATE_SLOTS = [
  "あなたはACP対話の研究用記録を整理するAIです。",
  "会話ログを読み、指定されたACPスロットごとに状態を更新してください。",
  "statusは empty / partial / filled のいずれかです。",
  "emptyは情報なし、partialは話題は出たが具体性が足りない、filledは本人の希望・理由・文脈がある程度記録されている状態です。",
  "本人の発話を根拠として優先し、推測で埋めないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"slots":[{"slot_name":"価値観","status":"empty | partial | filled","summary":"...","evidence_utterance":"..."}]}',
].join("\n");

const SYSTEM_TOPIC_SWITCH = [
  "あなたはACP対話を支援するAIです。",
  "介護者が自然に話題を切り替えられる短い発話を1つだけ生成してください。",
  "直前の会話を受け止め、急に重い話題へ飛ばないでください。",
  "高齢者を責めず、介護者がそのまま読み上げられる日本語にしてください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"message":"...","target_slot":"...","reason":"...","sensitivity":"low | medium | high"}',
].join("\n");

const SYSTEM_END_CHECK = [
  "あなたはACP対話の終了確認を支援するAIです。",
  "会話ログとACPスロット状態を見て、今日の対話を終えてよいかを判定してください。",
  "重要な未確認事項がある場合は、介護者が穏やかに確認できる一文を返してください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"can_end":true,"message":"...","reason":"...","remaining_slots":["..."]}',
].join("\n");

const SYSTEM_FINAL_MINUTES = [
  "あなたはACP対話の実験用議事録を作成するAIです。",
  "会話ログとACPスロット状態から、研究者が確認しやすいMarkdown議事録とJSON要約を作ってください。",
  "本人の希望と根拠発話を区別し、推測で断定しないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"markdown":"# ACP対話 議事録\\n...","json":{"generated_at":"...","summary":"...","slots":[...],"utterances":[...]}}',
].join("\n");

const SLOT_KEYWORDS: Record<AcpSlotName, string[]> = {
  価値観: ["大事", "大切", "好き", "楽しみ", "安心", "自分らし", "家族", "友人"],
  今後の生活希望: ["暮らし", "生活", "家", "自宅", "施設", "今後", "これから", "続けたい"],
  介護希望: ["介護", "手伝", "支援", "世話", "訪問", "ヘルパー", "負担", "助け"],
  医療処置への希望: ["治療", "医療", "入院", "手術", "薬", "痛み", "病院", "処置"],
  延命治療への考え: ["延命", "人工呼吸", "心臓マッサージ", "蘇生", "胃ろう", "管", "長く"],
  最期を迎えたい場所: ["最期", "最後", "看取り", "亡く", "逝く", "家で", "病院で", "ホスピス"],
  代理意思決定者: ["決めて", "判断", "相談", "任せ", "代理", "娘", "息子", "配偶者", "妻", "夫"],
  家族に伝えたいこと: ["伝えたい", "言っておきたい", "ありがとう", "お願い", "家族", "迷惑"],
  "不安・心配": ["不安", "心配", "怖い", "困る", "迷う", "負担", "一人", "孤独"],
  未解決課題: ["決まっていない", "まだ", "わからない", "確認", "課題", "問題", "迷って"],
};

const FALLBACK_QUESTIONS: Record<AcpSlotName, string> = {
  価値観: "普段の暮らしの中で、これだけは大切にしたいと思うことはありますか？",
  今後の生活希望: "これからの生活で、できるだけ続けたい暮らし方はありますか？",
  介護希望: "もし手助けが必要になった場合、どのような支援なら受け入れやすいですか？",
  医療処置への希望: "治療や医療を受ける場面で、大切にしたいことや避けたいことはありますか？",
  延命治療への考え: "もし命に関わる状態になった時、延命治療について今の時点で考えていることはありますか？",
  最期を迎えたい場所: "もし最期の時期を考えるとしたら、どこで誰と過ごせると安心だと思いますか？",
  代理意思決定者: "ご自身で判断しにくい時、医療や介護のことを誰に相談して決めてほしいですか？",
  家族に伝えたいこと: "ご家族に、今のうちに伝えておきたいことやお願いしておきたいことはありますか？",
  "不安・心配": "これからのことで、不安に感じていることや心配なことはありますか？",
  未解決課題: "今日話した中で、まだ決めきれないことや後で確認したいことはありますか？",
};

let client: OpenAI | null = null;

export async function updateSlotsFromConversation(
  context: ConversationContext,
): Promise<AcpSlotState[]> {
  const fallback = fallbackUpdateSlots(context.utterances, context.slotStates);
  const payload = buildConversationPayload(context);
  const result = await requestJson<{ slots?: AcpSlotState[] }>(
    SYSTEM_UPDATE_SLOTS,
    payload,
    { slots: fallback },
  );

  const updatedSlots = Array.isArray(result.slots) ? result.slots : fallback;

  return mergeSlotStates(context.slotStates, updatedSlots);
}

export async function generateNextQuestion(
  context: ConversationContext,
): Promise<NextQuestionResult> {
  const fallback = fallbackNextQuestion(context.utterances, context.slotStates);
  const result = await requestJson<Partial<NextQuestionResult>>(
    SYSTEM_NEXT_QUESTION,
    buildConversationPayload(context),
    fallback,
  );

  return {
    question: nonEmpty(result.question, fallback.question),
    transition_phrase: nonEmpty(result.transition_phrase, fallback.transition_phrase),
    target_slot: nonEmpty(result.target_slot, fallback.target_slot),
    reason: nonEmpty(result.reason, fallback.reason),
    sensitivity: normalizeSensitivity(result.sensitivity, fallback.sensitivity),
  };
}

export async function generateTopicSwitch(
  context: ConversationContext,
): Promise<TopicSwitchResult> {
  const next = fallbackNextQuestion(context.utterances, context.slotStates);
  const fallback: TopicSwitchResult = {
    message: `${next.transition_phrase || "少し別の角度から伺ってもよいですか。"}${next.question}`,
    target_slot: next.target_slot,
    reason: "未確認または部分的なACP項目へ、直前の会話から自然に移るため。",
    sensitivity: next.sensitivity,
  };
  const result = await requestJson<Partial<TopicSwitchResult>>(
    SYSTEM_TOPIC_SWITCH,
    buildConversationPayload(context),
    fallback,
  );

  return {
    message: nonEmpty(result.message, fallback.message),
    target_slot: nonEmpty(result.target_slot, fallback.target_slot),
    reason: nonEmpty(result.reason, fallback.reason),
    sensitivity: normalizeSensitivity(result.sensitivity, fallback.sensitivity),
  };
}

export async function checkConversationEnd(
  context: ConversationContext,
): Promise<EndCheckResult> {
  const fallback = fallbackEndCheck(context.slotStates);
  const result = await requestJson<Partial<EndCheckResult>>(
    SYSTEM_END_CHECK,
    buildConversationPayload(context),
    fallback,
  );

  return {
    can_end: typeof result.can_end === "boolean" ? result.can_end : fallback.can_end,
    message: nonEmpty(result.message, fallback.message),
    reason: nonEmpty(result.reason, fallback.reason),
    remaining_slots: Array.isArray(result.remaining_slots)
      ? result.remaining_slots.map(String).filter(Boolean)
      : fallback.remaining_slots,
  };
}

export async function generateFinalMinutes(
  context: ConversationContext,
): Promise<FinalMinutesResult> {
  const fallback = buildFallbackMinutes(context.utterances, context.slotStates);
  const result = await requestJson<Partial<FinalMinutesResult>>(
    SYSTEM_FINAL_MINUTES,
    buildConversationPayload(context),
    fallback,
  );

  if (!result.markdown || !result.json || typeof result.json !== "object") {
    return fallback;
  }

  return {
    markdown: result.markdown,
    json: result.json as FinalMinutesResult["json"],
  };
}

async function requestJson<T>(
  systemPrompt: string,
  payload: unknown,
  fallback: T,
): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return fallback;

  try {
    const openai = getClient(apiKey);
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      response_format: { type: "json_object" },
    });
    const content = completion.choices[0]?.message?.content;
    const parsed = parseJson(content);

    return parsed ? ({ ...fallback, ...parsed } as T) : fallback;
  } catch (error) {
    console.error("LLM request failed", error);
    return fallback;
  }
}

function getClient(apiKey: string) {
  if (!client) {
    client = new OpenAI({
      apiKey,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || 20000),
    });
  }

  return client;
}

function buildConversationPayload(context: ConversationContext) {
  return {
    all_conversation_log: renderTranscript(context.utterances),
    recent_5_turns: renderTranscript(recentUtterances(context.utterances, 5)),
    slot_states: context.slotStates,
    unfilled_slots: getUnfilledSlots(context.slotStates).map((slot) => ({
      slot_name: slot.slot_name,
      status: slot.status,
      summary: slot.summary,
    })),
    last_utterance: context.utterances.at(-1) ?? null,
    acp_slots: ACP_SLOT_NAMES,
  };
}

function fallbackUpdateSlots(
  utterances: ConversationUtterance[],
  currentSlots: AcpSlotState[],
): AcpSlotState[] {
  const currentByName = new Map(currentSlots.map((slot) => [slot.slot_name, slot]));

  return ACP_SLOT_NAMES.map((slotName) => {
    const evidence = [...utterances]
      .reverse()
      .find((utterance) => hasKeyword(utterance.text, SLOT_KEYWORDS[slotName]));
    const current = currentByName.get(slotName);

    if (!evidence) {
      return (
        current ?? {
          slot_name: slotName,
          status: "empty",
          summary: "未確認",
          evidence_utterance: "",
        }
      );
    }

    const status =
      evidence.speaker === "elder" && evidence.text.replace(/\s/g, "").length >= 18
        ? "filled"
        : "partial";
    const speaker = evidence.speaker === "elder" ? "本人" : "介護者";

    return {
      slot_name: slotName,
      status,
      summary:
        status === "filled"
          ? truncate(evidence.text, 120)
          : "話題は出ているが、本人の希望・理由・条件の確認がまだ十分ではありません。",
      evidence_utterance: `${speaker}: ${truncate(evidence.text, 160)}`,
    };
  });
}

function fallbackNextQuestion(
  utterances: ConversationUtterance[],
  slotStates: AcpSlotState[],
): NextQuestionResult {
  const recentText = recentUtterances(utterances, 5)
    .map((utterance) => utterance.text)
    .join(" ");
  const contextualSlot = ACP_SLOT_NAMES.find((slotName) =>
    hasKeyword(recentText, SLOT_KEYWORDS[slotName]),
  );
  const unfilled = getUnfilledSlots(slotStates);
  const selected =
    unfilled.find((slot) => slot.slot_name === contextualSlot)?.slot_name ??
    unfilled.find((slot) => slot.status === "partial")?.slot_name ??
    unfilled[0]?.slot_name ??
    "未解決課題";
  const targetSlot = ACP_SLOT_NAMES.includes(selected as AcpSlotName)
    ? (selected as AcpSlotName)
    : "未解決課題";

  return {
    question: FALLBACK_QUESTIONS[targetSlot],
    transition_phrase: recentText ? "今のお話に関連して、" : "",
    target_slot: targetSlot,
    reason: "直近の会話と未充足スロットの状態から、自然につながりやすい確認項目として選びました。",
    sensitivity: getSlotSensitivity(targetSlot),
  };
}

function fallbackEndCheck(slotStates: AcpSlotState[]): EndCheckResult {
  const importantSlots = [
    "価値観",
    "今後の生活希望",
    "介護希望",
    "医療処置への希望",
    "代理意思決定者",
  ];
  const remaining = slotStates
    .filter((slot) => importantSlots.includes(slot.slot_name) && slot.status !== "filled")
    .map((slot) => slot.slot_name);
  const canEnd = remaining.length <= 1;

  return {
    can_end: canEnd,
    message: canEnd
      ? "今日のところは大切なお話がかなり確認できています。最後に、言い残したことがないかだけ確認して終えてもよさそうです。"
      : "まだ大切な確認が少し残っています。無理のない範囲で、もう一つだけ確認してから終えると安心です。",
    reason: canEnd
      ? "主要スロットの多くがfilledまたはpartialになっています。"
      : "主要スロットに未確認または部分確認の項目が残っています。",
    remaining_slots: remaining,
  };
}

function getSlotSensitivity(slotName: AcpSlotName): Sensitivity {
  if (slotName === "延命治療への考え" || slotName === "最期を迎えたい場所") {
    return "high";
  }

  if (slotName === "医療処置への希望" || slotName === "代理意思決定者") {
    return "medium";
  }

  return "low";
}

function parseJson(content: string | null | undefined) {
  if (!content) return null;

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeSensitivity(value: unknown, fallback: Sensitivity): Sensitivity {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function nonEmpty(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";

  return text || fallback;
}

function hasKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function truncate(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

import OpenAI from "openai";
import {
  ACP_SLOT_NAMES,
  DISCUSSION_TOPIC,
  DISCUSSION_TOPICS,
  buildFallbackMinutes,
  getUnfilledSlots,
  mergeSlotStates,
  normalizeSlotStatus,
  recentUtterances,
  renderTranscript,
  type AcpSlotName,
  type AuxiliaryMinutesItem,
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
  sessionId?: string;
  participantCode?: string | null;
  currentTopic?: string;
  currentTopicTitle?: string;
  nextTopic?: string;
  nextTopicTitle?: string;
};

type ExplicitNoneResponse = {
  slotName: AcpSlotName;
  utterance: ConversationUtterance;
  index: number;
};

type UncertainResponseKind =
  | "unknown"
  | "not_considered"
  | "language_gap"
  | "knowledge_gap"
  | "emotional_load"
  | "undecided";

type UncertainResponse = {
  slotName: AcpSlotName;
  utterance: ConversationUtterance;
  index: number;
  kind: UncertainResponseKind;
};

const AI_POLICY_VERSION = "hitl-acp-v1";

const COMMON_AI_POLICY = [
  "You are a third-party support assistant for a human-led family ACP conversation.",
  "Do not become a conversation partner for the elder or caregiver.",
  "Only support: question suggestion, topic transition suggestion, completion check, minutes generation, and slot state updates.",
  "Do not provide medical, caregiving, legal, moral, or value judgments.",
  "Do not infer facts that are not present in the saved utterance log.",
  "Do not invent ACP slots, topics, utterances, speakers, or slot statuses.",
  "Use only the provided acp_slots and available_topics when choosing target_slot or next_topic.",
  "A short uncertainty or deferral answer is valid ACP information; do not keep asking the same question mechanically.",
  "Return only the requested JSON shape.",
].join("\n");

const SYSTEM_NEXT_QUESTION = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、会話を支配することではなく、介護者が自然に次の質問を行えるように、現在の文脈に最も合う質問を1つだけ生成することです。",
  "質問選択の主軸は current_topic です。ACP全体の未充足スロットは補助情報として扱ってください。",
  "target_slot には acp_slots に含まれるACPスロットだけを指定してください。「未解決課題」は指定してはいけません。",
  "current_topic と無関係な未充足スロットへ急に移らないでください。",
  "未充足スロットを機械的に埋めるのではなく、直前の会話から自然につながる質問を選んでください。",
  "本人が「特にない」「今はない」「思いつかない」などと答えた場合、それを有効な回答として受け止め、同じ直接質問を繰り返さないでください。",
  "その話題を続ける必要がある場合は、「大切にしていることはありますか」の言い換えではなく、最近の出来事、嫌だったこと、避けたいこと、時間の使い方など具体的な別角度にしてください。",
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
  "本人が質問に対して「特にない」「今はない」「わからない」「言えない」「思いつかない」などと明示した場合、それは無回答ではなく有効回答です。summaryには「明示回答: ...」として、今は言語化しにくい／思い当たらない旨を記録してください。",
  "ただし、その後の別話題で同じスロットに関係する本人発話が出た場合は、明示回答だけで固定せず、後から出た根拠発話でsummaryを更新してください。",
  "他の話題の発言からスロットを補う場合は、本人発話を根拠にし、summaryまたはevidence_utteranceの先頭に「(AI推測)」を付けてください。",
  "未解決課題・次回確認事項はACPスロットではありません。slotsには絶対に「未解決課題」を出力しないでください。",
  "明示的な「ない」を、AIの推測で別の希望や価値観に置き換えないでください。",
  "本人の発話を根拠として優先し、根拠のない想像では埋めないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"slots":[{"slot_name":"価値観","status":"empty | partial | filled","summary":"...","evidence_utterance":"..."}]}',
].join("\n");

const SYSTEM_TOPIC_SWITCH = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、今の話題を終えて次へ進んでよいかを判定し、介護者が自然に話題を運べる一文を1つだけ生成することです。",
  "target_slot と next_topic には、acp_slots に含まれるACPスロットだけを指定してください。「未解決課題」は指定してはいけません。",
  "まず current_topic が十分に話されたかを、current_topic に関係する発話とスロット状態から判断してください。",
  "本人が current_topic について「特にない」「今はない」「わからない」「言えない」「思いつかない」などと答えている場合、それを有効な回答として扱い、同じ直接質問を繰り返さないでください。",
  "明示的に言語化できない回答が出ており、まだ一度も別角度で確認していない場合だけ、should_switch=false として、具体的経験・嫌だったこと・避けたいこと・最近の過ごし方などから1つだけ別角度で確認してください。",
  "すでに別角度でも確認した、または本人がこれ以上話しにくそうな場合は、その明示回答を尊重して should_switch=true とし、次の話題へ進んでください。",
  "current_topic がまだ empty または partial なら、should_switch=false とし、同じ話題をもう少し深める自然な追加質問を返してください。",
  "should_switch=false の場合でも、直前に明示的な「ない」があるなら、同じ「ありますか」形式ではなく、具体的経験・嫌だったこと・避けたいことなど別角度の確認にしてください。",
  "current_topic が filled に近い場合だけ、should_switch=true とし、next_topic へ移る短い前置きと最初の質問を返してください。",
  "ACP全体の未充足スロットは補助情報です。今の話題と無関係な領域へ急に飛ばないでください。",
  "高齢者を責めず、介護者がそのまま読み上げられる日本語にしてください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"should_switch":false,"message":"...","target_slot":"...","next_topic":"...","reason":"...","sensitivity":"low | medium | high"}',
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
  "固定のお題は必ず議事録に含めてください。",
  "AIが表示した質問や話題転換文は介入ログであり、会話ログや本人の根拠発話として扱わないでください。",
  "本人の希望と根拠発話を区別し、推測で断定しないでください。",
  "本人が「ない」「わからない」「言えない」と答えた項目は、欠落ではなく明示回答として記録してください。",
  "他の話題の発言から補った内容は「(AI推測)」を付け、根拠発話を併記してください。",
  "未解決課題・次回確認事項はACPスロットに含めず、json.auxiliary_items とMarkdownの補助項目に分けて記録してください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"markdown":"# ACP対話 議事録\\n...","json":{"generated_at":"...","session":{"id":"...","participant_code":"..."},"summary":"...","slots":[...],"auxiliary_items":[{"item_name":"未解決課題・次回確認事項","summary":"...","evidence_utterance":"..."}],"utterances":[...]}}',
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
};

const UNCERTAINTY_SUMMARY_PREFIX =
  "\u660e\u793a\u7684\u306a\u4fdd\u7559\u56de\u7b54: ";
const UNCERTAINTY_REASON_PROMPT =
  "\u4eca\u3059\u3050\u7b54\u3048\u3092\u6c7a\u3081\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u308f\u304b\u3089\u306a\u3044\u611f\u3058\u306f\u3001\u8003\u3048\u305f\u3053\u3068\u304c\u306a\u3044\u304b\u3089\u8fd1\u3044\u3067\u3059\u304b\u3001\u305d\u308c\u3068\u3082\u8a00\u8449\u306b\u3059\u308b\u306e\u304c\u96e3\u3057\u3044\u611f\u3058\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_MOVE_ON_PROMPT =
  "\u7b54\u3048\u3092\u6025\u304c\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u4eca\u306f\u8a00\u8449\u306b\u3057\u306b\u304f\u3044\u3053\u3068\u3068\u3057\u3066\u53d7\u3051\u6b62\u3081\u307e\u3059\u3002\u3044\u3063\u305f\u3093\u5225\u306e\u8a71\u984c\u306b\u79fb\u3063\u3066\u3082\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_SLOT_SUMMARY =
  "\u660e\u793a\u7684\u306a\u4fdd\u7559\u56de\u7b54: \u672c\u4eba\u306f\u4eca\u306f\u7b54\u3048\u304c\u5b9a\u307e\u3063\u3066\u3044\u306a\u3044\u3001\u307e\u305f\u306f\u8a00\u8a9e\u5316\u304c\u96e3\u3057\u3044\u3068\u8a71\u3057\u3066\u3044\u308b\u3002";
const UNCERTAINTY_REASON =
  "\u4e0d\u660e\u30fb\u4fdd\u7559\u306e\u7406\u7531\u3092\u78ba\u8a8d\u3059\u308b\u305f\u3081";
const UNCERTAINTY_SWITCH_REASON =
  "\u540c\u3058\u8cea\u554f\u3092\u91cd\u306d\u305a\u3001\u4fdd\u7559\u3068\u3057\u3066\u6271\u3063\u3066\u6b21\u306e\u8a71\u984c\u3078\u79fb\u308b\u305f\u3081";

let client: OpenAI | null = null;

export async function updateSlotsFromConversation(
  context: ConversationContext,
): Promise<AcpSlotState[]> {
  const fallback = fallbackUpdateSlots(
    context.utterances,
    context.slotStates,
    context.currentTopic,
  );
  const payload = buildConversationPayload(context);
  const result = await requestJson<{ slots?: AcpSlotState[] }>(
    SYSTEM_UPDATE_SLOTS,
    payload,
    { slots: fallback },
  );

  const updatedSlots = applyExplicitNoneResponses(
    context,
    normalizeSlotUpdateResult(result.slots, fallback, context.slotStates),
  );

  const policySlots = isLegacyDialogueMode()
    ? updatedSlots
    : applyUncertainResponses(context, updatedSlots);

  return mergeSlotStates(context.slotStates, policySlots);
}

export async function generateNextQuestion(
  context: ConversationContext,
): Promise<NextQuestionResult> {
  const fallback = fallbackNextQuestion(
    context.utterances,
    context.slotStates,
    context.currentTopic,
  );
  const result = await requestJson<Partial<NextQuestionResult>>(
    SYSTEM_NEXT_QUESTION,
    buildConversationPayload(context),
    fallback,
  );

  const output = normalizeNextQuestionResult(result, fallback, context);

  return isLegacyDialogueMode()
    ? output
    : applyUncertaintyNextQuestionPolicy(context, output);
}

export async function generateTopicSwitch(
  context: ConversationContext,
): Promise<TopicSwitchResult> {
  const fallback = fallbackTopicSwitch(context);
  const result = await requestJson<Partial<TopicSwitchResult>>(
    SYSTEM_TOPIC_SWITCH,
    buildConversationPayload(context),
    fallback,
  );

  const output = normalizeTopicSwitchResult(result, fallback, context);

  return isLegacyDialogueMode()
    ? output
    : applyUncertaintyTopicSwitchPolicy(context, output);
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
    remaining_slots: normalizeRemainingSlots(result.remaining_slots, fallback.remaining_slots),
  };
}

export async function generateFinalMinutes(
  context: ConversationContext,
): Promise<FinalMinutesResult> {
  const fallback = buildFallbackMinutes(
    context.utterances,
    context.slotStates,
    getSessionMetadata(context),
  );
  const result = await requestJson<Partial<FinalMinutesResult>>(
    SYSTEM_FINAL_MINUTES,
    buildConversationPayload(context),
    fallback,
  );

  if (!result.markdown || !result.json || typeof result.json !== "object") {
    return fallback;
  }

  return {
    ...ensureFinalMinutesIncludeTopic(
      {
        markdown: result.markdown,
        json: result.json as FinalMinutesResult["json"],
      },
      context,
    ),
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
        { role: "system", content: `${COMMON_AI_POLICY}\n\n${systemPrompt}` },
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

function normalizeSlotUpdateResult(
  value: unknown,
  fallback: AcpSlotState[],
  currentSlots: AcpSlotState[],
): AcpSlotState[] {
  if (!Array.isArray(value)) return fallback;

  const currentByName = new Map(currentSlots.map((slot) => [slot.slot_name, slot]));
  const fallbackByName = new Map(fallback.map((slot) => [slot.slot_name, slot]));
  const updatesByName = new Map<string, AcpSlotState>();

  value.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const raw = item as Record<string, unknown>;
    const slotName = typeof raw.slot_name === "string" ? raw.slot_name.trim() : "";
    if (!ACP_SLOT_NAMES.includes(slotName as AcpSlotName)) return;
    const baseSlot = fallbackByName.get(slotName) ?? currentByName.get(slotName);

    updatesByName.set(slotName, {
      slot_name: slotName,
      status: normalizeSlotStatus(raw.status),
      summary: nonEmpty(raw.summary, baseSlot?.summary ?? ""),
      evidence_utterance: nonEmpty(
        raw.evidence_utterance,
        baseSlot?.evidence_utterance ?? "",
      ),
      updated_at:
        typeof raw.updated_at === "string"
          ? raw.updated_at
          : baseSlot?.updated_at,
    });
  });

  return ACP_SLOT_NAMES.map((slotName) => {
    return (
      updatesByName.get(slotName) ??
      fallbackByName.get(slotName) ??
      currentByName.get(slotName) ?? {
        slot_name: slotName,
        status: "empty",
        summary: "",
        evidence_utterance: "",
      }
    );
  });
}

function normalizeNextQuestionResult(
  result: Partial<NextQuestionResult>,
  fallback: NextQuestionResult,
  context: ConversationContext,
): NextQuestionResult {
  const targetSlot = normalizeAcpTargetSlot(result.target_slot, fallback.target_slot);
  const question = nonEmpty(result.question, fallback.question);
  const shouldUseFallbackQuestion =
    isRepeatedQuestion(context.utterances, question, targetSlot) ||
    !isQuestionRelevantToCurrentTopic(context, targetSlot);

  return {
    question: shouldUseFallbackQuestion ? fallback.question : question,
    transition_phrase: nonEmpty(result.transition_phrase, fallback.transition_phrase),
    target_slot: shouldUseFallbackQuestion ? fallback.target_slot : targetSlot,
    reason: nonEmpty(result.reason, fallback.reason),
    sensitivity: normalizeSensitivity(result.sensitivity, fallback.sensitivity),
  };
}

function normalizeTopicSwitchResult(
  result: Partial<TopicSwitchResult>,
  fallback: TopicSwitchResult,
  context: ConversationContext,
): TopicSwitchResult {
  const requestedNextTopic = context.nextTopic
    ? resolveTopic(context.nextTopic).slot_name
    : fallback.next_topic;
  const nextTopic = normalizeTopicName(requestedNextTopic, fallback.next_topic);
  const targetSlot = normalizeAcpTargetSlot(result.target_slot, nextTopic);
  const shouldSwitch =
    typeof result.should_switch === "boolean"
      ? result.should_switch
      : fallback.should_switch;
  const isValidSwitch = !shouldSwitch || Boolean(context.nextTopic);

  if (!isValidSwitch) return fallback;

  return {
    message: nonEmpty(result.message, fallback.message),
    target_slot: targetSlot,
    should_switch: shouldSwitch,
    next_topic: shouldSwitch ? nextTopic : fallback.next_topic,
    reason: nonEmpty(result.reason, fallback.reason),
    sensitivity: normalizeSensitivity(result.sensitivity, fallback.sensitivity),
  };
}

function buildConversationPayload(context: ConversationContext) {
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  const acpSlotStates = filterAcpSlotStates(context.slotStates);

  return {
    discussion_topic: DISCUSSION_TOPIC,
    session: getSessionMetadata(context),
    current_topic: {
      slot_name: currentTopic.slot_name,
      title: context.currentTopicTitle || currentTopic.title,
      status: findSlotState(acpSlotStates, currentTopic.slot_name)?.status ?? "empty",
      summary: findSlotState(acpSlotStates, currentTopic.slot_name)?.summary ?? "",
    },
    next_topic: nextTopic
      ? {
          slot_name: nextTopic.slot_name,
          title: context.nextTopicTitle || nextTopic.title,
        }
      : null,
    available_topics: DISCUSSION_TOPICS.map((topic) => ({
      slot_name: topic.slot_name,
      title: topic.title,
      opening_prompt: topic.opening_prompt,
    })),
    current_topic_transcript: renderTranscript(getTopicRelatedUtterances(context)),
    all_conversation_log: renderTranscript(context.utterances),
    recent_5_turns: renderTranscript(recentUtterances(context.utterances, 5)),
    slot_states: acpSlotStates,
    unfilled_slots: getUnfilledSlots(acpSlotStates).map((slot) => ({
      slot_name: slot.slot_name,
      status: slot.status,
      summary: slot.summary,
    })),
    explicit_none_answers: detectExplicitNoneResponses(context).map((response) => ({
      slot_name: response.slotName,
      evidence_utterance: formatSpeakerEvidence(response.utterance),
    })),
    uncertainty_answers: isLegacyDialogueMode()
      ? []
      : detectUncertainResponses(context).map((response) => ({
          slot_name: response.slotName,
          kind: response.kind,
          evidence_utterance: formatSpeakerEvidence(response.utterance),
          policy:
            "Treat this as meaningful ACP information, not as missing data. Ask one gentle reason-check question at most, then allow moving to another topic.",
        })),
    dialogue_policy: isLegacyDialogueMode()
      ? { mode: "legacy" }
      : {
          policy_version: AI_POLICY_VERSION,
          mode: "uncertainty_aware",
          unknown_is_valid_answer: true,
          avoid_repeating_unclear_questions: true,
          use_partial_status_for_deferral: true,
          prefer_reason_check_or_topic_switch: true,
        },
    last_utterance: context.utterances.at(-1) ?? null,
    acp_slots: ACP_SLOT_NAMES,
  };
}

function ensureFinalMinutesIncludeTopic(
  minutes: FinalMinutesResult,
  context: ConversationContext,
): FinalMinutesResult {
  const topicBlock = [
    "## 話し合ったお題",
    "",
    `### ${DISCUSSION_TOPIC.title}`,
    DISCUSSION_TOPIC.description,
    "",
  ].join("\n");
  const markdown = minutes.markdown.includes(DISCUSSION_TOPIC.title)
    ? minutes.markdown
    : insertAfterMarkdownTitle(minutes.markdown, topicBlock);
  const rawJson =
    minutes.json && typeof minutes.json === "object"
      ? (minutes.json as Record<string, unknown>)
      : {};

  return {
    markdown,
    json: {
      generated_at:
        typeof rawJson.generated_at === "string"
          ? rawJson.generated_at
          : new Date().toISOString(),
      session: getSessionMetadata(context),
      discussion_topic: DISCUSSION_TOPIC,
      utterances: context.utterances,
      slots: filterAcpSlotStates(context.slotStates),
      auxiliary_items: Array.isArray(rawJson.auxiliary_items)
        ? (rawJson.auxiliary_items as AuxiliaryMinutesItem[])
        : buildFallbackMinutes(
            context.utterances,
            context.slotStates,
            getSessionMetadata(context),
          ).json.auxiliary_items,
      summary:
        typeof rawJson.summary === "string"
          ? rawJson.summary
          : "会話ログとACPスロット状態から生成した議事録です。",
    },
  };
}

function getSessionMetadata(context: ConversationContext) {
  return {
    id: context.sessionId,
    participant_code: context.participantCode ?? null,
  };
}

function insertAfterMarkdownTitle(markdown: string, insertion: string) {
  const trimmed = markdown.trim();
  const lines = trimmed.split("\n");

  if (lines[0]?.startsWith("# ")) {
    return [lines[0], "", insertion, ...lines.slice(1)].join("\n");
  }

  return `${insertion}\n${trimmed}`;
}

function fallbackUpdateSlots(
  utterances: ConversationUtterance[],
  currentSlots: AcpSlotState[],
  currentTopic?: string,
): AcpSlotState[] {
  const currentByName = new Map(currentSlots.map((slot) => [slot.slot_name, slot]));

  return ACP_SLOT_NAMES.map((slotName) => {
    const explicitNone = findExplicitNoneResponseRecordForSlot(
      utterances,
      slotName,
      currentTopic,
    );

    const evidence = utterances
      .map((utterance, index) => ({ utterance, index }))
      .reverse()
      .find(({ utterance, index }) => {
        if (!hasKeyword(utterance.text, SLOT_KEYWORDS[slotName])) return false;
        return !explicitNone || index > explicitNone.index;
      });
    const current = currentByName.get(slotName);

    if (explicitNone && !evidence) {
      return createExplicitNoneSlotState(slotName, explicitNone.utterance);
    }

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
      evidence.utterance.speaker === "elder" &&
      evidence.utterance.text.replace(/\s/g, "").length >= 18
        ? "filled"
        : "partial";
    const speaker = evidence.utterance.speaker === "elder" ? "本人" : "介護者";
    const inferredPrefix =
      explicitNone && evidence.index > explicitNone.index ? "(AI推測) " : "";

    return {
      slot_name: slotName,
      status,
      summary:
        status === "filled"
          ? `${inferredPrefix}${truncate(evidence.utterance.text, 120)}`
          : "話題は出ているが、本人の希望・理由・条件の確認がまだ十分ではありません。",
      evidence_utterance: `${inferredPrefix}${speaker}: ${truncate(evidence.utterance.text, 160)}`,
    };
  });
}

function applyExplicitNoneResponses(
  context: ConversationContext,
  slots: AcpSlotState[],
): AcpSlotState[] {
  const responses = detectExplicitNoneResponses(context);
  if (responses.length === 0) return slots;

  const byName = new Map(slots.map((slot) => [slot.slot_name, slot]));

  responses.forEach((response) => {
    const current = byName.get(response.slotName);
    const hasNewerEvidence =
      current?.evidence_utterance &&
      !isExplicitNoneSummary(current.summary) &&
      !isExplicitNoneSummary(current.evidence_utterance);

    if (hasNewerEvidence) return;

    byName.set(
      response.slotName,
      createExplicitNoneSlotState(response.slotName, response.utterance),
    );
  });

  return ACP_SLOT_NAMES.map((slotName) => {
    return (
      byName.get(slotName) ??
      findSlotState(context.slotStates, slotName) ?? {
        slot_name: slotName,
        status: "empty",
        summary: "未確認",
        evidence_utterance: "",
      }
    );
  });
}

function applyUncertainResponses(
  context: ConversationContext,
  slots: AcpSlotState[],
): AcpSlotState[] {
  const responses = detectUncertainResponses(context);
  if (responses.length === 0) return slots;

  const byName = new Map(slots.map((slot) => [slot.slot_name, slot]));

  responses.forEach((response) => {
    const current = byName.get(response.slotName);
    if (
      current?.status === "filled" &&
      !isUncertaintySummary(current.summary) &&
      !isUncertaintySummary(current.evidence_utterance)
    ) {
      return;
    }

    byName.set(
      response.slotName,
      createUncertainSlotState(response.slotName, response.utterance, response.kind),
    );
  });

  return ACP_SLOT_NAMES.map((slotName) => {
    return (
      byName.get(slotName) ??
      findSlotState(context.slotStates, slotName) ?? {
        slot_name: slotName,
        status: "empty",
        summary: "Unconfirmed",
        evidence_utterance: "",
      }
    );
  });
}

function applyUncertaintyNextQuestionPolicy(
  context: ConversationContext,
  result: NextQuestionResult,
): NextQuestionResult {
  const response = getLatestUncertainResponse(context);
  if (!response) return result;

  const promptCount = countPromptsForSlot(context.utterances, response.slotName);
  const targetSlot = normalizeAcpTargetSlot(response.slotName, result.target_slot);

  if (promptCount <= 1) {
    return {
      ...result,
      question: UNCERTAINTY_REASON_PROMPT,
      transition_phrase: "",
      target_slot: targetSlot,
      reason: UNCERTAINTY_REASON,
      sensitivity: getSlotSensitivity(targetSlot as AcpSlotName),
    };
  }

  return {
    ...result,
    question: UNCERTAINTY_MOVE_ON_PROMPT,
    transition_phrase: "",
    target_slot: targetSlot,
    reason: UNCERTAINTY_SWITCH_REASON,
    sensitivity: getSlotSensitivity(targetSlot as AcpSlotName),
  };
}

function applyUncertaintyTopicSwitchPolicy(
  context: ConversationContext,
  result: TopicSwitchResult,
): TopicSwitchResult {
  const response = getLatestUncertainResponse(context);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  if (!response || !nextTopic) return result;

  const promptCount = countPromptsForSlot(context.utterances, response.slotName);
  if (promptCount <= 1) return result;

  const nextSlot = nextTopic.slot_name as AcpSlotName;

  return {
    ...result,
    should_switch: true,
    message: `${UNCERTAINTY_MOVE_ON_PROMPT}\n${nextTopic.opening_prompt}`,
    target_slot: nextSlot,
    next_topic: nextSlot,
    reason: UNCERTAINTY_SWITCH_REASON,
    sensitivity: getSlotSensitivity(nextSlot),
  };
}

function fallbackNextQuestion(
  utterances: ConversationUtterance[],
  slotStates: AcpSlotState[],
  currentTopic?: string,
): NextQuestionResult {
  const recentText = recentUtterances(utterances, 5)
    .map((utterance) => utterance.text)
    .join(" ");
  const preferredTopic = resolveTopic(currentTopic);
  const preferredSlot = preferredTopic.slot_name as AcpSlotName;
  const preferredState = findSlotState(slotStates, preferredSlot);
  const contextualSlot = ACP_SLOT_NAMES.find((slotName) =>
    hasKeyword(recentText, SLOT_KEYWORDS[slotName]),
  );
  const unfilled = getUnfilledSlots(slotStates);
  const selected =
    preferredState?.status !== "filled" ? preferredSlot :
    unfilled.find((slot) => slot.slot_name === contextualSlot)?.slot_name ??
    unfilled.find((slot) => slot.status === "partial")?.slot_name ??
    unfilled[0]?.slot_name ??
    preferredSlot;
  const targetSlot = ACP_SLOT_NAMES.includes(selected as AcpSlotName)
    ? (selected as AcpSlotName)
    : preferredSlot;

  return {
    question: FALLBACK_QUESTIONS[targetSlot],
    transition_phrase: recentText ? "今のお話に関連して、" : "",
    target_slot: targetSlot,
    reason: "直近の会話と未充足スロットの状態から、自然につながりやすい確認項目として選びました。",
    sensitivity: getSlotSensitivity(targetSlot),
  };
}

function fallbackTopicSwitch(context: ConversationContext): TopicSwitchResult {
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  const currentSlot = currentTopic.slot_name as AcpSlotName;
  const currentState = findSlotState(context.slotStates, currentSlot);
  const canSwitch = currentState?.status === "filled" && Boolean(nextTopic);

  if (canSwitch && nextTopic) {
    const nextSlot = nextTopic.slot_name as AcpSlotName;

    return {
      should_switch: true,
      message: `ここまでのお話を大切にしながら、次に「${nextTopic.title}」について少し伺ってもよいですか。\n${nextTopic.opening_prompt}`,
      target_slot: nextSlot,
      next_topic: nextTopic.slot_name,
      reason: "現在の話題はある程度確認できているため、次の話題へ自然に移る判断をしました。",
      sensitivity: getSlotSensitivity(nextSlot),
    };
  }

  const question = FALLBACK_QUESTIONS[currentSlot] ?? FALLBACK_QUESTIONS.価値観;

  return {
    should_switch: false,
    message: `今の話題をもう少しだけ確認してもよいですか。\n${question}`,
    target_slot: currentSlot,
    next_topic: currentTopic.slot_name,
    reason: "現在の話題にまだ未確認または部分的な内容が残っているため、同じ話題で追加確認する判断をしました。",
    sensitivity: getSlotSensitivity(currentSlot),
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

function resolveTopic(slotName: string | undefined) {
  return (
    DISCUSSION_TOPICS.find((topic) => topic.slot_name === slotName) ??
    DISCUSSION_TOPICS[0]
  );
}

function findSlotState(slotStates: AcpSlotState[], slotName: string) {
  return slotStates.find((slot) => slot.slot_name === slotName);
}

function filterAcpSlotStates(slots: AcpSlotState[]) {
  return slots.filter((slot) =>
    ACP_SLOT_NAMES.includes(slot.slot_name as AcpSlotName),
  );
}

function normalizeAcpTargetSlot(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";

  if (ACP_SLOT_NAMES.includes(text as AcpSlotName)) return text;
  if (ACP_SLOT_NAMES.includes(fallback as AcpSlotName)) return fallback;

  return ACP_SLOT_NAMES[0];
}

function normalizeTopicName(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";

  if (DISCUSSION_TOPICS.some((topic) => topic.slot_name === text)) return text;
  if (DISCUSSION_TOPICS.some((topic) => topic.slot_name === fallback)) return fallback;

  return DISCUSSION_TOPICS[0].slot_name;
}

function normalizeRemainingSlots(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  const slots = value
    .map(String)
    .filter((slotName): slotName is AcpSlotName =>
      ACP_SLOT_NAMES.includes(slotName as AcpSlotName),
    );

  return slots.length > 0 || fallback.length === 0 ? slots : fallback;
}

function isRepeatedQuestion(
  utterances: ConversationUtterance[],
  question: string,
  targetSlot: string,
) {
  const normalizedQuestion = normalizeAnswerText(question);
  if (!normalizedQuestion) return true;

  return recentUtterances(utterances, 8).some((utterance) => {
    if (utterance.speaker === "elder") return false;

    const sameSlot = findPromptedSlotFromText(utterance.text) === targetSlot;
    const sameText = normalizeAnswerText(utterance.text) === normalizedQuestion;

    return sameSlot && sameText;
  });
}

function isQuestionRelevantToCurrentTopic(
  context: ConversationContext,
  targetSlot: string,
) {
  const currentTopic = resolveTopic(context.currentTopic);
  if (targetSlot === currentTopic.slot_name) return true;

  const currentState = findSlotState(context.slotStates, currentTopic.slot_name);
  if (currentState?.status === "filled") return true;

  return false;
}

function detectExplicitNoneResponses(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
): ExplicitNoneResponse[] {
  const currentTopic =
    context.currentTopic && ACP_SLOT_NAMES.includes(context.currentTopic as AcpSlotName)
      ? (context.currentTopic as AcpSlotName)
      : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, ExplicitNoneResponse>();

  context.utterances.forEach((utterance, index) => {
    if (utterance.speaker !== "elder" || !isExplicitNoneAnswer(utterance.text)) {
      return;
    }

    const promptedSlot =
      findPromptedSlotBeforeAnswer(context.utterances, index) ??
      (index === latestIndex ? currentTopic : null);

    if (!promptedSlot) return;

    responsesBySlot.set(promptedSlot, {
      slotName: promptedSlot,
      utterance,
      index,
    });
  });

  return [...responsesBySlot.values()];
}

function detectUncertainResponses(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
): UncertainResponse[] {
  const currentTopic =
    context.currentTopic && ACP_SLOT_NAMES.includes(context.currentTopic as AcpSlotName)
      ? (context.currentTopic as AcpSlotName)
      : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, UncertainResponse>();

  context.utterances.forEach((utterance, index) => {
    if (utterance.speaker !== "elder" || isExplicitNoneAnswer(utterance.text)) {
      return;
    }

    const kind = classifyUncertainResponse(utterance.text);
    if (!kind) return;

    const promptedSlot =
      findPromptedSlotBeforeAnswer(context.utterances, index) ??
      (index === latestIndex ? currentTopic : null);

    if (!promptedSlot) return;

    responsesBySlot.set(promptedSlot, {
      slotName: promptedSlot,
      utterance,
      index,
      kind,
    });
  });

  return [...responsesBySlot.values()];
}

function getLatestUncertainResponse(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
) {
  const latest = detectUncertainResponses(context).sort(
    (left, right) => right.index - left.index,
  )[0];
  if (!latest) return undefined;

  const hasNewerElderUtterance = context.utterances
    .slice(latest.index + 1)
    .some((utterance) => utterance.speaker === "elder");

  return hasNewerElderUtterance ? undefined : latest;
}

function findExplicitNoneResponseRecordForSlot(
  utterances: ConversationUtterance[],
  slotName: AcpSlotName,
  currentTopic?: string,
) {
  return detectExplicitNoneResponses({
    utterances,
    slotStates: [],
    currentTopic,
  }).find((response) => response.slotName === slotName);
}

function findPromptedSlotBeforeAnswer(
  utterances: ConversationUtterance[],
  answerIndex: number,
) {
  for (let index = answerIndex - 1; index >= Math.max(0, answerIndex - 4); index -= 1) {
    const utterance = utterances[index];
    if (!utterance || utterance.speaker === "elder") continue;

    const slotName = findPromptedSlotFromText(utterance.text);
    if (slotName) return slotName;
  }

  return null;
}

function findPromptedSlotFromText(text: string) {
  const [best] = ACP_SLOT_NAMES.map((slotName) => ({
    slotName,
    score: getSlotPromptScore(text, slotName),
  })).sort((left, right) => right.score - left.score);

  return best && best.score > 0 ? best.slotName : null;
}

function getSlotPromptScore(text: string, slotName: AcpSlotName) {
  const keywords = SLOT_KEYWORDS[slotName] ?? [];
  const keywordScore = keywords.filter((keyword) => text.includes(keyword)).length;
  const questionScore = FALLBACK_QUESTIONS[slotName] === text ? 4 : 0;
  const slotNameScore = text.includes(slotName) ? 3 : 0;

  return keywordScore + questionScore + slotNameScore;
}

function classifyUncertainResponse(text: string): UncertainResponseKind | null {
  const normalized = normalizeAnswerText(text);
  if (!normalized || normalized.length > 80) return null;

  if (
    /(?:\u8a00\u8449|\u3053\u3068\u3070).*(?:\u96e3\u3057\u3044|\u3067\u304d\u306a\u3044|\u51fa\u306a\u3044)|(?:\u3046\u307e\u304f|\u4e0a\u624b\u304f).*\u8a00\u3048|\u8868\u73fe.*\u96e3\u3057\u3044/.test(
      normalized,
    )
  ) {
    return "language_gap";
  }

  if (
    /\u8003\u3048\u305f\u3053\u3068(?:\u304c|\u306f)?\u306a\u3044|\u8003\u3048\u3066\u306a|\u307e\u3060.*\u8003\u3048/.test(
      normalized,
    )
  ) {
    return "not_considered";
  }

  if (
    /\u77e5\u8b58.*\u306a\u3044|\u77e5\u3089\u306a\u3044|\u8aac\u660e.*(?:\u308f\u304b\u3089|\u5206\u304b\u3089)|\u60c5\u5831.*\u306a\u3044/.test(
      normalized,
    )
  ) {
    return "knowledge_gap";
  }

  if (
    /\u6016\u3044|\u4e0d\u5b89|\u3064\u3089\u3044|\u8f9b\u3044|\u3057\u3093\u3069\u3044|\u8003\u3048\u305f\u304f\u306a\u3044/.test(
      normalized,
    )
  ) {
    return "emotional_load";
  }

  if (
    /\u6c7a\u3081\u3089\u308c\u306a\u3044|\u8ff7\u3063\u3066|\u307e\u3060.*\u6c7a\u3081|\u3069\u3061\u3089\u3068\u3082|\u306a\u3093\u3068\u3082|\u4f55\u3068\u3082/.test(
      normalized,
    )
  ) {
    return "undecided";
  }

  if (/(?:\u308f\u304b\u3089|\u5206\u304b\u3089|\u5206\u304b\u3093|\u8a00\u3048\u306a\u3044|\u601d\u3044\u3064\u304b\u306a\u3044|\u6d6e\u304b\u3070\u306a\u3044)/.test(normalized)) {
    return "unknown";
  }

  return null;
}

function isExplicitNoneAnswer(text: string) {
  const normalized = normalizeAnswerText(text);
  if (!normalized || normalized.length > 24) return false;
  if (!isLegacyDialogueMode() && isUncertaintyOnlyAnswer(normalized)) return false;

  return (
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに|別に|あまり)?(?:ない|ありません|ないです|なし|思いつかない|浮かばない|わからない|分からない|言えない|いえない)(?:な|かな|ですね|です|と思う)?$/.test(
      normalized,
    ) ||
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに).*(?:ない|ありません|なし|思いつかない|浮かばない|わからない|分からない|言えない|いえない)$/.test(
      normalized,
    )
  );
}

function isUncertaintyOnlyAnswer(normalized: string) {
  return /わからない|分からない|分かんない|言えない|いえない|思いつかない|浮かばない|決められない|迷って/.test(
    normalized,
  );
}

function isExplicitNoneSummary(text: string) {
  return /明示回答|思い当たるものはない|思い当たることはない|わからない|分からない|言えない/.test(
    text,
  );
}

function normalizeAnswerText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s　。、．.！!？?「」『』"'`]/g, "");
}

function createExplicitNoneSlotState(
  slotName: AcpSlotName,
  utterance: ConversationUtterance,
): AcpSlotState {
  return {
    slot_name: slotName,
    status: "filled",
    summary:
      slotName === "価値観"
        ? "明示回答: 本人は、今は特に大切にしていることとして思い当たるものはない／言語化しにくいと話している。"
        : `明示回答: 本人は「${slotName}」について、今は特に思い当たることはない／言語化しにくいと話している。`,
    evidence_utterance: formatSpeakerEvidence(utterance),
  };
}

function createUncertainSlotState(
  slotName: AcpSlotName,
  utterance: ConversationUtterance,
  kind: UncertainResponseKind,
): AcpSlotState {
  return {
    slot_name: slotName,
    status: "partial",
    summary: `${UNCERTAINTY_SLOT_SUMMARY} reason_hint=${kind}`,
    evidence_utterance: formatSpeakerEvidence(utterance),
  };
}

function countPromptsForSlot(
  utterances: ConversationUtterance[],
  slotName: AcpSlotName,
) {
  return utterances.filter((utterance) => {
    if (utterance.speaker === "elder") return false;
    return findPromptedSlotFromText(utterance.text) === slotName;
  }).length;
}

function isLegacyDialogueMode() {
  return process.env.ACP_DIALOGUE_MODE === "legacy";
}

function isUncertaintySummary(text: string) {
  return text.includes(UNCERTAINTY_SUMMARY_PREFIX) || /reason_hint=/.test(text);
}

function formatSpeakerEvidence(utterance: ConversationUtterance) {
  const speaker =
    utterance.speaker === "elder"
      ? "本人"
      : utterance.speaker === "caregiver"
        ? "介護者"
        : "家族";

  return `${speaker}: ${truncate(utterance.text, 160)}`;
}

function getTopicRelatedUtterances(context: ConversationContext) {
  const topic = resolveTopic(context.currentTopic);
  const keywords = SLOT_KEYWORDS[topic.slot_name as AcpSlotName] ?? [];
  const related = context.utterances.filter((utterance) =>
    hasKeyword(utterance.text, keywords),
  );

  return related.length > 0
    ? related.slice(-12)
    : recentUtterances(context.utterances, 8);
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

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
};

const SYSTEM_NEXT_QUESTION = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、会話を支配することではなく、介護者が自然に次の質問を行えるように、現在の文脈に最も合う質問を1つだけ生成することです。",
  "質問選択の主軸は current_topic です。ACP全体の未充足スロットは補助情報として扱ってください。",
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
  "本人が質問に対して「特にない」「今はない」「思いつかない」などと明示した場合、それは無回答ではなく有効回答です。該当スロットは filled とし、summaryには今は特に思い当たることがない旨を記録してください。",
  "明示的な「ない」を、AIの推測で別の希望や価値観に置き換えないでください。",
  "本人の発話を根拠として優先し、推測で埋めないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"slots":[{"slot_name":"価値観","status":"empty | partial | filled","summary":"...","evidence_utterance":"..."}]}',
].join("\n");

const SYSTEM_TOPIC_SWITCH = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、今の話題を終えて次へ進んでよいかを判定し、介護者が自然に話題を運べる一文を1つだけ生成することです。",
  "まず current_topic が十分に話されたかを、current_topic に関係する発話とスロット状態から判断してください。",
  "本人が current_topic について「特にない」「今はない」「思いつかない」などと答えている場合、それを有効な回答として扱い、同じ直接質問を繰り返さないでください。",
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
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"markdown":"# ACP対話 議事録\\n...","json":{"generated_at":"...","session":{"id":"...","participant_code":"..."},"summary":"...","slots":[...],"utterances":[...]}}',
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
    Array.isArray(result.slots) ? result.slots : fallback,
  );

  return mergeSlotStates(context.slotStates, updatedSlots);
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
  const fallback = fallbackTopicSwitch(context);
  const result = await requestJson<Partial<TopicSwitchResult>>(
    SYSTEM_TOPIC_SWITCH,
    buildConversationPayload(context),
    fallback,
  );

  return {
    message: nonEmpty(result.message, fallback.message),
    target_slot: nonEmpty(result.target_slot, fallback.target_slot),
    should_switch:
      typeof result.should_switch === "boolean"
        ? result.should_switch
        : fallback.should_switch,
    next_topic: nonEmpty(result.next_topic, fallback.next_topic),
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
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;

  return {
    discussion_topic: DISCUSSION_TOPIC,
    session: getSessionMetadata(context),
    current_topic: {
      slot_name: currentTopic.slot_name,
      title: context.currentTopicTitle || currentTopic.title,
      status: findSlotState(context.slotStates, currentTopic.slot_name)?.status ?? "empty",
      summary: findSlotState(context.slotStates, currentTopic.slot_name)?.summary ?? "",
    },
    next_topic: nextTopic
      ? {
          slot_name: nextTopic.slot_name,
          title: context.nextTopicTitle || nextTopic.title,
        }
      : null,
    current_topic_transcript: renderTranscript(getTopicRelatedUtterances(context)),
    all_conversation_log: renderTranscript(context.utterances),
    recent_5_turns: renderTranscript(recentUtterances(context.utterances, 5)),
    slot_states: context.slotStates,
    unfilled_slots: getUnfilledSlots(context.slotStates).map((slot) => ({
      slot_name: slot.slot_name,
      status: slot.status,
      summary: slot.summary,
    })),
    explicit_none_answers: detectExplicitNoneResponses(context).map((response) => ({
      slot_name: response.slotName,
      evidence_utterance: formatSpeakerEvidence(response.utterance),
    })),
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
      utterances: Array.isArray(rawJson.utterances)
        ? (rawJson.utterances as ConversationUtterance[])
        : context.utterances,
      slots: Array.isArray(rawJson.slots)
        ? (rawJson.slots as AcpSlotState[])
        : context.slotStates,
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
    const explicitNone = findExplicitNoneResponseForSlot(
      utterances,
      slotName,
      currentTopic,
    );
    if (explicitNone) {
      return createExplicitNoneSlotState(slotName, explicitNone);
    }

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

function applyExplicitNoneResponses(
  context: ConversationContext,
  slots: AcpSlotState[],
): AcpSlotState[] {
  const responses = detectExplicitNoneResponses(context);
  if (responses.length === 0) return slots;

  const byName = new Map(slots.map((slot) => [slot.slot_name, slot]));

  responses.forEach((response) => {
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

  const question = FALLBACK_QUESTIONS[currentSlot] ?? FALLBACK_QUESTIONS.未解決課題;

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
    });
  });

  return [...responsesBySlot.values()];
}

function findExplicitNoneResponseForSlot(
  utterances: ConversationUtterance[],
  slotName: AcpSlotName,
  currentTopic?: string,
) {
  return detectExplicitNoneResponses({
    utterances,
    slotStates: [],
    currentTopic,
  }).find((response) => response.slotName === slotName)?.utterance;
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

function isExplicitNoneAnswer(text: string) {
  const normalized = normalizeAnswerText(text);
  if (!normalized || normalized.length > 24) return false;

  return (
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに|別に|あまり)?(?:ない|ありません|ないです|なし|思いつかない|浮かばない)(?:な|かな|ですね|です|と思う)?$/.test(
      normalized,
    ) ||
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに).*(?:ない|ありません|なし|思いつかない|浮かばない)$/.test(
      normalized,
    )
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
        ? "本人は、今は特に大切にしていることとして思い当たるものはないと話している。"
        : `本人は「${slotName}」について、今は特に思い当たることはないと話している。`,
    evidence_utterance: formatSpeakerEvidence(utterance),
  };
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

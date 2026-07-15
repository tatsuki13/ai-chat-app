import OpenAI from "openai";
import {
  ACP_SLOT_NAMES,
  DISCUSSION_TOPIC,
  DISCUSSION_TOPICS,
  OPTIONAL_RESEARCH_THEMES,
  RESEARCH_THEMES,
  buildFallbackMinutes,
  buildSlotControlDebugState,
  calculateThemeCompletenessMetrics,
  canAskAgainSubSlotState,
  canTransitionSubSlotState,
  createEmptySubSlotStates,
  getCoreResearchThemeAspects,
  getCrossTopicResearchThemeAspects,
  getOptionalResearchThemeAspects,
  getResearchThemeAspects,
  getResearchThemeEvidence,
  getResearchThemeResponseState,
  getResearchThemeSummary,
  getSlotResponseState,
  getCurrentTopicQuestionScope,
  getSlotResolution,
  getSubSlotDefinitions,
  getTopicAspects,
  getCoreAspects,
  getOptionalAspects,
  getCrossTopicAspects,
  getUnfilledSlots,
  isCaregiverSpeaker,
  isElderSpeaker,
  isDeferredSubSlotState,
  isSlotClassificationResponseState,
  isSlotCompletion,
  isSlotReasonCode,
  isTerminalSlotStatus,
  mergeSlotStates,
  normalizeSlotName,
  recentUtterances,
  renderTranscript,
  resolveDiscussionTopic,
  resolveSubSlotDefinition,
  resolveResearchThemeForSlot,
  type AcpSlotName,
  type AuxiliaryMinutesItem,
  type AcpSlotState,
  type ConversationUtterance,
  type SlotClassificationResponseState,
  type SlotCompletion,
  type ScopedSlotStatus,
  type EndCheckResult,
  type FinalMinutesResult,
  type NextQuestionResult,
  type Sensitivity,
  type SlotReasonCode,
  type SlotControlDebugState,
  type StoredSubSlotState,
  type SubSlotControlOverride,
  type TopicSwitchResult,
  type UnansweredReason,
} from "./acp-mvp";

type ConversationContext = {
  utterances: ConversationUtterance[];
  slotStates: AcpSlotState[];
  subSlotStates?: StoredSubSlotState[];
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

const CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX = "介護者解釈に同意: ";

const SYSTEM_NEXT_QUESTION = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、会話を支配することではなく、介護者が自然に次の質問を行えるように、現在の文脈に最も合う質問を1つだけ生成することです。",
  "質問選択の主軸は current_topic です。ACP全体の未充足スロットは補助情報として扱ってください。",
  "通常の質問候補生成では question_scope に含まれる現在テーマのメインスロット、配下サブスロット、関連する保留項目だけを参照してください。",
  "question_scope.allSlotReferenceUsed は false である必要があります。将来テーマや現在テーマと無関係な未充足スロットを質問候補に含めないでください。",
  "研究上の評価単位は research_themes の6Themeです。available_topics は画面遷移用の話題であり、研究Themeそのものではありません。",
  "current_topic.aspects は記録整理と質問生成の補助であり、質問ノルマではありません。",
  "current_topic.core_aspectsを優先し、optional_aspectsを埋めるためだけの質問は生成しないでください。",
  "本人が未検討・不明・言語化困難・回答拒否を示した場合は有効な回答状態として扱い、追及しないでください。",
  "同じテーマで追加質問は最大1回までとし、同じ意味の質問を言い換えて繰り返さないでください。",
  "target_slot には acp_slots に含まれるACPスロットだけを指定してください。「未解決課題」は指定してはいけません。",
  "current_topic と無関係な未充足スロットへ急に移らないでください。",
  "未充足スロットを機械的に埋めるのではなく、直前の会話から自然につながる質問を選んでください。",
  "本人が「特にない」「今はない」「思いつかない」などと答えた場合、それを有効な回答として受け止め、同じ直接質問を繰り返さないでください。",
  "その話題を続ける必要がある場合は、「大切にしていることはありますか」の言い換えではなく、最近の出来事、嫌だったこと、避けたいこと、時間の使い方など具体的な別角度にしてください。",
  "質問は高齢者を責めず、答えやすく、介護者がそのまま読み上げられる日本語にしてください。",
  "重すぎる話題へ急に飛ばず、既に十分話されている内容を繰り返さないでください。",
  "next_question_input.askableSubSlots に含まれる mainSlotId/subSlotId の組み合わせだけを targetMainSlotId/targetSubSlotId に指定してください。",
  "askableSubSlots が空の場合は、追加質問ではなく話題転換や終了確認を促す短い文にしてください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"question":"...","transition_phrase":"...","target_slot":"...","targetMainSlotId":"...","targetSubSlotId":"...","reason":"...","sensitivity":"low | medium | high"}',
].join("\n");

const SYSTEM_CLASSIFY_SLOT_UTTERANCES = [
  "あなたはACP対話ログの発話を、固定されたメインスロット・サブスロット定義へ分類するAIです。",
  "あなたの役割は意味分類だけです。スロット状態の確定、保存可否、状態遷移、再質問可否はコード側が行います。",
  "提供された mainSlotId と subSlotId だけを使用してください。新しいID、スロット名、類似名、別名を作ってはいけません。",
  "発話内容を要約・正規化して正式な内容として返してはいけません。",
  "根拠は必ず conversation_log に存在する utterance.id で返してください。発話IDがない根拠は返さないでください。",
  "一つの発話につき分類は最大3件までにしてください。該当しない発話は unmatchedUtteranceIds に入れてください。",
  "completion は none / partial / complete のみです。",
  "responseState は answered / no_response / explicit_none / not_considered / unable_to_verbalize / declined / ambiguous / conflicting のみです。",
  "reasonCode は not_discussed / time_limit / topic_changed / explicit_none / not_considered / unable_to_verbalize / declined / insufficient_detail / ambiguous / conflicting / null のみです。",
  "完全回答は complete + answered、部分回答は partial + answered、曖昧は partial + ambiguous、矛盾は partial + conflicting としてください。",
  "「特にない」は none + explicit_none + explicit_none、「まだ考えていない」は none + not_considered + not_considered、「言葉にできない」は none + unable_to_verbalize + unable_to_verbalize、「話したくない」は none + declined + declined としてください。",
  "介護者の解釈だけを本人意思にしないでください。介護者要約に本人が明確に同意した場合のみ、介護者要約発話IDと本人同意発話IDを両方 evidenceUtteranceIds に含めてください。",
  "Do not classify caregiver speech alone as the elder's preference. If caregiver speech is used as evidence, evidenceUtteranceIds must also include a nearby later elder agreement or elaboration utterance.",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"classifications":[{"mainSlotId":"...","subSlotId":"...","completion":"none | partial | complete","responseState":"answered | no_response | explicit_none | not_considered | unable_to_verbalize | declined | ambiguous | conflicting","reasonCode":"not_discussed | time_limit | topic_changed | explicit_none | not_considered | unable_to_verbalize | declined | insufficient_detail | ambiguous | conflicting | null","evidenceUtteranceIds":["..."],"classificationNote":"任意"}],"unmatchedUtteranceIds":["..."]}',
].join("\n");

const SYSTEM_END_CHECK = [
  "あなたはACP対話の終了確認を支援するAIです。",
  "会話ログとTheme単位のACPスロット状態を見て、今日の対話を終えてよいかを判定してください。",
  "終了判断の主対象は research_themes の6Themeです。optional_research_themes の未充足だけで終了不可にしないでください。",
  "すべてのAspectがfilledであることを終了条件にしてはいけません。",
  "未検討・不明・言語化困難・希望なし・回答拒否は有効なresponseStateとして扱い、単純な未回答にしないでください。",
  "任意Aspectや細かいAspectが未充足であることだけを理由に終了不可にしないでください。",
  "重要な未確認事項がある場合は、介護者が穏やかに確認できる一文を返してください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"can_end":true,"message":"...","reason":"...","remaining_slots":["..."]}',
].join("\n");

const SYSTEM_FINAL_MINUTES = [
  "あなたはACP対話の実験用議事録を作成するAIです。",
  "会話ログとACPスロット状態から、研究者が確認しやすいMarkdown議事録とJSON要約を作ってください。",
  "固定のお題とTheme -> Aspect -> Evidenceの対応を意識して議事録に含めてください。",
  "slot_states と sub_slot_states はコード側で確定済みの状態です。議事録生成時にスロット状態を変更・補完・再判定してはいけません。",
  "sub_slot_states の completion / responseState / reasonCode / evidenceUtteranceIds をそのまま尊重してください。",
  "AIが表示した質問や話題転換文は介入ログであり、会話ログや本人の根拠発話として扱わないでください。",
  "本人の希望と根拠発話を区別し、推測で断定しないでください。",
  "介護者の要約・解釈に本人が明確に同意した内容を本人意思として記録する場合は、「介護者解釈に同意: 」を付け、介護者発話と本人同意発話を併記してください。",
  "本人の同意が確認できない介護者解釈だけを本人意思として記録しないでください。",
  "本人が「ない」「わからない」「言えない」と答えた項目は、欠落ではなく明示回答として記録してください。",
  "他の話題の発言から補った内容は「(AI推測)」を付け、根拠発話を併記してください。",
  "本人発話にない内容を補完せず、関連発話はあるが明示確認されていない内容は本人の意思として断定しないでください。",
  "未解決課題・次回確認事項はACPスロットに含めず、json.auxiliary_items とMarkdownの補助項目に分けて記録してください。",
  "not_discussed は「今回の対話では話題に上がらなかった」と記載し、「考えていない」と解釈しないでください。",
  "declined は「今回は話さない意向」と記載し、「希望なし」と解釈しないでください。",
  "ambiguous / conflicting は曖昧さや矛盾を残して記載し、一方だけに統合しないでください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"markdown":"# ACP対話 議事録\\n...","json":{"generated_at":"...","session":{"id":"...","participant_code":"..."},"summary":"...","themes":[{"theme_id":"future_life_continuity","title":"...","level":2,"response_state":"expressed","summary":"...","evidence_utterance":"...","aspects":[{"aspect_id":"continued_activity","label":"...","status":"partial | filled | empty","evidence":[...]}]}],"theme_metrics":{"themeReachRate":0,"responseStateCoverage":0,"valueExpressionRate":0,"evidenceCoverage":0},"slots":[...],"auxiliary_items":[{"item_name":"未解決課題・次回確認事項","summary":"...","evidence_utterance":"..."}],"utterances":[...]}}',
].join("\n");

const SYSTEM_SLOT_CONTROL_DEBUG = [
  "あなたはACP対話ログを読み、開発確認用にサブスロットの状態を意味判定するAIです。",
  "テーマ名・サブスロット名は変更せず、提供された topic_id と aspect_id だけを使ってください。",
  "語彙の完全一致ではなく、本人発話の意味から該当するサブスロットを判断してください。",
  "ACPの考え方に沿って、本人の価値観・希望・不安・拒否・保留を尊重し、無理に埋めるための判定はしないでください。",
  "本人発話を最優先してください。ただし、介護者が本人の発言を要約・解釈し、その直後または近接する本人発話で「はい」「そう」「それでいい」「うん」など明確に同意している場合は、本人の意思として扱えます。",
  "介護者の要約・解釈への本人同意を根拠にする場合は、evidence_utterance の先頭に必ず「介護者解釈に同意: 」を付け、介護者の要約発話と本人の同意発話の両方を短く含めてください。",
  "本人の同意がない介護者だけの推測・代弁・解釈は answered / partially_answered にしないでください。",
  "ただし、根拠発話がないもの、会話ログに存在しない根拠、推測だけの内容は answered / partially_answered / not_applicable / declined / unable_to_verbalize にしないでください。",
  "非unansweredにする場合は、必ず会話ログ中の本人発話、または介護者要約と本人同意の短い抜粋を evidence_utterance に入れてください。",
  "本人が「特にない」「該当しない」と明確に答えた場合は not_applicable、話したくない場合は declined、言語化できない場合は unable_to_verbalize としてください。",
  "意味的にそのサブスロットの話として認識できるが、理由・条件・具体性が足りない場合は needs_follow_up または partially_answered としてください。",
  "根拠が弱いが関連発話がある場合は partially_answered、ACP上それ以上深掘りすべき曖昧さがある場合は needs_follow_up、十分に具体的な根拠がある場合だけ answered としてください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"main_slots":[{"topic_id":"...","sub_slots":[{"id":"...","status":"unanswered | partially_answered | answered | not_applicable | declined | unable_to_verbalize | needs_follow_up | deferred","summary":"...","evidence_utterance":"...","unanswered_reason":"not_discussed | time_limit | topic_changed | declined | unable_to_verbalize | needs_follow_up"}]}]}',
].join("\n");

const SLOT_KEYWORDS: Record<AcpSlotName, string[]> = {
  今の生活で大切にしていること: ["大事", "大切", "好き", "楽しみ", "日課", "趣味", "役割", "地域"],
  これからも続けたいこと: ["続けたい", "これから", "今後", "暮らし", "生活", "自宅", "環境", "失いたくない"],
  自分らしく暮らすために大切なこと: ["自分らし", "決めたい", "尊重", "プライバシー", "生きがい", "役割"],
  手助けが必要になったときの希望: ["介護", "手伝", "支援", "世話", "訪問", "ヘルパー", "助け", "不安"],
  家族に伝えておきたいこと: ["家族", "伝えたい", "言っておきたい", "ありがとう", "お願い", "負担", "迷惑"],
  自分で決められないときに相談してほしい人: ["決めて", "判断", "相談", "任せ", "代理", "信頼", "娘", "息子", "妻", "夫"],
};

const FALLBACK_QUESTIONS: Record<AcpSlotName, string> = {
  今の生活で大切にしていること:
    "今の暮らしの中で、大切にしていることや楽しみにしていることはありますか？",
  これからも続けたいこと:
    "これから先も、できるだけ続けていきたいことはありますか？",
  自分らしく暮らすために大切なこと:
    "これからも自分らしく暮らすために、大切にしたいことは何ですか？",
  手助けが必要になったときの希望:
    "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか？",
  家族に伝えておきたいこと:
    "将来の暮らしや支援について、家族に伝えておきたいことはありますか？",
  自分で決められないときに相談してほしい人:
    "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか？",
};

const UNCERTAINTY_REASON_PROMPT =
  "\u4eca\u3059\u3050\u7b54\u3048\u3092\u6c7a\u3081\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u308f\u304b\u3089\u306a\u3044\u611f\u3058\u306f\u3001\u8003\u3048\u305f\u3053\u3068\u304c\u306a\u3044\u304b\u3089\u8fd1\u3044\u3067\u3059\u304b\u3001\u305d\u308c\u3068\u3082\u8a00\u8449\u306b\u3059\u308b\u306e\u304c\u96e3\u3057\u3044\u611f\u3058\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_MOVE_ON_PROMPT =
  "\u7b54\u3048\u3092\u6025\u304c\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u4eca\u306f\u8a00\u8449\u306b\u3057\u306b\u304f\u3044\u3053\u3068\u3068\u3057\u3066\u53d7\u3051\u6b62\u3081\u307e\u3059\u3002\u3044\u3063\u305f\u3093\u5225\u306e\u8a71\u984c\u306b\u79fb\u3063\u3066\u3082\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_REASON =
  "\u4e0d\u660e\u30fb\u4fdd\u7559\u306e\u7406\u7531\u3092\u78ba\u8a8d\u3059\u308b\u305f\u3081";
const UNCERTAINTY_SWITCH_REASON =
  "\u540c\u3058\u8cea\u554f\u3092\u91cd\u306d\u305a\u3001\u4fdd\u7559\u3068\u3057\u3066\u6271\u3063\u3066\u6b21\u306e\u8a71\u984c\u3078\u79fb\u308b\u305f\u3081";

let client: OpenAI | null = null;

type SlotClassificationResult = {
  classifications?: SlotClassification[];
  unmatchedUtteranceIds?: string[];
};

type SlotClassification = {
  mainSlotId?: string;
  subSlotId?: string;
  completion?: string;
  responseState?: string;
  reasonCode?: string | null;
  evidenceUtteranceIds?: unknown;
  classificationNote?: string;
};

type SlotCandidateValidationResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "unknown_main_slot"
        | "unknown_sub_slot"
        | "invalid_sub_slot_parent"
        | "invalid_completion"
        | "invalid_response_state"
        | "invalid_reason_code"
        | "missing_evidence"
        | "unknown_evidence_utterance"
        | "non_elder_evidence"
        | "invalid_transition";
    };

type SlotStateBundle = {
  slotStates: AcpSlotState[];
  subSlotStates: StoredSubSlotState[];
  debug: {
    candidates: SlotClassification[];
    accepted: SlotClassification[];
    rejected: Array<{
      candidate: SlotClassification;
      reason: Exclude<SlotCandidateValidationResult, { accepted: true }>["reason"];
      utteranceIds: string[];
    }>;
    unmatchedUtteranceIds: string[];
  };
};

export async function updateSlotStateBundleFromConversation(
  context: ConversationContext,
): Promise<SlotStateBundle> {
  const fallbackSubSlotStates = context.subSlotStates?.length
    ? context.subSlotStates
    : createEmptySubSlotStates();
  const fallbackSlotStates = deriveMainSlotStatesFromSubSlots(
    context.slotStates,
    fallbackSubSlotStates,
    context.utterances,
  );
  const utterancesWithIds = context.utterances.filter((utterance) => utterance.id);

  if (utterancesWithIds.length === 0) {
    return {
      slotStates: fallbackSlotStates,
      subSlotStates: fallbackSubSlotStates,
      debug: {
        candidates: [],
        accepted: [],
        rejected: [],
        unmatchedUtteranceIds: [],
      },
    };
  }

  const result = await requestJson<SlotClassificationResult>(
    SYSTEM_CLASSIFY_SLOT_UTTERANCES,
    buildSlotClassificationPayload(context, fallbackSubSlotStates),
    { classifications: [], unmatchedUtteranceIds: [] },
  );
  const applied = applySlotClassifications({
    result,
    utterances: context.utterances,
    currentStates: fallbackSubSlotStates,
    currentTopic: context.currentTopic,
    sessionId: context.sessionId,
  });
  const slotStates = deriveMainSlotStatesFromSubSlots(
    context.slotStates,
    applied.subSlotStates,
    context.utterances,
  );

  return {
    slotStates,
    subSlotStates: applied.subSlotStates,
    debug: applied.debug,
  };
}

function buildSlotClassificationPayload(
  context: ConversationContext,
  subSlotStates: StoredSubSlotState[],
) {
  return {
    session: getSessionMetadata(context),
    currentTopic: resolveDiscussionTopic(context.currentTopic),
    slotDefinitions: DISCUSSION_TOPICS.map((topic) => ({
      mainSlotId: topic.id,
      mainSlotLabel: topic.title,
      subSlots: getSubSlotDefinitions()
        .filter((definition) => definition.mainSlotId === topic.id)
        .map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          completeCriteria: definition.completeCriteria,
          partialCriteria: definition.partialCriteria,
          exclusionCriteria: definition.exclusionCriteria,
        })),
    })),
    currentSubSlotStates: subSlotStates,
    conversation_log: context.utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => ({
        id: utterance.id,
        speaker: isCaregiverSpeaker(utterance.speaker) ? "caregiver" : "elder",
        text: utterance.text,
        created_at: utterance.created_at ?? utterance.createdAt ?? null,
      })),
    maxClassificationsPerUtterance: 3,
  };
}

function applySlotClassifications(input: {
  result: SlotClassificationResult;
  utterances: ConversationUtterance[];
  currentStates: StoredSubSlotState[];
  currentTopic?: string;
  sessionId?: string;
}) {
  const utteranceIds = new Set(
    input.utterances.map((utterance) => utterance.id).filter(Boolean) as string[],
  );
  const byKey = new Map(
    input.currentStates.map((state) => [
      `${state.mainSlotId}:${state.subSlotId}`,
      state,
    ]),
  );
  const accepted: SlotClassification[] = [];
  const rejected: SlotStateBundle["debug"]["rejected"] = [];
  const perEvidenceCount = new Map<string, number>();
  const now = new Date().toISOString();
  const currentTopicId = resolveDiscussionTopic(input.currentTopic).id;

  for (const candidate of input.result.classifications ?? []) {
    const evidenceIds = normalizeEvidenceIds(candidate.evidenceUtteranceIds);
    const validation = validateSlotClassificationCandidate(
      candidate,
      evidenceIds,
      utteranceIds,
      input.utterances,
    );

    if (validation.accepted === false) {
      rejected.push({
        candidate,
        reason: validation.reason,
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, validation.reason, evidenceIds, input.sessionId);
      continue;
    }

    const primaryEvidenceId = evidenceIds[0];
    const currentCount = perEvidenceCount.get(primaryEvidenceId) ?? 0;
    if (currentCount >= 3) {
      rejected.push({
        candidate,
        reason: "missing_evidence",
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, "missing_evidence", evidenceIds, input.sessionId);
      continue;
    }
    perEvidenceCount.set(primaryEvidenceId, currentCount + 1);

    const mainSlotId = candidate.mainSlotId as string;
    const subSlotId = candidate.subSlotId as string;
    const key = `${mainSlotId}:${subSlotId}`;
    const current = byKey.get(key);
    const nextBase = {
      mainSlotId,
      subSlotId,
      completion: candidate.completion as SlotCompletion,
      responseState: candidate.responseState as SlotClassificationResponseState,
      reasonCode: (candidate.reasonCode ?? null) as SlotReasonCode | null,
      evidenceUtteranceIds: mergeEvidenceIds(
        current?.evidenceUtteranceIds ?? [],
        evidenceIds,
      ),
      lastUpdatedTopicId: currentTopicId,
      updatedAt: now,
    };
    const nextState: StoredSubSlotState = {
      ...nextBase,
      canAskAgain: canAskAgainSubSlotState(nextBase),
      isDeferred: isDeferredSubSlotState(nextBase),
    };

    if (!canTransitionSubSlotState(current, nextState)) {
      rejected.push({
        candidate,
        reason: "invalid_transition",
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, "invalid_transition", evidenceIds, input.sessionId);
      continue;
    }

    byKey.set(key, mergeSubSlotState(current, nextState));
    accepted.push(candidate);
  }

  return {
    subSlotStates: [...byKey.values()],
    debug: {
      candidates: input.result.classifications ?? [],
      accepted,
      rejected,
      unmatchedUtteranceIds: normalizeEvidenceIds(input.result.unmatchedUtteranceIds),
    },
  };
}

function validateSlotClassificationCandidate(
  candidate: SlotClassification,
  evidenceIds: string[],
  utteranceIds: Set<string>,
  utterances: ConversationUtterance[],
): SlotCandidateValidationResult {
  const mainSlotId = typeof candidate.mainSlotId === "string" ? candidate.mainSlotId : "";
  const subSlotId = typeof candidate.subSlotId === "string" ? candidate.subSlotId : "";
  const knownMainSlot = DISCUSSION_TOPICS.some((topic) => topic.id === mainSlotId);

  if (!knownMainSlot) return { accepted: false, reason: "unknown_main_slot" };
  if (!subSlotId) return { accepted: false, reason: "unknown_sub_slot" };

  const anySubSlot = getSubSlotDefinitions().some(
    (definition) => definition.id === subSlotId,
  );
  if (!anySubSlot) return { accepted: false, reason: "unknown_sub_slot" };
  if (!resolveSubSlotDefinition(mainSlotId, subSlotId)) {
    return { accepted: false, reason: "invalid_sub_slot_parent" };
  }
  if (!isSlotCompletion(candidate.completion)) {
    return { accepted: false, reason: "invalid_completion" };
  }
  if (!isSlotClassificationResponseState(candidate.responseState)) {
    return { accepted: false, reason: "invalid_response_state" };
  }
  if (candidate.reasonCode !== null && candidate.reasonCode !== undefined) {
    if (!isSlotReasonCode(candidate.reasonCode)) {
      return { accepted: false, reason: "invalid_reason_code" };
    }
  }
  if (candidate.responseState !== "no_response" && evidenceIds.length === 0) {
    return { accepted: false, reason: "missing_evidence" };
  }
  if (evidenceIds.some((id) => !utteranceIds.has(id))) {
    return { accepted: false, reason: "unknown_evidence_utterance" };
  }
  if (!evidenceIdsHaveValidSpeakerConsent(evidenceIds, utterances)) {
    return { accepted: false, reason: "non_elder_evidence" };
  }

  return { accepted: true };
}

function evidenceIdsHaveValidSpeakerConsent(
  evidenceIds: string[],
  utterances: ConversationUtterance[],
) {
  if (evidenceIds.length === 0) return true;

  const evidenceIdSet = new Set(evidenceIds);
  const indexedEvidence = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => utterance.id && evidenceIdSet.has(utterance.id));

  if (indexedEvidence.every(({ utterance }) => isElderSpeaker(utterance.speaker))) {
    return true;
  }

  return indexedEvidence.every(({ utterance, index }) => {
    if (isElderSpeaker(utterance.speaker)) return true;
    if (!isCaregiverSpeaker(utterance.speaker)) return false;

    return indexedEvidence.some(({ utterance: candidate, index: candidateIndex }) => {
      if (!isElderSpeaker(candidate.speaker)) return false;
      if (candidateIndex <= index || candidateIndex - index > 4) return false;

      return isAgreementUtterance(candidate.text) || hasSubstantiveElderEvidence(candidate.text);
    });
  });
}

function mergeSubSlotState(
  current: StoredSubSlotState | undefined,
  next: StoredSubSlotState,
): StoredSubSlotState {
  if (!current) return next;
  if (current.completion === "complete" && next.completion !== "complete") {
    return {
      ...current,
      evidenceUtteranceIds: mergeEvidenceIds(
        current.evidenceUtteranceIds,
        next.evidenceUtteranceIds,
      ),
      updatedAt: next.updatedAt,
    };
  }

  return {
    ...next,
    evidenceUtteranceIds: mergeEvidenceIds(
      current.evidenceUtteranceIds,
      next.evidenceUtteranceIds,
    ),
  };
}

function deriveMainSlotStatesFromSubSlots(
  currentSlots: AcpSlotState[],
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
): AcpSlotState[] {
  const utteranceById = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );
  const currentByName = new Map(currentSlots.map((slot) => [slot.slot_name, slot]));

  return DISCUSSION_TOPICS.map((topic) => {
    const topicStates = subSlotStates.filter((state) => state.mainSlotId === topic.id);
    const strongest = getMainSlotStatusFromSubSlots(topicStates);
    const evidenceIds = mergeEvidenceIds(
      [],
      topicStates.flatMap((state) => state.evidenceUtteranceIds),
    );
    const evidenceText = evidenceIds
      .map((id) => utteranceById.get(id))
      .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
      .map((utterance) => formatSpeakerEvidence(utterance))
      .join("\n");
    const hasCaregiverEvidence = evidenceIds.some((id) => {
      const utterance = utteranceById.get(id);
      return utterance ? isCaregiverSpeaker(utterance.speaker) : false;
    });
    const evidenceWithContext =
      hasCaregiverEvidence && evidenceText
        ? `${CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX}${evidenceText}`
        : evidenceText;
    const summary =
      evidenceWithContext || currentByName.get(topic.slot_name)?.summary || "Unconfirmed";

    return {
      slot_name: topic.slot_name,
      status: strongest,
      summary,
      evidence_utterance: evidenceWithContext,
      updated_at:
        topicStates
          .map((state) => state.updatedAt)
          .sort()
          .at(-1) ?? currentByName.get(topic.slot_name)?.updated_at,
    };
  });
}

function getMainSlotStatusFromSubSlots(
  states: StoredSubSlotState[],
): AcpSlotState["status"] {
  if (states.some((state) => state.responseState === "declined")) {
    return "prefer_not_to_answer";
  }
  if (states.some((state) => state.responseState === "explicit_none")) {
    return "no_preference";
  }
  if (states.some((state) => state.responseState === "unable_to_verbalize")) {
    return "cannot_verbalize";
  }
  if (states.some((state) => state.responseState === "not_considered")) {
    return "not_considered";
  }
  if (states.some((state) => state.completion === "complete")) {
    return "answered";
  }
  if (
    states.some(
      (state) =>
        state.completion === "partial" ||
        state.responseState === "ambiguous" ||
        state.responseState === "conflicting",
    )
  ) {
    return "partial";
  }

  return "unanswered";
}

function normalizeEvidenceIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function mergeEvidenceIds(left: string[], right: string[]) {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))];
}

function logRejectedSlotCandidate(
  candidate: SlotClassification,
  reason: Exclude<SlotCandidateValidationResult, { accepted: true }>["reason"],
  utteranceIds: string[],
  sessionId?: string,
) {
  console.warn("Rejected slot classification", {
    candidate,
    reason,
    utteranceIds,
    sessionId,
    occurredAt: new Date().toISOString(),
  });
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
    await buildQuestionPayload(context),
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
  return fallbackTopicSwitch(context);
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

  const output = {
    can_end: typeof result.can_end === "boolean" ? result.can_end : fallback.can_end,
    message: nonEmpty(result.message, fallback.message),
    reason: nonEmpty(result.reason, fallback.reason),
    remaining_slots: normalizeRemainingSlots(result.remaining_slots, fallback.remaining_slots),
  };

  const endCheckDebug = buildSlotControlDebugState({
    slots: filterAcpSlotStates(context.slotStates),
    currentTopic: context.currentTopic,
    includeBeforeSessionEnd: true,
    subSlotStates: context.subSlotStates,
  });
  const endTargets = endCheckDebug.deferredSlotQueue.filter(
    (item) => item.canAskAgain,
  );

  if (output.can_end && endTargets.length > 0) {
    const labels = [...new Set(endTargets.map((item) => item.mainSlotLabel))].slice(0, 3);

    return {
      can_end: false,
      message: `ここまでのお話では、まだ詳しく触れていないことがいくつかあります。${labels.map((label) => `「${label}」`).join("と")}のうち、今のうちに話しておきたいものはありますか。特になければ、このまま終了しても大丈夫です。\n選択肢: 話す / 今回は話さない / このまま終了する`,
      reason:
        "再確認可能な保留項目が残っているため、終了前にまとめて確認する段階を提示しました。",
      remaining_slots: labels,
    };
  }

  return output;
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

type SemanticSlotControlResult = {
  main_slots?: Array<{
    topic_id?: string;
    sub_slots?: Array<{
      id?: string;
      status?: string;
      summary?: string;
      evidence_utterance?: string;
      unanswered_reason?: string;
    }>;
  }>;
};

export async function buildSemanticSlotControlDebugState(input: {
  utterances: ConversationUtterance[];
  slots: AcpSlotState[];
  currentTopic?: string;
  includeBeforeSessionEnd?: boolean;
}): Promise<SlotControlDebugState> {
  const fallback = buildSlotControlDebugState({
    slots: input.slots,
    currentTopic: input.currentTopic,
    includeBeforeSessionEnd: input.includeBeforeSessionEnd,
  });

  if (input.utterances.length === 0) return fallback;

  const result = await requestJson<SemanticSlotControlResult>(
    SYSTEM_SLOT_CONTROL_DEBUG,
    {
      current_topic: input.currentTopic,
      topics: DISCUSSION_TOPICS.map((topic) => ({
        topic_id: topic.id,
        main_slot: topic.slot_name,
        title: topic.title,
        sub_slots: topic.aspects.map((aspect) => ({
          id: aspect.id,
          label: aspect.label,
          priority: aspect.priority,
        })),
      })),
      slot_states: input.slots,
      conversation_log: renderTranscript(input.utterances),
    },
    { main_slots: [] },
  );
  const overrides = normalizeSemanticSlotOverrides(
    result,
    input.utterances,
  );

  return buildSlotControlDebugState({
    slots: input.slots,
    currentTopic: input.currentTopic,
    includeBeforeSessionEnd: input.includeBeforeSessionEnd,
    subSlotOverrides: overrides,
  });
}

function normalizeSemanticSlotOverrides(
  result: SemanticSlotControlResult,
  utterances: ConversationUtterance[],
): SubSlotControlOverride[] {
  const validTopicIds = new Set<string>(DISCUSSION_TOPICS.map((topic) => topic.id));
  const aspectIdsByTopic = new Map<string, Set<string>>(
    DISCUSSION_TOPICS.map((topic) => [
      topic.id,
      new Set(topic.aspects.map((aspect) => aspect.id)),
    ]),
  );
  const overrides: SubSlotControlOverride[] = [];

  for (const mainSlot of result.main_slots ?? []) {
    const topicId = typeof mainSlot.topic_id === "string" ? mainSlot.topic_id : "";
    if (!validTopicIds.has(topicId)) continue;

    const validAspectIds = aspectIdsByTopic.get(topicId);
    if (!validAspectIds) continue;

    for (const subSlot of mainSlot.sub_slots ?? []) {
      const subSlotId = typeof subSlot.id === "string" ? subSlot.id : "";
      if (!validAspectIds.has(subSlotId)) continue;

      const status = normalizeScopedSlotStatus(subSlot.status);
      const evidence = normalizeEvidenceText(subSlot.evidence_utterance);
      const requiresEvidence = status !== "unanswered" && status !== "deferred";

      if (requiresEvidence && !evidenceMatchesTranscript(evidence, utterances)) {
        continue;
      }

      overrides.push({
        topicId,
        subSlotId,
        status,
        value: evidence || nonEmpty(subSlot.summary, ""),
        unansweredReason: normalizeUnansweredReason(subSlot.unanswered_reason, status),
        lastUpdatedTopicId: topicId,
      });
    }
  }

  return overrides;
}

function normalizeScopedSlotStatus(value: unknown): ScopedSlotStatus {
  switch (value) {
    case "answered":
    case "partially_answered":
    case "not_applicable":
    case "declined":
    case "unable_to_verbalize":
    case "needs_follow_up":
    case "deferred":
      return value;
    default:
      return "unanswered";
  }
}

function normalizeUnansweredReason(
  value: unknown,
  status: ScopedSlotStatus,
): UnansweredReason | undefined {
  switch (value) {
    case "not_discussed":
    case "time_limit":
    case "topic_changed":
    case "declined":
    case "unable_to_verbalize":
    case "needs_follow_up":
      return value;
    default:
      if (status === "declined") return "declined";
      if (status === "unable_to_verbalize") return "unable_to_verbalize";
      if (status === "partially_answered" || status === "needs_follow_up") {
        return "needs_follow_up";
      }
      if (status === "unanswered") return "not_discussed";
      return undefined;
  }
}

function normalizeEvidenceText(value: unknown) {
  if (typeof value !== "string") return "";

  const text = value.trim();

  if (text.startsWith(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX)) {
    return text;
  }

  return text.replace(/^(本人|高齢者役|elder|介護者|caregiver)\s*[:：]\s*/i, "").trim();
}

function evidenceMatchesTranscript(
  evidence: string,
  utterances: ConversationUtterance[],
) {
  if (evidence.startsWith(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX)) {
    return caregiverAgreementEvidenceMatchesTranscript(evidence, utterances);
  }

  const normalizedEvidence = normalizeForEvidenceMatch(evidence);
  if (normalizedEvidence.length < 4) return false;

  return utterances.some((utterance) => {
    if (!isElderSpeaker(utterance.speaker)) return false;

    const normalizedUtterance = normalizeForEvidenceMatch(utterance.text);
    if (!normalizedUtterance) return false;

    return (
      normalizedUtterance.includes(normalizedEvidence) ||
      normalizedEvidence.includes(normalizedUtterance)
    );
  });
}

function caregiverAgreementEvidenceMatchesTranscript(
  evidence: string,
  utterances: ConversationUtterance[],
) {
  const evidenceBody = evidence
    .slice(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX.length)
    .trim();
  const evidencePieces = extractEvidencePieces(evidenceBody);
  const caregiverIndexes = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => isCaregiverSpeaker(utterance.speaker));
  const elderIndexes = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => isElderSpeaker(utterance.speaker));

  const caregiverMatch = caregiverIndexes.find(({ utterance }) =>
    evidencePieces.some((piece) => evidencePieceMatchesUtterance(piece, utterance.text)),
  );
  const elderMatch = elderIndexes.find(({ utterance, index }) => {
    if (!caregiverMatch || index <= caregiverMatch.index || index - caregiverMatch.index > 4) {
      return false;
    }

    return (
      evidencePieces.some((piece) => evidencePieceMatchesUtterance(piece, utterance.text)) ||
      isAgreementUtterance(utterance.text)
    );
  });

  return Boolean(caregiverMatch && elderMatch);
}

function extractEvidencePieces(value: string) {
  return value
    .split(/(?:本人|高齢者役|elder|介護者|caregiver)\s*[:：]|[／/|｜\n]/i)
    .map((piece) => piece.trim())
    .filter((piece) => normalizeForEvidenceMatch(piece).length >= 2);
}

function evidencePieceMatchesUtterance(piece: string, utteranceText: string) {
  const normalizedPiece = normalizeForEvidenceMatch(piece);
  const normalizedUtterance = normalizeForEvidenceMatch(utteranceText);

  if (normalizedPiece.length < 2 || normalizedUtterance.length < 2) return false;

  return (
    normalizedUtterance.includes(normalizedPiece) ||
    normalizedPiece.includes(normalizedUtterance)
  );
}

function isAgreementUtterance(text: string) {
  const normalized = normalizeForEvidenceMatch(text);

  return /^(?:\u306f\u3044|\u3046\u3093|\u305d\u3046|\u305d\u3046\u3067\u3059|\u305d\u308c\u3067\u3044\u3044|\u305d\u308c\u3067\u5927\u4e08\u592b|\u305d\u306e\u901a\u308a|\u5408\u3063\u3066\u3044\u307e\u3059|\u5408\u3063\u3066\u307e\u3059|\u9593\u9055\u3044\u306a\u3044|\u3044\u3044\u3067\u3059|\u5927\u4e08\u592b\u3067\u3059)$/.test(normalized);
}

function hasSubstantiveElderEvidence(text: string) {
  return normalizeForEvidenceMatch(text).length >= 6;
}

function normalizeForEvidenceMatch(value: string) {
  return value
    .replace(/[「」『』"'\s、。,.，．]/g, "")
    .toLowerCase();
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
    console.error("LLM request failed", describeLlmError(error));
    return fallback;
  }
}

function describeLlmError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const record = error as Record<string, unknown>;
  const cause = record.cause;
  const causeRecord =
    cause && typeof cause === "object" ? (cause as Record<string, unknown>) : null;

  return {
    name: typeof record.name === "string" ? record.name : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    status: record.status,
    code: record.code,
    type: record.type,
    requestID: record.requestID,
    cause:
      causeRecord
        ? {
            name: typeof causeRecord.name === "string" ? causeRecord.name : undefined,
            message:
              typeof causeRecord.message === "string"
                ? causeRecord.message
                : undefined,
            code: causeRecord.code,
          }
        : undefined,
  };
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

function normalizeNextQuestionResult(
  result: Partial<NextQuestionResult>,
  fallback: NextQuestionResult,
  context: ConversationContext,
): NextQuestionResult {
  const currentTopic = resolveTopic(context.currentTopic);
  const currentSlot = findSlotState(context.slotStates, currentTopic.slot_name);
  const followUpCount = countPromptsForSlot(
    context.utterances,
    currentTopic.slot_name as AcpSlotName,
  );

  if (
    isTerminalSlotStatus(currentSlot?.status) ||
    followUpCount >= currentTopic.maxFollowUpQuestions
  ) {
    return {
      question:
        "この話題については、今の時点のお考えを確認できたようです。必要であれば、次の話題へ移ってもよさそうです。",
      transition_phrase: "",
      target_slot: currentTopic.slot_name,
      reason:
        isTerminalSlotStatus(currentSlot?.status)
          ? "本人の回答状態が確認できているため、追加質問を停止しました。"
          : "この話題の追加質問上限に達したため、追加質問を停止しました。",
      sensitivity: getSlotSensitivity(currentTopic.slot_name as AcpSlotName),
    };
  }

  const targetSlot = normalizeAcpTargetSlot(result.target_slot, fallback.target_slot);
  const targetMainSlotId =
    typeof result.targetMainSlotId === "string" ? result.targetMainSlotId : "";
  const targetSubSlotId =
    typeof result.targetSubSlotId === "string" ? result.targetSubSlotId : "";
  const askableSubSlots = buildAskableSubSlotsForQuestionPayload(
    buildSlotControlDebugState({
      slots: filterAcpSlotStates(context.slotStates),
      currentTopic: currentTopic.slot_name,
      subSlotStates: context.subSlotStates,
    }),
    context.subSlotStates ?? [],
  );
  const hasValidTargetSubSlot =
    !targetMainSlotId && !targetSubSlotId
      ? true
      : askableSubSlots.some(
          (slot) =>
            slot.mainSlotId === targetMainSlotId &&
            slot.subSlotId === targetSubSlotId,
        );
  const question = nonEmpty(result.question, fallback.question);
  const shouldUseFallbackQuestion =
    isRepeatedQuestion(context.utterances, question, targetSlot) ||
    !isQuestionRelevantToCurrentTopic(context, targetSlot) ||
    !hasValidTargetSubSlot;

  return {
    question: shouldUseFallbackQuestion ? fallback.question : question,
    transition_phrase: nonEmpty(result.transition_phrase, fallback.transition_phrase),
    target_slot: shouldUseFallbackQuestion ? fallback.target_slot : targetSlot,
    targetMainSlotId: shouldUseFallbackQuestion ? undefined : targetMainSlotId || undefined,
    targetSubSlotId: shouldUseFallbackQuestion ? undefined : targetSubSlotId || undefined,
    reason: nonEmpty(result.reason, fallback.reason),
    sensitivity: normalizeSensitivity(result.sensitivity, fallback.sensitivity),
  };
}

function buildConversationPayload(context: ConversationContext) {
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  const acpSlotStates = filterAcpSlotStates(context.slotStates);
  const currentSlotState = findSlotState(acpSlotStates, currentTopic.slot_name);
  const currentResearchTheme = resolveResearchThemeForSlot(currentTopic.slot_name);
  const utteranceById = new Map(
    context.utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );
  const subSlotStates = context.subSlotStates ?? [];

  return {
    discussion_topic: DISCUSSION_TOPIC,
    session: getSessionMetadata(context),
    current_research_theme: {
      id: currentResearchTheme.id,
      level: currentResearchTheme.level,
      title: currentResearchTheme.title,
      opening_question: currentResearchTheme.openingQuestion,
      source_slot_names: currentResearchTheme.sourceSlotNames,
      aspects: getResearchThemeAspects(currentResearchTheme),
      core_aspects: getCoreResearchThemeAspects(currentResearchTheme),
      optional_aspects: getOptionalResearchThemeAspects(currentResearchTheme),
      cross_topic_aspects: getCrossTopicResearchThemeAspects(currentResearchTheme),
      max_follow_up_questions: currentResearchTheme.maxFollowUpQuestions,
      response_state: getResearchThemeResponseState(
        currentResearchTheme,
        acpSlotStates,
      ),
      summary: getResearchThemeSummary(currentResearchTheme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(
        currentResearchTheme,
        acpSlotStates,
      ),
    },
    current_topic: {
      id: currentTopic.id,
      level: currentTopic.level,
      slot_name: currentTopic.slot_name,
      title: context.currentTopicTitle || currentTopic.title,
      opening_question: currentTopic.openingQuestion,
      core_slots: currentTopic.coreSlots,
      optional_slots: currentTopic.optionalSlots,
      cross_topic_slots: currentTopic.crossTopicSlots,
      aspects: getTopicAspects(currentTopic),
      core_aspects: getCoreAspects(currentTopic),
      optional_aspects: getOptionalAspects(currentTopic),
      cross_topic_aspects: getCrossTopicAspects(currentTopic),
      max_follow_up_questions: currentTopic.maxFollowUpQuestions,
      status: currentSlotState?.status ?? "unanswered",
      response_state: getSlotResponseState(currentSlotState),
      summary: currentSlotState?.summary ?? "",
      evidence_utterance: currentSlotState?.evidence_utterance ?? "",
    },
    next_topic: nextTopic
      ? {
          id: nextTopic.id,
          level: nextTopic.level,
          slot_name: nextTopic.slot_name,
          title: context.nextTopicTitle || nextTopic.title,
          opening_question: nextTopic.openingQuestion,
        }
      : null,
    available_topics: DISCUSSION_TOPICS.map((topic) => ({
      id: topic.id,
      level: topic.level,
      slot_name: topic.slot_name,
      title: topic.title,
      opening_question: topic.openingQuestion,
      opening_prompt: topic.opening_prompt,
      core_slots: topic.coreSlots,
      optional_slots: topic.optionalSlots,
      cross_topic_slots: topic.crossTopicSlots,
      aspects: getTopicAspects(topic),
      core_aspects: getCoreAspects(topic),
      optional_aspects: getOptionalAspects(topic),
      cross_topic_aspects: getCrossTopicAspects(topic),
      max_follow_up_questions: topic.maxFollowUpQuestions,
    })),
    research_themes: RESEARCH_THEMES.map((theme) => ({
      id: theme.id,
      level: theme.level,
      title: theme.title,
      opening_question: theme.openingQuestion,
      source_slot_names: theme.sourceSlotNames,
      aspects: getResearchThemeAspects(theme),
      core_aspects: getCoreResearchThemeAspects(theme),
      optional_aspects: getOptionalResearchThemeAspects(theme),
      cross_topic_aspects: getCrossTopicResearchThemeAspects(theme),
      max_follow_up_questions: theme.maxFollowUpQuestions,
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
    })),
    optional_research_themes: OPTIONAL_RESEARCH_THEMES.map((theme) => ({
      id: theme.id,
      level: theme.level,
      title: theme.title,
      opening_question: theme.openingQuestion,
      source_slot_names: theme.sourceSlotNames,
      aspects: getResearchThemeAspects(theme),
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
    })),
    current_topic_transcript: renderTranscript(getTopicRelatedUtterances(context)),
    all_conversation_log: renderTranscript(context.utterances),
    recent_5_turns: renderTranscript(recentUtterances(context.utterances, 5)),
    slot_states: acpSlotStates,
    sub_slot_states: subSlotStates.map((state) => ({
      ...state,
      evidenceUtterances: state.evidenceUtteranceIds
        .map((id) => utteranceById.get(id))
        .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
        .map((utterance) => ({
          id: utterance.id,
          speaker: utterance.speaker,
          text: utterance.text,
          created_at: utterance.created_at ?? utterance.createdAt ?? null,
        })),
    })),
    theme_metrics: calculateThemeCompletenessMetrics(acpSlotStates),
    unfilled_slots: getUnfilledSlots(acpSlotStates).map((slot) => ({
      slot_name: slot.slot_name,
      status: slot.status,
      response_state: getSlotResponseState(slot),
      summary: slot.summary,
    })),
    theme_states: RESEARCH_THEMES.map((theme) => ({
      theme_id: theme.id,
      title: theme.title,
      level: theme.level,
      source_slot_names: theme.sourceSlotNames,
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
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

async function buildQuestionPayload(context: ConversationContext) {
  const payload = buildConversationPayload(context);
  const currentTopic = resolveTopic(context.currentTopic);
  const scopedSlots = filterAcpSlotStates(context.slotStates);
  const currentSlotState = findSlotState(scopedSlots, currentTopic.slot_name);
  const fallbackQuestionScope = getCurrentTopicQuestionScope({
    slots: scopedSlots,
    currentTopic: currentTopic.slot_name,
    subSlotStates: context.subSlotStates,
  });
  const slotControl = buildSlotControlDebugState({
    slots: scopedSlots,
    currentTopic: currentTopic.slot_name,
    subSlotStates: context.subSlotStates,
  });
  const questionScope = buildQuestionScopeFromSlotControl(
    slotControl,
    fallbackQuestionScope,
  );
  const askableSubSlots = buildAskableSubSlotsForQuestionPayload(
    slotControl,
    context.subSlotStates ?? [],
  );

  return {
    ...payload,
    available_topics: payload.available_topics.filter(
      (topic) => topic.slot_name === currentTopic.slot_name,
    ),
    slot_states: currentSlotState ? [currentSlotState] : [],
    unfilled_slots:
      currentSlotState && !isTerminalSlotStatus(currentSlotState.status)
        ? [
            {
              slot_name: currentSlotState.slot_name,
              status: currentSlotState.status,
              response_state: getSlotResponseState(currentSlotState),
              summary: currentSlotState.summary,
            },
          ]
        : [],
    question_scope: questionScope,
    next_question_input: {
      currentTopic: {
        id: currentTopic.id,
        title: currentTopic.title,
      },
      askableSubSlots,
      recentUtterances: recentUtterances(context.utterances, 8).map((utterance) => ({
        id: utterance.id,
        speaker: utterance.speaker,
        text: utterance.text,
      })),
      alreadyAskedQuestions: context.utterances
        .filter((utterance) => !isElderSpeaker(utterance.speaker))
        .map((utterance) => utterance.text)
        .slice(-8),
      remainingQuestionCount: Math.max(
        0,
        currentTopic.maxFollowUpQuestions -
          countPromptsForSlot(context.utterances, currentTopic.slot_name as AcpSlotName),
      ),
    },
    control_debug: {
      currentTopicId: questionScope.currentTopicId,
      currentMainSlot: questionScope.currentMainSlot,
      referencedSubSlots: questionScope.referencedSubSlots.map((slot) => slot.label),
      selectionReason:
        "質問生成payloadでは現在テーマのスロットと関連保留項目のみを参照対象にしています。",
      deferredSlotQueue: questionScope.relatedDeferredItems,
      allSlotReferenceUsed: false,
    },
  };
}

function buildAskableSubSlotsForQuestionPayload(
  debugState: SlotControlDebugState,
  subSlotStates: StoredSubSlotState[],
) {
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);
  if (!currentMainSlot) return [];

  return currentMainSlot.subSlots
    .filter((slot) => slot.canAskAgain)
    .map((slot) => {
      const definition = resolveSubSlotDefinition(currentMainSlot.topicId, slot.id);
      const stored = subSlotStates.find(
        (state) =>
          state.mainSlotId === currentMainSlot.topicId &&
          state.subSlotId === slot.id,
      );

      return {
        mainSlotId: currentMainSlot.topicId,
        subSlotId: slot.id,
        label: slot.label,
        description: definition?.description ?? slot.label,
        completion: stored?.completion ?? "none",
        responseState: stored?.responseState ?? "no_response",
      };
    });
}

function buildQuestionScopeFromSlotControl(
  debugState: SlotControlDebugState,
  fallback: ReturnType<typeof getCurrentTopicQuestionScope>,
) {
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);

  if (!currentMainSlot) return fallback;

  return {
    currentTopicId: debugState.currentTopicId,
    currentMainSlot: debugState.currentMainSlot,
    referencedSubSlots: currentMainSlot.subSlots
      .filter((slot) => slot.canAskAgain)
      .map((slot) => ({
        id: slot.id,
        label: slot.label,
        status: slot.status,
        unansweredReason: slot.unansweredReason,
      })),
    relatedDeferredItems: debugState.deferredSlotQueue.filter(
      (item) => item.suggestedTiming === "related_topic",
    ),
    allSlotReferenceUsed: false,
  };
}

function ensureFinalMinutesIncludeTopic(
  minutes: FinalMinutesResult,
  context: ConversationContext,
): FinalMinutesResult {
  const fallback = buildFallbackMinutes(
    context.utterances,
    context.slotStates,
    getSessionMetadata(context),
  );
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
      themes: Array.isArray(rawJson.themes)
        ? (rawJson.themes as FinalMinutesResult["json"]["themes"])
        : fallback.json.themes,
      optional_themes: Array.isArray(rawJson.optional_themes)
        ? (rawJson.optional_themes as FinalMinutesResult["json"]["optional_themes"])
        : fallback.json.optional_themes,
      theme_metrics:
        rawJson.theme_metrics && typeof rawJson.theme_metrics === "object"
          ? (rawJson.theme_metrics as FinalMinutesResult["json"]["theme_metrics"])
          : fallback.json.theme_metrics,
      auxiliary_items: Array.isArray(rawJson.auxiliary_items)
        ? (rawJson.auxiliary_items as AuxiliaryMinutesItem[])
        : fallback.json.auxiliary_items,
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
  const followUpCount = countPromptsForSlot(utterances, preferredSlot);
  const canCompletePreferredTheme =
    Boolean(getSlotResponseState(preferredState)) ||
    followUpCount >= preferredTopic.maxFollowUpQuestions;

  if (canCompletePreferredTheme) {
    return {
      question:
        "この話題については、今の時点のお考えを確認できたようです。必要であれば、次の話題へ移ってもよさそうです。",
      transition_phrase: "",
      target_slot: preferredSlot,
      reason:
        followUpCount >= preferredTopic.maxFollowUpQuestions
          ? "この話題の追加質問上限に達したため、追加質問を停止しました。"
          : "本人の回答状態が確認できているため、追加質問を停止しました。",
      sensitivity: getSlotSensitivity(preferredSlot),
    };
  }
  const contextualSlot = ACP_SLOT_NAMES.find((slotName) =>
    hasKeyword(recentText, SLOT_KEYWORDS[slotName]),
  );
  const selected =
    !isTerminalSlotStatus(preferredState?.status) ? preferredSlot :
    contextualSlot === preferredSlot ? contextualSlot :
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
  const followUpCount = countPromptsForSlot(context.utterances, currentSlot);
  const canSwitch =
    Boolean(nextTopic) &&
    (Boolean(getSlotResponseState(currentState)) ||
      followUpCount >= currentTopic.maxFollowUpQuestions);

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

  const question =
    FALLBACK_QUESTIONS[currentSlot] ??
    FALLBACK_QUESTIONS["今の生活で大切にしていること"];

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
  const remaining = RESEARCH_THEMES.filter(
    (theme) => !getResearchThemeResponseState(theme, slotStates),
  ).map((theme) => theme.title);
  const metrics = calculateThemeCompletenessMetrics(slotStates);
  const canEnd = remaining.length <= 1 || metrics.responseStateCoverage >= 0.8;

  return {
    can_end: canEnd,
    message: canEnd
      ? "今日のところは大切なお話がかなり確認できています。最後に、言い残したことがないかだけ確認して終えてもよさそうです。"
      : "まだ大切な確認が少し残っています。無理のない範囲で、もう一つだけ確認してから終えると安心です。",
    reason: canEnd
      ? "Theme単位で本人の回答状態または根拠発話が概ね確認できています。Aspect未充足は終了不可の理由にしていません。"
      : "Theme単位で本人の回答状態が未確認の項目が残っています。",
    remaining_slots: remaining,
  };
}

function resolveTopic(value: string | undefined) {
  return resolveDiscussionTopic(value);
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
  const normalizedText = normalizeSlotName(text);
  const normalizedFallback = normalizeSlotName(fallback);

  if (normalizedText) return normalizedText;
  if (normalizedFallback) return normalizedFallback;

  return ACP_SLOT_NAMES[0];
}

function normalizeRemainingSlots(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  const slots = value
    .map(String)
    .map((slotName) => normalizeSlotName(slotName))
    .filter((slotName): slotName is AcpSlotName => Boolean(slotName));

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
    if (isElderSpeaker(utterance.speaker)) return false;

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
  if (isTerminalSlotStatus(currentState?.status)) return true;

  return false;
}

function detectExplicitNoneResponses(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
): ExplicitNoneResponse[] {
  const currentTopic = context.currentTopic
    ? normalizeSlotName(context.currentTopic)
    : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, ExplicitNoneResponse>();

  context.utterances.forEach((utterance, index) => {
    if (!isElderSpeaker(utterance.speaker) || !isExplicitNoneAnswer(utterance.text)) {
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
  const currentTopic = context.currentTopic
    ? normalizeSlotName(context.currentTopic)
    : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, UncertainResponse>();

  context.utterances.forEach((utterance, index) => {
    if (!isElderSpeaker(utterance.speaker) || isExplicitNoneAnswer(utterance.text)) {
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
    .some((utterance) => isElderSpeaker(utterance.speaker));

  return hasNewerElderUtterance ? undefined : latest;
}

function findPromptedSlotBeforeAnswer(
  utterances: ConversationUtterance[],
  answerIndex: number,
) {
  for (let index = answerIndex - 1; index >= Math.max(0, answerIndex - 4); index -= 1) {
    const utterance = utterances[index];
    if (!utterance || isElderSpeaker(utterance.speaker)) continue;

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

function normalizeAnswerText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s　。、．.！!？?「」『』"'`]/g, "");
}

function countPromptsForSlot(
  utterances: ConversationUtterance[],
  slotName: AcpSlotName,
) {
  return utterances.filter((utterance) => {
    if (isElderSpeaker(utterance.speaker)) return false;
    return findPromptedSlotFromText(utterance.text) === slotName;
  }).length;
}

function isLegacyDialogueMode() {
  return process.env.ACP_DIALOGUE_MODE === "legacy";
}

function formatSpeakerEvidence(utterance: ConversationUtterance) {
  const speaker = isCaregiverSpeaker(utterance.speaker) ? "介護者" : "本人";

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
  if (slotName === "自分で決められないときに相談してほしい人") {
    return "high";
  }

  if (
    slotName === "手助けが必要になったときの希望" ||
    slotName === "家族に伝えておきたいこと"
  ) {
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

export const ACP_SLOT_NAMES = [
  "価値観",
  "今後の生活希望",
  "介護希望",
  "医療処置への希望",
  "延命治療への考え",
  "最期を迎えたい場所",
  "代理意思決定者",
  "家族に伝えたいこと",
  "不安・心配",
] as const;

export const DISCUSSION_TOPIC = {
  title: "これからの暮らしと大切にしたいこと",
  description:
    "生活の希望、介護や医療への考え、家族に伝えておきたいことを、無理のない範囲で話し合います。",
};

export const DISCUSSION_TOPICS = [
  {
    id: "daily_continuity",
    level: 1,
    slot_name: "今後の生活希望",
    title: "最近の生活と、これからも続けたいこと",
    openingQuestion:
      "今の暮らしの中で、大切にしていることや、これから先もできるだけ続けていきたいことはありますか。",
    opening_prompt:
      "最近の生活で、これからも続けたいことは何ですか。\nお二人で、話しやすいところから話してみてください。",
    aspects: [
      { id: "valued_routine", label: "大切にしている日課", priority: "core" },
      { id: "continued_activity", label: "続けたい活動", priority: "core" },
      { id: "reason", label: "なぜ大切なのか", priority: "core" },
      { id: "relationships", label: "続けたい人間関係", priority: "optional" },
      { id: "environment", label: "維持したい生活環境", priority: "optional" },
      { id: "support", label: "支援を受けても続けたいこと", priority: "cross_topic" },
    ],
    coreSlots: ["続けたいこと", "大切にしている理由"],
    optionalSlots: ["一緒に続けたい人", "続けたい場所", "必要な支援"],
    crossTopicSlots: ["希望する暮らし方", "自分らしさ", "大切な人間関係"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "values",
    level: 2,
    slot_name: "価値観",
    title: "大切にしたいこと",
    openingQuestion:
      "これからも自分らしく暮らすために、大切にしたいことは何ですか。",
    opening_prompt:
      "普段の暮らしの中で、これだけは大切にしたいと思うことはありますか。",
    aspects: [
      { id: "values", label: "大切にしたい価値観", priority: "core" },
      { id: "self_determination", label: "自分で決めたいこと", priority: "core" },
      { id: "respect", label: "尊重してほしいこと", priority: "core" },
      { id: "privacy", label: "プライバシー", priority: "optional" },
      { id: "comfort", label: "心身の快適さ", priority: "optional" },
      { id: "role", label: "生きがいや役割", priority: "cross_topic" },
    ],
    coreSlots: ["大切にしたい価値観", "その理由"],
    optionalSlots: ["守りたい習慣", "避けたいこと"],
    crossTopicSlots: ["自分らしさ", "安心できる過ごし方"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "care_preference",
    level: 3,
    slot_name: "介護希望",
    title: "手助けが必要になった時の希望",
    openingQuestion:
      "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか。",
    opening_prompt:
      "もし暮らしの中で手助けが必要になった場合、どのような支援なら受け入れやすいですか。",
    aspects: [
      { id: "acceptable_support", label: "受け入れられる支援", priority: "core" },
      { id: "unacceptable_support", label: "受け入れにくい支援", priority: "core" },
      { id: "support_person", label: "誰に頼みたいか", priority: "optional" },
      { id: "timing", label: "いつ頃から支援してほしいか", priority: "optional" },
      { id: "decision_process", label: "支援内容をどう決めたいか", priority: "cross_topic" },
      { id: "anxiety", label: "支援への不安", priority: "cross_topic" },
    ],
    coreSlots: ["受け入れやすい支援", "避けたい支援"],
    optionalSlots: ["支援してほしい人", "自分で続けたいこと"],
    crossTopicSlots: ["支援への不安", "希望する暮らし方"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "medical_preference",
    level: 4,
    slot_name: "医療処置への希望",
    title: "医療や治療について大切にしたいこと",
    openingQuestion:
      "もし体調が大きく変わったとき、医療や治療について大切にしたいことはありますか。",
    opening_prompt:
      "治療や医療を受ける場面で、大切にしたいことや避けたいことはありますか。",
    aspects: [
      { id: "medical_values", label: "医療で大切にしたいこと", priority: "core" },
      { id: "avoid_treatment", label: "避けたい医療", priority: "core" },
      { id: "comfort", label: "安心や苦痛軽減など大切なこと", priority: "core" },
      { id: "consultation", label: "相談したい相手", priority: "optional" },
      { id: "conditions", label: "状況によって変わる条件", priority: "cross_topic" },
    ],
    coreSlots: ["医療で大切にしたいこと", "避けたい医療"],
    optionalSlots: ["相談したい相手", "判断時に重視する条件"],
    crossTopicSlots: ["支援への不安", "家族への希望"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "proxy_decision_maker",
    level: 4,
    slot_name: "代理意思決定者",
    title: "相談して決めてほしい人",
    openingQuestion:
      "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか。",
    opening_prompt:
      "ご自身で判断しにくい時、医療や介護のことを誰に相談して決めてほしいですか。",
    aspects: [
      { id: "trusted_person", label: "信頼できる人", priority: "core" },
      { id: "trust_reason", label: "信頼する理由", priority: "core" },
      { id: "values_to_share", label: "その人に知っておいてほしい価値観", priority: "core" },
      { id: "involvement", label: "どのように関わってほしいか", priority: "optional" },
      { id: "multiple_people", label: "複数人で相談してほしいか", priority: "optional" },
      { id: "hard_to_decide", label: "決めにくい理由", priority: "cross_topic" },
    ],
    coreSlots: ["相談して決めてほしい人"],
    optionalSlots: ["その人に伝えたい判断基準", "避けてほしい決め方"],
    crossTopicSlots: ["家族への希望", "大切な人間関係"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "family_message",
    level: 3,
    slot_name: "家族に伝えたいこと",
    title: "家族に伝えておきたいこと",
    openingQuestion:
      "将来の暮らしや支援について、家族に伝えておきたいことはありますか。",
    opening_prompt:
      "ご家族に、今のうちに伝えておきたいことやお願いしておきたいことはありますか。",
    aspects: [
      { id: "request", label: "家族にお願いしたいこと", priority: "core" },
      { id: "burden_concern", label: "家族への負担の懸念", priority: "core" },
      { id: "feelings", label: "家族への気持ち", priority: "core" },
      { id: "expected_judgement", label: "家族に期待する判断", priority: "optional" },
      { id: "avoidance", label: "家族にしてほしくないこと", priority: "optional" },
      { id: "unspoken", label: "まだ話せていないこと", priority: "cross_topic" },
    ],
    coreSlots: ["家族に伝えたいこと"],
    optionalSlots: ["お願いしたいこと", "感謝や気がかり"],
    crossTopicSlots: ["家族への希望", "大切な人間関係"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "worries",
    level: 3,
    slot_name: "不安・心配",
    title: "不安や心配",
    openingQuestion:
      "これからのことで、不安に感じていることや、まだ話せていないことはありますか。",
    opening_prompt:
      "これからのことで、不安に感じていることや心配なことはありますか。",
    aspects: [
      { id: "concern", label: "不安や心配の内容", priority: "core" },
      { id: "burden", label: "負担の懸念", priority: "core" },
      { id: "relief_support", label: "不安を軽くする支援", priority: "optional" },
      { id: "consultation", label: "相談したい相手", priority: "optional" },
      { id: "unspoken", label: "まだ話せていないこと", priority: "cross_topic" },
    ],
    coreSlots: ["不安や心配の内容"],
    optionalSlots: ["不安を軽くする支援", "相談したい相手"],
    crossTopicSlots: ["支援への不安", "安心できる過ごし方"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "life_sustaining_treatment",
    level: 4,
    slot_name: "延命治療への考え",
    title: "命に関わる治療についての考え",
    openingQuestion:
      "もし命に関わる状態になった時、医療や過ごし方について今の時点で考えていることはありますか。",
    opening_prompt:
      "もし命に関わる状態になった時、延命治療について今の時点で考えていることはありますか。",
    aspects: [
      { id: "current_thought", label: "延命治療への現在の考え", priority: "core" },
      { id: "condition", label: "重視する状態や条件", priority: "core" },
      { id: "avoid_state", label: "避けたい状態", priority: "core" },
      { id: "consult_person", label: "判断を相談したい人", priority: "optional" },
      { id: "not_ready", label: "まだ考えられないこと", priority: "cross_topic" },
    ],
    coreSlots: ["延命治療への現在の考え"],
    optionalSlots: ["判断を相談したい人", "重視する状態や条件"],
    crossTopicSlots: ["医療への希望", "家族への希望"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "preferred_final_place",
    level: 4,
    slot_name: "最期を迎えたい場所",
    title: "最期の時期を過ごしたい場所",
    openingQuestion:
      "もし体調が大きく変わったとき、どこで、誰と、どのように過ごせると安心だと思いますか。",
    opening_prompt:
      "もし最期の時期を考えるとしたら、どこで誰と過ごせると安心だと思いますか。",
    aspects: [
      { id: "place", label: "過ごしたい場所", priority: "core" },
      { id: "person", label: "一緒にいてほしい人", priority: "core" },
      { id: "environment", label: "望む環境や雰囲気", priority: "core" },
      { id: "comfort", label: "安心や苦痛軽減など大切なこと", priority: "optional" },
      { id: "avoid_state", label: "避けたい状態", priority: "optional" },
      { id: "conditional", label: "状況によって変わる条件", priority: "cross_topic" },
    ],
    coreSlots: ["最期を過ごしたい場所", "一緒にいたい人"],
    optionalSlots: ["安心できる環境", "避けたい場所"],
    crossTopicSlots: ["安心できる過ごし方", "大切な人間関係"],
    maxFollowUpQuestions: 1,
  },
] as const;

export type AcpSlotName = (typeof ACP_SLOT_NAMES)[number];
export type SlotStatus =
  | "unanswered"
  | "partial"
  | "answered"
  | "no_preference"
  | "not_considered"
  | "cannot_verbalize"
  | "prefer_not_to_answer"
  | "not_asked";
export type SlotImportance = "core" | "optional";
export type ThemeLevel = 1 | 2 | 3 | 4;
export type AspectPriority = "core" | "optional" | "cross_topic";
export type AspectStatus = "empty" | "partial" | "filled";
export type ResponseState =
  | "expressed"
  | "not_considered"
  | "no_preference"
  | "uncertain"
  | "difficulty_verbalizing"
  | "declined"
  | null;
export type AspectDefinition = {
  id: string;
  label: string;
  priority: AspectPriority;
};
export type EvidenceReference = {
  themeId: string;
  aspectId: string;
  evidenceUtteranceId?: string;
  evidenceText: string;
  speaker?: string;
  sourceTopicId?: string;
  inferred: boolean;
  confidence?: number;
};
export type ThemeCompletenessMetrics = {
  themeReachRate: number;
  responseStateCoverage: number;
  valueExpressionRate: number;
  evidenceCoverage: number;
};
export type Speaker = "caregiver" | "elder" | "family";
export type ButtonType =
  | "next_question"
  | "switch_topic"
  | "check_end"
  | "update_slots";
export type SuggestionType = "next_question" | "switch_topic" | "check_end";
export type Sensitivity = "low" | "medium" | "high";

export type ConversationUtterance = {
  id?: string;
  speaker: string;
  text: string;
  created_at?: string;
  createdAt?: string;
};

export type AcpSlotState = {
  slot_name: AcpSlotName | string;
  status: SlotStatus;
  summary: string;
  evidence_utterance: string;
  updated_at?: string;
};

export type NextQuestionResult = {
  question: string;
  transition_phrase: string;
  target_slot: AcpSlotName | string;
  reason: string;
  sensitivity: Sensitivity;
};

export type TopicSwitchResult = {
  message: string;
  target_slot: AcpSlotName | string;
  reason: string;
  sensitivity: Sensitivity;
  should_switch: boolean;
  next_topic: string;
};

export type EndCheckResult = {
  can_end: boolean;
  message: string;
  reason: string;
  remaining_slots: string[];
};

export type FinalMinutesResult = {
  markdown: string;
  json: {
    generated_at: string;
    session?: {
      id?: string;
      participant_code?: string | null;
    };
    discussion_topic: typeof DISCUSSION_TOPIC;
    utterances: ConversationUtterance[];
    slots: AcpSlotState[];
    auxiliary_items?: AuxiliaryMinutesItem[];
    summary: string;
  };
};

export type AuxiliaryMinutesItem = {
  item_name: string;
  summary: string;
  evidence_utterance: string;
};

export const BUTTON_LABELS: Record<ButtonType, string> = {
  next_question: "質問する",
  switch_topic: "話題を変える",
  check_end: "終了確認",
  update_slots: "議事録更新",
};

export const BUTTON_TYPES = Object.keys(BUTTON_LABELS) as ButtonType[];

export const SPEAKER_LABELS: Record<string, string> = {
  A: "本人",
  B: "介護者",
  caregiver: "介護者",
  elder: "本人",
  family: "家族",
};

export function createEmptySlotStates(): AcpSlotState[] {
  return ACP_SLOT_NAMES.map((slotName) => ({
    slot_name: slotName,
    status: "unanswered",
    summary: "未確認",
    evidence_utterance: "",
  }));
}

export function mergeSlotStates(
  current: AcpSlotState[],
  updates: AcpSlotState[],
): AcpSlotState[] {
  const byName = new Map(current.map((slot) => [slot.slot_name, slot]));

  updates.forEach((slot) => {
    byName.set(slot.slot_name, {
      slot_name: slot.slot_name,
      status: normalizeSlotStatus(slot.status),
      summary: String(slot.summary || "未確認"),
      evidence_utterance: String(slot.evidence_utterance || ""),
      updated_at: slot.updated_at,
    });
  });

  return ACP_SLOT_NAMES.map((slotName) => {
    return (
      byName.get(slotName) ?? {
        slot_name: slotName,
        status: "unanswered",
        summary: "未確認",
        evidence_utterance: "",
      }
    );
  });
}

export function normalizeSlotStatus(value: unknown): SlotStatus {
  if (value === "filled") return "answered";
  if (value === "empty") return "unanswered";
  if (
    value === "partial" ||
    value === "answered" ||
    value === "no_preference" ||
    value === "not_considered" ||
    value === "cannot_verbalize" ||
    value === "prefer_not_to_answer" ||
    value === "not_asked" ||
    value === "unanswered"
  ) {
    return value;
  }

  return "unanswered";
}

export function isButtonType(value: unknown): value is ButtonType {
  return typeof value === "string" && BUTTON_TYPES.includes(value as ButtonType);
}

export function getUnfilledSlots(slots: AcpSlotState[]) {
  return slots.filter((slot) => !isTerminalSlotStatus(slot.status));
}

export function isTerminalSlotStatus(status: unknown) {
  return (
    status === "answered" ||
    status === "no_preference" ||
    status === "not_considered" ||
    status === "cannot_verbalize" ||
    status === "prefer_not_to_answer" ||
    status === "filled"
  );
}

export function getTopicSlotImportance(slotName: string): SlotImportance {
  return DISCUSSION_TOPICS.some((topic) => topic.slot_name === slotName)
    ? "core"
    : "optional";
}

export function canCompleteTopicSlot(slot: AcpSlotState | undefined) {
  return slot ? isTerminalSlotStatus(slot.status) : false;
}

export function getSlotResponseState(slot: AcpSlotState | undefined): ResponseState {
  switch (slot?.status) {
    case "answered":
      return "expressed";
    case "no_preference":
      return "no_preference";
    case "not_considered":
      return "not_considered";
    case "cannot_verbalize":
      return "difficulty_verbalizing";
    case "prefer_not_to_answer":
      return "declined";
    case "partial":
      return "uncertain";
    default:
      return null;
  }
}

export function getTopicAspects(topic: (typeof DISCUSSION_TOPICS)[number]) {
  return topic.aspects;
}

export function getCoreAspects(topic: (typeof DISCUSSION_TOPICS)[number]) {
  return topic.aspects.filter((aspect) => aspect.priority === "core");
}

export function getOptionalAspects(topic: (typeof DISCUSSION_TOPICS)[number]) {
  return topic.aspects.filter((aspect) => aspect.priority === "optional");
}

export function getCrossTopicAspects(topic: (typeof DISCUSSION_TOPICS)[number]) {
  return topic.aspects.filter((aspect) => aspect.priority === "cross_topic");
}

export function calculateThemeCompletenessMetrics(
  slots: AcpSlotState[],
): ThemeCompletenessMetrics {
  const themeCount = DISCUSSION_TOPICS.length;
  const slotsByName = new Map(slots.map((slot) => [slot.slot_name, slot]));
  const reachedThemes = DISCUSSION_TOPICS.filter((topic) => {
    const slot = slotsByName.get(topic.slot_name);
    return Boolean(slot && slot.status !== "unanswered" && slot.status !== "not_asked");
  });
  const responseStateThemes = DISCUSSION_TOPICS.filter((topic) =>
    Boolean(getSlotResponseState(slotsByName.get(topic.slot_name))),
  );
  const valueExpressionThemes = DISCUSSION_TOPICS.filter(
    (topic) => getSlotResponseState(slotsByName.get(topic.slot_name)) === "expressed",
  );
  const evidenceThemes = DISCUSSION_TOPICS.filter((topic) => {
    const slot = slotsByName.get(topic.slot_name);
    return Boolean(slot?.evidence_utterance?.trim());
  });

  return {
    themeReachRate: ratio(reachedThemes.length, themeCount),
    responseStateCoverage: ratio(responseStateThemes.length, themeCount),
    valueExpressionRate: ratio(valueExpressionThemes.length, themeCount),
    evidenceCoverage: ratio(evidenceThemes.length, themeCount),
  };
}

export function resolveDiscussionTopic(slotName: string | undefined) {
  return (
    DISCUSSION_TOPICS.find((topic) => topic.slot_name === slotName) ??
    DISCUSSION_TOPICS[0]
  );
}

export function recentUtterances(utterances: ConversationUtterance[], count = 5) {
  return utterances.slice(Math.max(0, utterances.length - count));
}

export function renderTranscript(utterances: ConversationUtterance[]) {
  return utterances
    .map((utterance) => {
      const timestamp = utterance.created_at ?? utterance.createdAt ?? "";
      const speaker = SPEAKER_LABELS[utterance.speaker] ?? utterance.speaker;
      const prefix = timestamp ? `[${timestamp}] ` : "";

      return `${prefix}${speaker}: ${utterance.text}`;
    })
    .join("\n");
}

export function buildFallbackMinutes(
  utterances: ConversationUtterance[],
  slots: AcpSlotState[],
  session?: { id?: string; participant_code?: string | null },
): FinalMinutesResult {
  const generatedAt = new Date().toISOString();
  const acpSlots = slots.filter((slot) =>
    ACP_SLOT_NAMES.includes(slot.slot_name as AcpSlotName),
  );
  const auxiliaryItems = [buildUnresolvedAuxiliaryItem(utterances)];
  const lines = [
    "# ACP対話 議事録",
    "",
    `生成日時: ${generatedAt}`,
    `参加者ID: ${session?.participant_code || "-"}`,
    `内部ID: ${session?.id || "-"}`,
    `発話数: ${utterances.length}`,
    "",
    "## 話し合ったお題",
    "",
    `### ${DISCUSSION_TOPIC.title}`,
    DISCUSSION_TOPIC.description,
    "",
    "## ACPスロット",
    "",
  ];

  acpSlots.forEach((slot) => {
    lines.push(`### ${slot.slot_name}`);
    lines.push(`- status: ${slot.status}`);
    lines.push(`- summary: ${slot.summary || "未確認"}`);
    lines.push(`- evidence_utterance: ${slot.evidence_utterance || "なし"}`);
    lines.push("");
  });

  lines.push("## 補助項目");
  lines.push("");
  auxiliaryItems.forEach((item) => {
    lines.push(`### ${item.item_name}`);
    lines.push(`- summary: ${item.summary}`);
    lines.push(`- evidence_utterance: ${item.evidence_utterance || "なし"}`);
    lines.push("");
  });

  lines.push("## 発話ログ");
  lines.push("");
  utterances.forEach((utterance) => {
    const speaker = SPEAKER_LABELS[utterance.speaker] ?? utterance.speaker;
    lines.push(`- ${speaker}: ${utterance.text}`);
  });

  return {
    markdown: lines.join("\n"),
    json: {
      generated_at: generatedAt,
      session,
      discussion_topic: DISCUSSION_TOPIC,
      utterances,
      slots: acpSlots,
      auxiliary_items: auxiliaryItems,
      summary: "会話ログとACPスロット状態から生成した議事録です。",
    },
  };
}

function buildUnresolvedAuxiliaryItem(
  utterances: ConversationUtterance[],
): AuxiliaryMinutesItem {
  const evidence = [...utterances]
    .reverse()
    .find((utterance) =>
      /未解決|決めきれない|決まっていない|まだ|後で|あとで|確認|相談|迷って|迷う|わからない|分からない/.test(
        utterance.text,
      ),
    );

  if (!evidence) {
    return {
      item_name: "未解決課題・次回確認事項",
      summary: "会話ログ上、明確な未解決課題や次回確認事項は確認されていません。",
      evidence_utterance: "",
    };
  }

  const speaker = SPEAKER_LABELS[evidence.speaker] ?? evidence.speaker;

  return {
    item_name: "未解決課題・次回確認事項",
    summary: `補助項目として記録: ${truncate(evidence.text, 120)}`,
    evidence_utterance: `${speaker}: ${truncate(evidence.text, 160)}`,
  };
}

function truncate(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function ratio(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

export function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

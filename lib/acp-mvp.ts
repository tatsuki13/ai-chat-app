export const ACP_SLOT_NAMES = [
  "今の生活で大切にしていること",
  "これからも続けたいこと",
  "自分らしく暮らすために大切なこと",
  "手助けが必要になったときの希望",
  "家族に伝えておきたいこと",
  "自分で決められないときに相談してほしい人",
] as const;

export const DISCUSSION_TOPIC = {
  title: "これからの暮らしと大切にしたいこと",
  description:
    "生活の希望、介護や医療への考え、家族に伝えておきたいことを、無理のない範囲で話し合います。",
};

export const DISCUSSION_TOPICS = [
  {
    id: "current_life_values",
    level: 1,
    slot_name: "今の生活で大切にしていること",
    title: "今の生活で大切にしていること",
    openingQuestion:
      "今の暮らしの中で、大切にしていることや楽しみにしていることはありますか。",
    opening_prompt:
      "今の暮らしの中で、大切にしていることや楽しみにしていることはありますか。",
    aspects: [
      { id: "valued_routine", label: "大切にしている日課", priority: "core" },
      { id: "hobby_or_joy", label: "趣味や楽しみ", priority: "core" },
      { id: "relationships", label: "大切な人間関係", priority: "optional" },
      { id: "role", label: "家族や地域での役割", priority: "optional" },
      { id: "attachment", label: "自宅や地域への愛着", priority: "optional" },
      { id: "reason", label: "なぜ大切なのか", priority: "core" },
    ],
    coreSlots: ["大切にしている日課", "趣味や楽しみ", "なぜ大切なのか"],
    optionalSlots: ["大切な人間関係", "家族や地域での役割", "自宅や地域への愛着"],
    crossTopicSlots: ["人とのつながり", "生活環境", "自分らしさ"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "future_life_continuity",
    level: 2,
    slot_name: "これからも続けたいこと",
    title: "これからも続けたいこと",
    openingQuestion:
      "これから先も、できるだけ続けていきたいことはありますか。",
    opening_prompt:
      "これから先も、できるだけ続けていきたいことはありますか。",
    aspects: [
      { id: "continued_activity", label: "続けたい活動", priority: "core" },
      { id: "continued_relationship", label: "続けたい人間関係", priority: "optional" },
      { id: "self_continuation", label: "自分で続けたいこと", priority: "core" },
      { id: "preferred_environment", label: "維持したい生活環境", priority: "optional" },
      { id: "acceptable_change", label: "変わっても受け入れられること", priority: "optional" },
      { id: "not_want_to_lose", label: "失いたくないこと", priority: "core" },
      { id: "reason", label: "続けたい理由", priority: "core" },
    ],
    coreSlots: ["続けたい活動", "自分で続けたいこと", "失いたくないこと", "続けたい理由"],
    optionalSlots: ["続けたい人間関係", "維持したい生活環境", "変わっても受け入れられること"],
    crossTopicSlots: ["自分らしさ", "支援", "安心できる過ごし方"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "selfhood",
    level: 2,
    slot_name: "自分らしく暮らすために大切なこと",
    title: "自分らしく暮らすために大切なこと",
    openingQuestion:
      "これからも自分らしく暮らすために、大切にしたいことは何ですか。",
    opening_prompt:
      "これからも自分らしく暮らすために、大切にしたいことは何ですか。",
    aspects: [
      { id: "self_determination", label: "自分で決めたいこと", priority: "core" },
      { id: "privacy", label: "プライバシー", priority: "optional" },
      { id: "respect", label: "尊重してほしいこと", priority: "core" },
      { id: "connection", label: "人とのつながり", priority: "optional" },
      { id: "comfort", label: "心身の快適さ", priority: "optional" },
      { id: "purpose_or_role", label: "生きがいや役割", priority: "core" },
      { id: "lifestyle", label: "自分らしい生活様式", priority: "core" },
    ],
    coreSlots: ["自分で決めたいこと", "尊重してほしいこと", "生きがいや役割", "自分らしい生活様式"],
    optionalSlots: ["プライバシー", "人とのつながり", "心身の快適さ"],
    crossTopicSlots: ["価値観", "生活環境", "支援"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "care_support",
    level: 3,
    slot_name: "手助けが必要になったときの希望",
    title: "手助けが必要になったときの希望",
    openingQuestion:
      "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか。",
    opening_prompt:
      "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか。",
    aspects: [
      { id: "acceptable_support", label: "受け入れられる支援", priority: "core" },
      { id: "unacceptable_support", label: "受け入れにくい支援", priority: "core" },
      { id: "support_person", label: "誰に頼みたいか", priority: "optional" },
      { id: "timing", label: "いつ頃から支援してほしいか", priority: "optional" },
      { id: "decision_process", label: "支援内容をどう決めたいか", priority: "cross_topic" },
      { id: "self_scope", label: "自分で続けたい範囲", priority: "core" },
      { id: "anxiety", label: "支援への不安", priority: "cross_topic" },
    ],
    coreSlots: ["受け入れられる支援", "受け入れにくい支援", "自分で続けたい範囲"],
    optionalSlots: ["誰に頼みたいか", "いつ頃から支援してほしいか"],
    crossTopicSlots: ["支援内容をどう決めたいか", "支援への不安"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "family_communication",
    level: 3,
    slot_name: "家族に伝えておきたいこと",
    title: "家族に伝えておきたいこと",
    openingQuestion:
      "将来の暮らしや支援について、家族に伝えておきたいことはありますか。",
    opening_prompt:
      "将来の暮らしや支援について、家族に伝えておきたいことはありますか。",
    aspects: [
      { id: "request", label: "家族にお願いしたいこと", priority: "core" },
      { id: "burden_concern", label: "家族への負担の懸念", priority: "core" },
      { id: "feelings", label: "家族への気持ち", priority: "core" },
      { id: "expected_judgement", label: "家族に期待する判断", priority: "optional" },
      { id: "avoidance", label: "家族にしてほしくないこと", priority: "optional" },
      { id: "non_family_support", label: "家族以外に頼れる人", priority: "optional" },
      { id: "unspoken", label: "まだ話せていないこと", priority: "cross_topic" },
    ],
    coreSlots: ["家族にお願いしたいこと", "家族への負担の懸念", "家族への気持ち"],
    optionalSlots: ["家族に期待する判断", "家族にしてほしくないこと", "家族以外に頼れる人"],
    crossTopicSlots: ["まだ話せていないこと"],
    maxFollowUpQuestions: 1,
  },
  {
    id: "proxy_decision_support",
    level: 4,
    slot_name: "自分で決められないときに相談してほしい人",
    title: "自分で決められないときに相談してほしい人",
    openingQuestion:
      "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか。",
    opening_prompt:
      "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか。",
    aspects: [
      { id: "trusted_person", label: "信頼できる人", priority: "core" },
      { id: "trust_reason", label: "信頼する理由", priority: "core" },
      { id: "values_to_share", label: "その人に知っておいてほしい価値観", priority: "core" },
      { id: "involvement", label: "どのように関わってほしいか", priority: "optional" },
      { id: "multiple_people", label: "複数人で相談してほしいか", priority: "optional" },
      { id: "not_decided", label: "特定の人を決めていない", priority: "cross_topic" },
      { id: "hard_to_decide", label: "決めにくい理由", priority: "cross_topic" },
    ],
    coreSlots: ["信頼できる人", "信頼する理由", "その人に知っておいてほしい価値観"],
    optionalSlots: ["どのように関わってほしいか", "複数人で相談してほしいか"],
    crossTopicSlots: ["特定の人を決めていない", "決めにくい理由"],
    maxFollowUpQuestions: 1,
  },
] as const;

export const RESEARCH_THEMES = [
  {
    id: "current_life_values",
    level: 1,
    title: "今の生活で大切にしていること",
    openingQuestion:
      "今の暮らしの中で、大切にしていることや楽しみにしていることはありますか。",
    sourceSlotNames: ["今の生活で大切にしていること"],
    aspects: [
      { id: "valued_routine", label: "大切にしている日課", priority: "core" },
      { id: "hobby_or_joy", label: "趣味や楽しみ", priority: "core" },
      { id: "relationships", label: "大切な人間関係", priority: "optional" },
      { id: "role", label: "家族や地域での役割", priority: "optional" },
      { id: "attachment", label: "自宅や地域への愛着", priority: "optional" },
      { id: "reason", label: "なぜ大切なのか", priority: "core" },
    ],
    maxFollowUpQuestions: 1,
  },
  {
    id: "future_life_continuity",
    level: 2,
    title: "これからも続けたいこと",
    openingQuestion:
      "これから先も、できるだけ続けていきたいことはありますか。",
    sourceSlotNames: ["これからも続けたいこと"],
    aspects: [
      { id: "continued_activity", label: "続けたい活動", priority: "core" },
      { id: "continued_relationship", label: "続けたい人間関係", priority: "optional" },
      { id: "self_continuation", label: "自分で続けたいこと", priority: "core" },
      { id: "preferred_environment", label: "維持したい生活環境", priority: "optional" },
      { id: "acceptable_change", label: "変わっても受け入れられること", priority: "optional" },
      { id: "not_want_to_lose", label: "失いたくないこと", priority: "core" },
      { id: "reason", label: "続けたい理由", priority: "core" },
    ],
    maxFollowUpQuestions: 1,
  },
  {
    id: "selfhood",
    level: 2,
    title: "自分らしく暮らすために大切なこと",
    openingQuestion:
      "これからも自分らしく暮らすために、大切にしたいことは何ですか。",
    sourceSlotNames: ["自分らしく暮らすために大切なこと"],
    aspects: [
      { id: "self_determination", label: "自分で決めたいこと", priority: "core" },
      { id: "privacy", label: "プライバシー", priority: "optional" },
      { id: "respect", label: "尊重してほしいこと", priority: "core" },
      { id: "connection", label: "人とのつながり", priority: "optional" },
      { id: "comfort", label: "心身の快適さ", priority: "optional" },
      { id: "purpose_or_role", label: "生きがいや役割", priority: "core" },
      { id: "lifestyle", label: "自分らしい生活様式", priority: "core" },
    ],
    maxFollowUpQuestions: 1,
  },
  {
    id: "care_support",
    level: 3,
    title: "手助けが必要になったときの希望",
    openingQuestion:
      "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか。",
    sourceSlotNames: ["手助けが必要になったときの希望"],
    aspects: [
      { id: "acceptable_support", label: "受け入れられる支援", priority: "core" },
      { id: "unacceptable_support", label: "受け入れにくい支援", priority: "core" },
      { id: "support_person", label: "誰に頼みたいか", priority: "optional" },
      { id: "timing", label: "いつ頃から支援してほしいか", priority: "optional" },
      { id: "decision_process", label: "支援内容をどう決めたいか", priority: "cross_topic" },
      { id: "self_scope", label: "自分で続けたい範囲", priority: "core" },
      { id: "anxiety", label: "支援への不安", priority: "cross_topic" },
    ],
    maxFollowUpQuestions: 1,
  },
  {
    id: "family_communication",
    level: 3,
    title: "家族に伝えておきたいこと",
    openingQuestion:
      "将来の暮らしや支援について、家族に伝えておきたいことはありますか。",
    sourceSlotNames: ["家族に伝えておきたいこと"],
    aspects: [
      { id: "request", label: "家族にお願いしたいこと", priority: "core" },
      { id: "burden_concern", label: "家族への負担の懸念", priority: "core" },
      { id: "feelings", label: "家族への気持ち", priority: "core" },
      { id: "expected_judgement", label: "家族に期待する判断", priority: "optional" },
      { id: "avoidance", label: "家族にしてほしくないこと", priority: "optional" },
      { id: "non_family_support", label: "家族以外に頼れる人", priority: "optional" },
      { id: "unspoken", label: "まだ話せていないこと", priority: "cross_topic" },
    ],
    maxFollowUpQuestions: 1,
  },
  {
    id: "proxy_decision_support",
    level: 4,
    title: "自分で決められないときに相談してほしい人",
    openingQuestion:
      "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか。",
    sourceSlotNames: ["自分で決められないときに相談してほしい人"],
    aspects: [
      { id: "trusted_person", label: "信頼できる人", priority: "core" },
      { id: "trust_reason", label: "信頼する理由", priority: "core" },
      { id: "values_to_share", label: "その人に知っておいてほしい価値観", priority: "core" },
      { id: "involvement", label: "どのように関わってほしいか", priority: "optional" },
      { id: "multiple_people", label: "複数人で相談してほしいか", priority: "optional" },
      { id: "not_decided", label: "特定の人を決めていない", priority: "cross_topic" },
      { id: "hard_to_decide", label: "決めにくい理由", priority: "cross_topic" },
    ],
    maxFollowUpQuestions: 1,
  },
] as const;

export const OPTIONAL_RESEARCH_THEMES = [
  {
    id: "changed_health_comfort",
    level: 4,
    title: "体調が大きく変わったときの安心できる過ごし方",
    openingQuestion:
      "もし体調が大きく変わったとき、どこで、誰と、どのように過ごせると安心だと思いますか。",
    sourceSlotNames: [],
    aspects: [
      { id: "place", label: "過ごしたい場所", priority: "core" },
      { id: "person", label: "一緒にいてほしい人", priority: "core" },
      { id: "environment", label: "望む環境や雰囲気", priority: "core" },
      { id: "comfort", label: "安心や苦痛軽減など大切なこと", priority: "core" },
      { id: "avoid_state", label: "避けたい状態", priority: "optional" },
      { id: "not_ready", label: "まだ考えられないこと", priority: "cross_topic" },
      { id: "conditional", label: "状況によって変わる条件", priority: "cross_topic" },
    ],
    maxFollowUpQuestions: 1,
  },
] as const;

export const ALL_RESEARCH_THEMES = [
  ...RESEARCH_THEMES,
  ...OPTIONAL_RESEARCH_THEMES,
] as const;

const LEGACY_SLOT_THEME_MAP: Record<string, (typeof ACP_SLOT_NAMES)[number]> = {
  価値観: "今の生活で大切にしていること",
  今後の生活希望: "これからも続けたいこと",
  介護希望: "手助けが必要になったときの希望",
  医療処置への希望: "これからも続けたいこと",
  延命治療への考え: "自分で決められないときに相談してほしい人",
  最期を迎えたい場所: "これからも続けたいこと",
  代理意思決定者: "自分で決められないときに相談してほしい人",
  家族に伝えたいこと: "家族に伝えておきたいこと",
  "不安・心配": "手助けが必要になったときの希望",
};

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
    themes?: ThemeMinutesItem[];
    optional_themes?: ThemeMinutesItem[];
    theme_metrics?: ThemeCompletenessMetrics;
    auxiliary_items?: AuxiliaryMinutesItem[];
    summary: string;
  };
};

export type ThemeMinutesItem = {
  theme_id: string;
  title: string;
  level: ThemeLevel;
  response_state: ResponseState;
  summary: string;
  evidence_utterance: string;
  aspects: AspectMinutesItem[];
};

export type AspectMinutesItem = {
  aspect_id: string;
  label: string;
  priority: AspectPriority;
  status: AspectStatus;
  evidence: EvidenceReference[];
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
    const slotName = normalizeSlotName(slot.slot_name);
    const currentSlot = byName.get(slotName);
    byName.set(slotName, mergeSingleSlotState(currentSlot, {
      slot_name: slotName,
      status: normalizeSlotStatus(slot.status),
      summary: String(slot.summary || "未確認"),
      evidence_utterance: String(slot.evidence_utterance || ""),
      updated_at: slot.updated_at,
    }));
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

export function normalizeSlotName(value: unknown): AcpSlotName {
  const text = typeof value === "string" ? value.trim() : "";

  if (ACP_SLOT_NAMES.includes(text as AcpSlotName)) return text as AcpSlotName;
  return LEGACY_SLOT_THEME_MAP[text] ?? ACP_SLOT_NAMES[0];
}

function mergeSingleSlotState(
  current: AcpSlotState | undefined,
  update: AcpSlotState,
): AcpSlotState {
  if (!current || current.status === "unanswered" || current.status === "not_asked") {
    return update;
  }

  if (update.status === "unanswered" || update.status === "not_asked") {
    return current;
  }

  return {
    ...update,
    status: getStrongerSlotStatus(current.status, update.status),
    summary: joinUniqueText(current.summary, update.summary, "未確認"),
    evidence_utterance: joinUniqueText(
      current.evidence_utterance,
      update.evidence_utterance,
      "",
    ),
  };
}

function getStrongerSlotStatus(
  current: SlotStatus,
  update: SlotStatus,
): SlotStatus {
  const score: Record<SlotStatus, number> = {
    unanswered: 0,
    not_asked: 0,
    partial: 1,
    not_considered: 2,
    cannot_verbalize: 2,
    no_preference: 2,
    prefer_not_to_answer: 2,
    answered: 3,
  };

  return score[update] >= score[current] ? update : current;
}

function joinUniqueText(left: string, right: string, emptyText: string) {
  const values = [left, right]
    .map((value) => value.trim())
    .filter((value) => value && value !== emptyText);

  return [...new Set(values)].join("\n") || emptyText;
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

export function getResearchThemeAspects(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
) {
  return theme.aspects;
}

export function getCoreResearchThemeAspects(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
) {
  return theme.aspects.filter((aspect) => aspect.priority === "core");
}

export function getOptionalResearchThemeAspects(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
) {
  return theme.aspects.filter((aspect) => aspect.priority === "optional");
}

export function getCrossTopicResearchThemeAspects(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
) {
  return theme.aspects.filter((aspect) => aspect.priority === "cross_topic");
}

export function resolveResearchThemeForSlot(slotName: string | undefined) {
  return (
    ALL_RESEARCH_THEMES.find((theme) =>
      theme.sourceSlotNames.some((sourceSlotName) => sourceSlotName === slotName),
    ) ?? RESEARCH_THEMES[0]
  );
}

export function getResearchThemeSourceSlots(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  slots: AcpSlotState[],
) {
  return slots.filter((slot) =>
    theme.sourceSlotNames.some((sourceSlotName) => sourceSlotName === slot.slot_name),
  );
}

export function getResearchThemeResponseState(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  slots: AcpSlotState[],
): ResponseState {
  const states = getResearchThemeSourceSlots(theme, slots)
    .map((slot) => getSlotResponseState(slot))
    .filter((state): state is Exclude<ResponseState, null> => state !== null);

  return (
    states.find((state) => state === "expressed") ??
    states.find((state) => state === "no_preference") ??
    states.find((state) => state === "not_considered") ??
    states.find((state) => state === "difficulty_verbalizing") ??
    states.find((state) => state === "declined") ??
    states[0] ??
    null
  );
}

export function getResearchThemeEvidence(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  slots: AcpSlotState[],
) {
  return getResearchThemeSourceSlots(theme, slots)
    .map((slot) => slot.evidence_utterance.trim())
    .filter(Boolean)
    .join("\n");
}

export function getResearchThemeSummary(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  slots: AcpSlotState[],
) {
  return getResearchThemeSourceSlots(theme, slots)
    .map((slot) => slot.summary.trim())
    .filter((summary) => summary && summary !== "未確認")
    .join("\n");
}

export function calculateThemeCompletenessMetrics(
  slots: AcpSlotState[],
): ThemeCompletenessMetrics {
  const themeCount = RESEARCH_THEMES.length;
  const reachedThemes = RESEARCH_THEMES.filter((theme) => {
    return getResearchThemeSourceSlots(theme, slots).some(
      (slot) => slot.status !== "unanswered" && slot.status !== "not_asked",
    );
  });
  const responseStateThemes = RESEARCH_THEMES.filter((theme) =>
    Boolean(getResearchThemeResponseState(theme, slots)),
  );
  const valueExpressionThemes = RESEARCH_THEMES.filter(
    (theme) => getResearchThemeResponseState(theme, slots) === "expressed",
  );
  const evidenceThemes = RESEARCH_THEMES.filter((theme) =>
    Boolean(getResearchThemeEvidence(theme, slots)),
  );

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
  const themes = buildThemeMinutesItems(RESEARCH_THEMES, acpSlots);
  const optionalThemes = buildThemeMinutesItems(OPTIONAL_RESEARCH_THEMES, acpSlots);
  const themeMetrics = calculateThemeCompletenessMetrics(acpSlots);
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
    "## Theme / Aspect / Evidence",
    "",
  ];

  themes.forEach((theme) => {
    lines.push(`### ${theme.title}`);
    lines.push(`- level: ${theme.level}`);
    lines.push(`- response_state: ${theme.response_state ?? "未確認"}`);
    lines.push(`- summary: ${theme.summary}`);
    lines.push(`- evidence_utterance: ${theme.evidence_utterance || "なし"}`);
    lines.push("");
    lines.push("#### Aspects");
    theme.aspects.forEach((aspect) => {
      const evidenceText =
        aspect.evidence.length > 0
          ? aspect.evidence.map((evidence) => evidence.evidenceText).join(" / ")
          : "なし";
      lines.push(
        `- ${aspect.label}: ${aspect.status} / evidence: ${evidenceText}`,
      );
    });
    lines.push("");
  });

  lines.push("## 任意Theme");
  lines.push("");
  optionalThemes.forEach((theme) => {
    lines.push(`### ${theme.title}`);
    lines.push(`- response_state: ${theme.response_state ?? "未確認"}`);
    lines.push(`- summary: ${theme.summary}`);
    lines.push(`- evidence_utterance: ${theme.evidence_utterance || "なし"}`);
    lines.push("");
  });

  lines.push("## 網羅性指標");
  lines.push("");
  lines.push(`- themeReachRate: ${themeMetrics.themeReachRate}`);
  lines.push(`- responseStateCoverage: ${themeMetrics.responseStateCoverage}`);
  lines.push(`- valueExpressionRate: ${themeMetrics.valueExpressionRate}`);
  lines.push(`- evidenceCoverage: ${themeMetrics.evidenceCoverage}`);
  lines.push("");

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
      themes,
      optional_themes: optionalThemes,
      theme_metrics: themeMetrics,
      auxiliary_items: auxiliaryItems,
      summary: "会話ログとTheme単位のACPスロット状態から生成した議事録です。",
    },
  };
}

function buildThemeMinutesItems(
  themes: readonly (typeof ALL_RESEARCH_THEMES)[number][],
  slots: AcpSlotState[],
): ThemeMinutesItem[] {
  return themes.map((theme) => {
    const responseState = getResearchThemeResponseState(theme, slots);
    const summary = getResearchThemeSummary(theme, slots) || "未確認";
    const evidence = getResearchThemeEvidence(theme, slots);

    return {
      theme_id: theme.id,
      title: theme.title,
      level: theme.level,
      response_state: responseState,
      summary,
      evidence_utterance: evidence,
      aspects: theme.aspects.map((aspect) => {
        const aspectEvidence = buildAspectEvidence(theme, aspect, slots);
        const status: AspectStatus =
          aspectEvidence.length > 0 ? "partial" : "empty";

        return {
          aspect_id: aspect.id,
          label: aspect.label,
          priority: aspect.priority,
          status,
          evidence: aspectEvidence,
        };
      }),
    };
  });
}

function buildAspectEvidence(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  aspect: (typeof ALL_RESEARCH_THEMES)[number]["aspects"][number],
  slots: AcpSlotState[],
): EvidenceReference[] {
  return getResearchThemeSourceSlots(theme, slots)
    .filter((slot) => {
      const text = `${slot.summary} ${slot.evidence_utterance}`;
      return Boolean(slot.evidence_utterance.trim()) && aspectMatchesText(aspect.label, text);
    })
    .map((slot) => ({
      themeId: theme.id,
      aspectId: aspect.id,
      evidenceText: slot.evidence_utterance,
      speaker: slot.evidence_utterance.startsWith("本人:") ? "elder" : undefined,
      sourceTopicId: String(slot.slot_name),
      inferred: !theme.sourceSlotNames.some(
        (sourceSlotName) => sourceSlotName === slot.slot_name,
      ),
    }));
}

function aspectMatchesText(label: string, text: string) {
  const keywords = label
    .split(/[、・\s]+/)
    .map((keyword) => keyword.replace(/こと|もの|どのように|どこで|誰に/g, ""))
    .filter((keyword) => keyword.length >= 2);

  return keywords.some((keyword) => text.includes(keyword));
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

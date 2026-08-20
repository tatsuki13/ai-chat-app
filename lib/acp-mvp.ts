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
      { id: "cross_connection", label: "人とのつながり", priority: "cross_topic" },
      { id: "cross_living_environment", label: "生活環境", priority: "cross_topic" },
      { id: "cross_selfhood", label: "自分らしさ", priority: "cross_topic" },
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
      { id: "cross_selfhood", label: "自分らしさ", priority: "cross_topic" },
      { id: "cross_support", label: "支援", priority: "cross_topic" },
      { id: "cross_secure_living", label: "安心できる過ごし方", priority: "cross_topic" },
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
      { id: "cross_values", label: "価値観", priority: "cross_topic" },
      { id: "cross_living_environment", label: "生活環境", priority: "cross_topic" },
      { id: "cross_support", label: "支援", priority: "cross_topic" },
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
      { id: "cross_connection", label: "人とのつながり", priority: "cross_topic" },
      { id: "cross_living_environment", label: "生活環境", priority: "cross_topic" },
      { id: "cross_selfhood", label: "自分らしさ", priority: "cross_topic" },
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
      { id: "cross_selfhood", label: "自分らしさ", priority: "cross_topic" },
      { id: "cross_support", label: "支援", priority: "cross_topic" },
      { id: "cross_secure_living", label: "安心できる過ごし方", priority: "cross_topic" },
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
      { id: "cross_values", label: "価値観", priority: "cross_topic" },
      { id: "cross_living_environment", label: "生活環境", priority: "cross_topic" },
      { id: "cross_support", label: "支援", priority: "cross_topic" },
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
export type SubSlotDefinition = {
  id: string;
  mainSlotId: string;
  label: string;
  description: string;
  completeCriteria: string;
  partialCriteria: string;
  exclusionCriteria?: string;
  completionRule: SubSlotCompletionRule;
};
export type SlotCompletion = "none" | "partial" | "complete";
export type AnswerDepth = "none" | "minimal" | "elaborated";
export type SubSlotCompletionField =
  | "specificContentPresent"
  | "reasonPresent"
  | "conditionPresent"
  | "examplePresent";
export type SubSlotCompletionRule = {
  completeWhen: SubSlotCompletionField[];
  elaboratedWhenAny?: Extract<
    SubSlotCompletionField,
    "reasonPresent" | "conditionPresent" | "examplePresent"
  >[];
};
export type SlotClassificationResponseState =
  | "answered"
  | "no_response"
  | "explicit_none"
  | "not_considered"
  | "unable_to_verbalize"
  | "declined"
  | "ambiguous"
  | "conflicting";
export type SlotReasonCode =
  | "not_discussed"
  | "time_limit"
  | "topic_changed"
  | "explicit_none"
  | "not_considered"
  | "unable_to_verbalize"
  | "declined"
  | "insufficient_detail"
  | "ambiguous"
  | "conflicting";
export type StoredSubSlotState = {
  mainSlotId: string;
  subSlotId: string;
  completion: SlotCompletion;
  responseState: SlotClassificationResponseState;
  reasonCode: SlotReasonCode | null;
  evidenceUtteranceIds: string[];
  canAskAgain: boolean;
  isDeferred: boolean;
  depth?: AnswerDepth;
  needsOptionalFollowUp?: boolean;
  hasConflict?: boolean;
  lastUpdatedTopicId: string | null;
  updatedAt: string;
};
export type SlotResolution = {
  hasContent: boolean;
  hasResponse: boolean;
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
export type ScopedSlotStatus =
  | "unanswered"
  | "partially_answered"
  | "answered"
  | "not_applicable"
  | "declined"
  | "unable_to_verbalize"
  | "needs_follow_up"
  | "deferred";
export type UnansweredReason =
  | "not_discussed"
  | "time_limit"
  | "topic_changed"
  | "not_considered"
  | "insufficient_detail"
  | "ambiguous"
  | "conflicting"
  | "declined"
  | "unable_to_verbalize"
  | "needs_follow_up";
export type DeferredSlotItem = {
  mainSlotId: string;
  mainSlotLabel: string;
  subSlotId?: string;
  subSlotLabel?: string;
  sourceTopicId: string;
  reason: UnansweredReason;
  priority: number;
  canAskAgain: boolean;
  suggestedTiming: "related_topic" | "after_current_topic" | "before_session_end";
};
export type SubSlotControlState = {
  id: string;
  label: string;
  priority: AspectPriority;
  status: ScopedSlotStatus;
  completion?: SlotCompletion;
  responseState?: SlotClassificationResponseState;
  reasonCode?: SlotReasonCode | null;
  depth?: AnswerDepth;
  evidenceUtteranceCount?: number;
  value?: string;
  unansweredReason?: UnansweredReason;
  lastUpdatedAt?: string;
  lastUpdatedTopicId?: string;
  inDeferredQueue: boolean;
  canAskAgain: boolean;
};
export type SubSlotControlOverride = {
  topicId: string;
  subSlotId: string;
  status: ScopedSlotStatus;
  value?: string;
  unansweredReason?: UnansweredReason;
  lastUpdatedAt?: string;
  lastUpdatedTopicId?: string;
};
export type MainSlotControlState = {
  id: string;
  label: string;
  topicId: string;
  status: ScopedSlotStatus;
  isCurrentTopic: boolean;
  inDeferredQueue: boolean;
  canAskAgain: boolean;
  unansweredReason?: UnansweredReason;
  lastUpdatedAt?: string;
  lastUpdatedTopicId?: string;
  subSlots: SubSlotControlState[];
};
export type SlotControlDebugState = {
  currentTopicId: string;
  currentMainSlot: string;
  referencedSubSlots: string[];
  selectionReason: string;
  deferredSlotQueue: DeferredSlotItem[];
  beforeSessionEndTargets: DeferredSlotItem[];
  allSlotReferenceUsed: boolean;
  mainSlots: MainSlotControlState[];
  classificationDebug?: SlotClassificationDebugSummary;
};

export type SlotClassificationDebugSummary = {
  source?: "openai" | "fallback" | "error";
  llmSucceeded?: boolean;
  candidateCount?: number;
  llmCandidateCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  rejectionReasons?: Record<string, number>;
  unmatchedUtteranceCount?: number;
  derivedStateCount?: number;
  transitionBlockedCount?: number;
};
type SlotControlInputSlot = {
  slot_name: string;
  status: unknown;
  summary: string;
  evidence_utterance: string;
  updated_at?: string;
};
export type Speaker = "caregiver" | "elder";
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

export const SLOT_COMPLETIONS = ["none", "partial", "complete"] as const;
export const ANSWER_DEPTHS = ["none", "minimal", "elaborated"] as const;
export const SLOT_CLASSIFICATION_RESPONSE_STATES = [
  "answered",
  "no_response",
  "explicit_none",
  "not_considered",
  "unable_to_verbalize",
  "declined",
  "ambiguous",
  "conflicting",
] as const;
export const SLOT_REASON_CODES = [
  "not_discussed",
  "time_limit",
  "topic_changed",
  "explicit_none",
  "not_considered",
  "unable_to_verbalize",
  "declined",
  "insufficient_detail",
  "ambiguous",
  "conflicting",
] as const;

export type NextQuestionResult = {
  question: string | null;
  transition_phrase: string;
  target_slot: AcpSlotName | string;
  targetMainSlotId?: string;
  targetSubSlotId?: string;
  reason: string;
  sensitivity: Sensitivity;
  no_relevant_followup?: boolean;
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
    acp_minutes?: ACPMinutes;
    acp_minutes_llm_input?: ACPMinutesLLMInput;
    acp_minutes_llm_meta?: {
      source: "openai" | "fallback" | "error";
      llmSucceeded: boolean;
      failureReason?: string;
      errorMessage?: string;
      rawResponse?: string;
      narrativeGenerationStatus?: string;
      fallbackUsed?: boolean;
    };
    acp_minutes_narrative_debug?: {
      status: string;
      llmAttempted: boolean;
      llmSucceeded: boolean;
      rawResponseAvailable: boolean;
      parseSucceeded: boolean;
      schemaSucceeded: boolean;
      fallbackUsed: boolean;
      failureReason?: string;
      errorMessage?: string;
      rawResponse?: string;
      themes: Array<{
        themeId: string;
        inputEvidenceCount: number;
        inputEvidenceIds: string[];
        generatedCurrentThought: boolean;
        generatedBackground: boolean;
        generatedConditions: boolean;
        generatedUncertainties: boolean;
        generatedTensions: boolean;
        generatedConfirmationNeeded: boolean;
      }>;
    };
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
  completion?: SlotCompletion;
  responseState?: SlotClassificationResponseState;
  reasonCode?: SlotReasonCode | null;
  canAskAgain?: boolean;
  isDeferred?: boolean;
  evidence: EvidenceReference[];
};

export type ACPAspectCertainty = "明確" | "条件付き" | "迷いあり" | "不明";
export type ACPAspectSpeaker = "本人" | "家族" | "その他";

export type ACPAspectEvidence = {
  value: string;
  evidence?: string;
  speaker?: ACPAspectSpeaker;
  certainty?: ACPAspectCertainty;
  condition?: string | null;
  negation?: boolean;
  sourceUtteranceId?: string;
  sourceTopicId?: string;
};

export type ACPGeneratedSummary = {
  text: string;
  source_aspects: string[];
  source_utterance_ids: string[];
};

export type ACPGeneratedConnection = {
  text: string;
  source_aspects: string[];
  related_themes: string[];
  source_utterance_ids: string[];
};

export type GroundedMinutesText = {
  text: string;
  sourceUtteranceIds: string[];
  sourceAspectIds?: string[];
};

export type ACPThemeNarrative = {
  currentThought?: GroundedMinutesText | null;
  background?: GroundedMinutesText | null;
  conditions?: GroundedMinutesText[];
  uncertainties?: GroundedMinutesText[];
  tensions?: GroundedMinutesText[];
  confirmationNeeded?: GroundedMinutesText[];
};

export type ACPMinutes = {
  title: string;
  recordType: "acp_discussion_record";
  themes: {
    current_life_values: {
      title: string;
      life_supports: string[];
      reason: string | null;
      background: {
        relationships: string[];
        role: string[];
        attachment: string[];
      };
    };
    future_life_continuity: {
      title: string;
      continued_activity: string[];
      self_continuation: string[];
      not_want_to_lose: string[];
      reason: string | null;
      acceptable_change: string[];
      important_for_continuation: string[];
    };
    selfhood: {
      title: string;
      self_determination: string[];
      respect: string[];
      purpose_or_role: string[];
      lifestyle: string[];
      other_important_things: {
        privacy: string[];
        connection: string[];
        comfort: string[];
      };
    };
    care_support: {
      title: string;
      acceptable_support: string[];
      unacceptable_support: string[];
      self_scope: string[];
      support_person: string[];
      support_decision: string[];
      anxiety: string[];
      support_condition: string[];
    };
    family_communication: {
      title: string;
      request: string[];
      burden_concern: string[];
      feelings: string[];
      expected_judgement: string[];
      avoidance: string[];
      non_family_support: string[];
      unspoken: string[];
    };
    proxy_decision_support: {
      title: string;
      trusted_person: string[];
      trust_reason: string[];
      values_to_share: string[];
      involvement: string[];
      multiple_people: string[];
      not_decided: boolean;
      hard_to_decide: string[];
    };
  };
  overall_summary: {
    core_values: ACPGeneratedSummary[];
    cross_theme_connections: ACPGeneratedConnection[];
    undecided_things: string[];
  };
  narratives?: Partial<Record<keyof ACPMinutes["themes"], ACPThemeNarrative>>;
  narrative_debug?: {
    validation?: Array<{
      themeId: string;
      field: string;
      text: string;
      sourceUtteranceIds: string[];
      sourceUtterances?: Array<{
        id: string;
        text: string;
        speaker?: ACPAspectSpeaker;
      }>;
      accepted: boolean;
      reason?: string;
    }>;
  };
};

export type ACPMinutesLLMInput = {
  title: string;
  recordType: "acp_discussion_record_input";
  themes: Array<{
    theme_id: keyof ACPMinutes["themes"];
    title: string;
    response_state?: ResponseState;
    aspects: Array<{
      aspect_id: string;
      label: string;
      priority: AspectPriority;
      status: AspectStatus;
      completion?: SlotCompletion;
      responseState?: SlotClassificationResponseState;
      reasonCode?: SlotReasonCode | null;
      canAskAgain?: boolean;
      isDeferred?: boolean;
      evidence: ACPAspectEvidence[];
    }>;
  }>;
};

export type AuxiliaryMinutesItem = {
  item_name: string;
  summary: string;
  evidence_utterance: string;
};

export const SPEAKER_LABELS: Record<string, string> = {
  caregiver: "介護者",
  elder: "本人",
};

export function normalizeConversationSpeaker(value: string): Speaker {
  if (value === "B" || value === "caregiver") return "caregiver";
  return "elder";
}

export function isElderSpeaker(value: string) {
  return normalizeConversationSpeaker(value) === "elder";
}

export function isCaregiverSpeaker(value: string) {
  return normalizeConversationSpeaker(value) === "caregiver";
}

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
    if (!slotName) return;
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

export function normalizeSlotName(value: unknown): AcpSlotName | null {
  const text = typeof value === "string" ? value.trim() : "";

  if (ACP_SLOT_NAMES.includes(text as AcpSlotName)) return text as AcpSlotName;
  return LEGACY_SLOT_THEME_MAP[text] ?? null;
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

export function getSubSlotDefinitions(): SubSlotDefinition[] {
  return DISCUSSION_TOPICS.flatMap((topic) =>
    topic.aspects.map((aspect) => ({
      id: aspect.id,
      mainSlotId: topic.id,
      label: aspect.label,
      completionRule: getSubSlotCompletionRule(aspect.id),
      description: `「${topic.title}」の中で、${aspect.label}について本人の考え・希望・保留・拒否が話されているかを確認する。`,
      completeCriteria:
        aspect.priority === "core"
          ? `${aspect.label}について、本人の希望・価値観・理由・条件のいずれかが根拠発話から明確に読み取れる。`
          : `${aspect.label}について、本人の考えまたは明確な該当なしが根拠発話から読み取れる。`,
      partialCriteria:
        `${aspect.label}に関連する発話はあるが、本人の希望・理由・条件としては曖昧、または追加確認が必要である。`,
      exclusionCriteria:
        "発話に含まれない内容、介護者だけの推測、本人同意のない代弁、別サブスロットの内容は含めない。",
    })),
  );
}

export function resolveSubSlotDefinition(
  mainSlotId: string,
  subSlotId: string,
) {
  return getSubSlotDefinitions().find(
    (definition) =>
      definition.mainSlotId === mainSlotId && definition.id === subSlotId,
  );
}

function getSubSlotCompletionRule(subSlotId: string): SubSlotCompletionRule {
  if (/reason|why|trust/.test(subSlotId)) {
    return { completeWhen: ["reasonPresent"] };
  }
  if (/condition|timing|acceptable_change|involvement/.test(subSlotId)) {
    return { completeWhen: ["conditionPresent"] };
  }
  if (/example/.test(subSlotId)) {
    return { completeWhen: ["examplePresent"] };
  }

  return {
    completeWhen: ["specificContentPresent"],
    elaboratedWhenAny: ["reasonPresent", "conditionPresent", "examplePresent"],
  };
}

export function getSubSlotDefinitionsForTopic(mainSlotId: string) {
  return getSubSlotDefinitions().filter(
    (definition) => definition.mainSlotId === mainSlotId,
  );
}

export function createEmptySubSlotStates(now = new Date().toISOString()) {
  return getSubSlotDefinitions().map((definition) => ({
    mainSlotId: definition.mainSlotId,
    subSlotId: definition.id,
    completion: "none" as SlotCompletion,
    responseState: "no_response" as SlotClassificationResponseState,
    reasonCode: "not_discussed" as SlotReasonCode,
    evidenceUtteranceIds: [],
    canAskAgain: true,
    isDeferred: true,
    depth: "none" as AnswerDepth,
    needsOptionalFollowUp: false,
    lastUpdatedTopicId: null,
    updatedAt: now,
  }));
}

export function isSlotCompletion(value: unknown): value is SlotCompletion {
  return SLOT_COMPLETIONS.includes(value as SlotCompletion);
}

export function isAnswerDepth(value: unknown): value is AnswerDepth {
  return ANSWER_DEPTHS.includes(value as AnswerDepth);
}

export function isSlotClassificationResponseState(
  value: unknown,
): value is SlotClassificationResponseState {
  return SLOT_CLASSIFICATION_RESPONSE_STATES.includes(
    value as SlotClassificationResponseState,
  );
}

export function isSlotReasonCode(value: unknown): value is SlotReasonCode {
  return SLOT_REASON_CODES.includes(value as SlotReasonCode);
}

export function getSlotResolution(input: {
  completion: SlotCompletion;
  responseState: SlotClassificationResponseState;
}): SlotResolution {
  if (input.responseState === "answered") {
    return {
      hasContent:
        input.completion === "partial" || input.completion === "complete",
      hasResponse: true,
    };
  }

  if (input.responseState === "no_response") {
    return { hasContent: false, hasResponse: false };
  }

  return { hasContent: false, hasResponse: true };
}

export function canAskAgainSubSlotState(
  state: Pick<
    StoredSubSlotState,
    "completion" | "responseState" | "reasonCode"
  >,
) {
  if (state.completion === "complete") return false;
  if (state.responseState === "explicit_none") return false;
  if (state.responseState === "declined") return false;
  if (state.responseState === "not_considered") return false;
  if (state.responseState === "unable_to_verbalize") return false;

  return (
    state.responseState === "no_response" ||
    state.responseState === "answered" ||
    state.responseState === "ambiguous" ||
    state.responseState === "conflicting" ||
    state.reasonCode === "insufficient_detail" ||
    state.reasonCode === "topic_changed" ||
    state.reasonCode === "time_limit"
  );
}

export function isDeferredSubSlotState(
  state: Pick<
    StoredSubSlotState,
    "completion" | "responseState" | "reasonCode"
  >,
) {
  if (!canAskAgainSubSlotState(state)) return false;

  return (
    state.completion === "none" ||
    state.completion === "partial" ||
    state.responseState === "ambiguous" ||
    state.responseState === "conflicting"
  );
}

export function canTransitionSubSlotState(
  current: StoredSubSlotState | undefined,
  next: Pick<
    StoredSubSlotState,
    "completion" | "responseState" | "evidenceUtteranceIds"
  >,
) {
  if (!current) return true;
  if (next.evidenceUtteranceIds.length === 0) return false;
  if (current.completion === "complete" && next.responseState === "no_response") {
    return false;
  }
  if (
    current.responseState !== "no_response" &&
    next.responseState === "no_response"
  ) {
    return false;
  }

  return true;
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

export function buildSlotControlDebugState(input: {
  slots: SlotControlInputSlot[];
  currentTopic?: string;
  includeBeforeSessionEnd?: boolean;
  subSlotOverrides?: SubSlotControlOverride[];
  subSlotStates?: StoredSubSlotState[];
  classificationDebug?: SlotClassificationDebugSummary;
}): SlotControlDebugState {
  const currentTopic = resolveDiscussionTopic(input.currentTopic);
  const overrideMap = new Map(
    (input.subSlotOverrides ?? []).map((override) => [
      `${override.topicId}:${override.subSlotId}`,
      override,
    ]),
  );
  const mainSlots = DISCUSSION_TOPICS.map((topic) =>
    buildMainSlotControlState(
      topic,
      input.slots,
      currentTopic.id,
      overrideMap,
      input.subSlotStates ?? [],
    ),
  );
  const deferredSlotQueue = mainSlots
    .flatMap((mainSlot) => buildDeferredItemsForMainSlot(mainSlot, currentTopic.id))
    .sort((left, right) => left.priority - right.priority);
  const referencedSubSlots = mainSlots
    .find((slot) => slot.topicId === currentTopic.id)
    ?.subSlots.filter((slot) => slot.canAskAgain)
    .map((slot) => slot.label) ?? [];

  return {
    currentTopicId: currentTopic.id,
    currentMainSlot: currentTopic.slot_name,
    referencedSubSlots,
    selectionReason:
      "質問候補生成は現在テーマのメインスロット、配下サブスロット、関連する保留項目だけを参照します。",
    deferredSlotQueue,
    beforeSessionEndTargets: input.includeBeforeSessionEnd
      ? deferredSlotQueue.filter((item) => item.suggestedTiming === "before_session_end")
      : [],
    allSlotReferenceUsed: false,
    mainSlots,
    classificationDebug: input.classificationDebug,
  };
}

export function getCurrentTopicQuestionScope(input: {
  slots: SlotControlInputSlot[];
  currentTopic?: string;
  subSlotStates?: StoredSubSlotState[];
}) {
  const debugState = buildSlotControlDebugState(input);
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);

  return {
    currentTopicId: debugState.currentTopicId,
    currentMainSlot: debugState.currentMainSlot,
    referencedSubSlots:
      currentMainSlot?.subSlots
        .filter((slot) => slot.canAskAgain)
        .map((slot) => ({
          id: slot.id,
          label: slot.label,
          status: slot.status,
          unansweredReason: slot.unansweredReason,
        })) ?? [],
    relatedDeferredItems: debugState.deferredSlotQueue.filter(
      (item) => item.suggestedTiming === "related_topic",
    ),
    allSlotReferenceUsed: false,
  };
}

function buildMainSlotControlState(
  topic: (typeof DISCUSSION_TOPICS)[number],
  slots: SlotControlInputSlot[],
  currentTopicId: string,
  overrideMap: Map<string, SubSlotControlOverride>,
  storedSubSlotStates: StoredSubSlotState[],
): MainSlotControlState {
  const slot = slots.find((item) => item.slot_name === topic.slot_name);
  const status = toScopedSlotStatus(slot?.status);
  const unansweredReason = getUnansweredReason(status);
  const value = slot ? joinUniqueText("", slot.summary, slot.evidence_utterance) : "";
  const subSlots = topic.aspects.map((aspect) => {
    const override = overrideMap.get(`${topic.id}:${aspect.id}`);
    const stored = storedSubSlotStates.find(
      (state) => state.mainSlotId === topic.id && state.subSlotId === aspect.id,
    );
    const aspectStatus =
      override?.status ?? getStoredSubSlotScopedStatus(stored) ??
      getAspectScopedStatus(aspect, status, value);
    const aspectReason = getUnansweredReason(aspectStatus);
    return {
      id: aspect.id,
      label: aspect.label,
      priority: aspect.priority,
      status: aspectStatus,
      completion: stored?.completion,
      responseState: stored?.responseState,
      reasonCode: stored?.reasonCode,
      depth: stored?.depth,
      evidenceUtteranceCount: stored?.evidenceUtteranceIds.length,
      value: override?.value ?? (aspectMatchesText(aspect.label, value) ? value : undefined),
      unansweredReason:
        override?.unansweredReason ??
        mapReasonCodeToUnansweredReason(stored?.reasonCode) ??
        aspectReason,
      lastUpdatedAt: override?.lastUpdatedAt ?? stored?.updatedAt ?? slot?.updated_at,
      lastUpdatedTopicId:
        override?.lastUpdatedTopicId ??
        stored?.lastUpdatedTopicId ??
        (slot?.updated_at ? topic.id : undefined),
      inDeferredQueue:
        aspect.priority === "core" &&
        (stored?.isDeferred ?? canDeferSlotStatus(aspectStatus)),
      canAskAgain:
        aspect.priority === "core" &&
        (stored?.canAskAgain ?? canAskAgainStatus(aspectStatus)),
    };
  });

  return {
    id: String(topic.slot_name),
    label: topic.title,
    topicId: topic.id,
    status,
    isCurrentTopic: topic.id === currentTopicId,
    inDeferredQueue: canDeferSlotStatus(status),
    canAskAgain: canAskAgainStatus(status),
    unansweredReason,
    lastUpdatedAt: slot?.updated_at,
    lastUpdatedTopicId: slot?.updated_at ? topic.id : undefined,
    subSlots,
  };
}

function buildDeferredItemsForMainSlot(
  mainSlot: MainSlotControlState,
  currentTopicId: string,
): DeferredSlotItem[] {
  const mainTopicIndex = DISCUSSION_TOPICS.findIndex((topic) => topic.id === mainSlot.topicId);
  const currentTopicIndex = DISCUSSION_TOPICS.findIndex((topic) => topic.id === currentTopicId);
  const isPastTopic = mainTopicIndex >= 0 && currentTopicIndex >= 0 && mainTopicIndex < currentTopicIndex;
  const timing = isPastTopic ? "after_current_topic" : "before_session_end";

  return mainSlot.subSlots
    .filter((subSlot) => subSlot.inDeferredQueue && subSlot.canAskAgain)
    .map((subSlot, index) => ({
      mainSlotId: mainSlot.topicId,
      mainSlotLabel: mainSlot.label,
      subSlotId: subSlot.id,
      subSlotLabel: subSlot.label,
      sourceTopicId: mainSlot.topicId,
      reason: subSlot.unansweredReason ?? "not_discussed",
      priority: mainSlot.isCurrentTopic ? index + 1 : index + 10,
      canAskAgain: subSlot.canAskAgain,
      suggestedTiming: mainSlot.isCurrentTopic ? "related_topic" : timing,
    }));
}

function toScopedSlotStatus(status: unknown): ScopedSlotStatus {
  switch (status) {
    case "answered":
    case "filled":
      return "answered";
    case "partial":
      return "partially_answered";
    case "no_preference":
      return "not_applicable";
    case "prefer_not_to_answer":
      return "declined";
    case "not_considered":
    case "cannot_verbalize":
      return "unable_to_verbalize";
    default:
      return "unanswered";
  }
}

function getStoredSubSlotScopedStatus(
  state: StoredSubSlotState | undefined,
): ScopedSlotStatus | undefined {
  if (!state) return undefined;

  if (state.completion === "complete") return "answered";
  if (state.responseState === "answered" && state.completion === "partial") {
    return "partially_answered";
  }
  if (state.responseState === "explicit_none") return "not_applicable";
  if (state.responseState === "declined") return "declined";
  if (state.responseState === "unable_to_verbalize") return "unable_to_verbalize";
  if (state.responseState === "not_considered") return "unable_to_verbalize";
  if (state.responseState === "ambiguous" || state.responseState === "conflicting") {
    return "needs_follow_up";
  }

  return "unanswered";
}

function mapReasonCodeToUnansweredReason(
  reasonCode: SlotReasonCode | null | undefined,
): UnansweredReason | undefined {
  switch (reasonCode) {
    case "not_discussed":
    case "time_limit":
    case "topic_changed":
    case "not_considered":
    case "insufficient_detail":
    case "ambiguous":
    case "conflicting":
    case "declined":
    case "unable_to_verbalize":
      return reasonCode;
    default:
      return undefined;
  }
}

function getAspectScopedStatus(
  aspect: AspectDefinition,
  mainStatus: ScopedSlotStatus,
  text: string,
): ScopedSlotStatus {
  if (mainStatus === "declined" || mainStatus === "not_applicable") return mainStatus;
  if (mainStatus === "unable_to_verbalize") return "unable_to_verbalize";
  if (!text.trim()) return "unanswered";
  if (aspectMatchesText(aspect.label, text)) {
    return mainStatus === "answered" ? "answered" : "partially_answered";
  }
  return mainStatus === "answered" && aspect.priority === "optional"
    ? "not_applicable"
    : "unanswered";
}

function getUnansweredReason(status: ScopedSlotStatus): UnansweredReason | undefined {
  if (status === "unanswered") return "not_discussed";
  if (status === "partially_answered" || status === "needs_follow_up") {
    return "needs_follow_up";
  }
  if (status === "declined") return "declined";
  if (status === "unable_to_verbalize") return "unable_to_verbalize";
  return undefined;
}

function canDeferSlotStatus(status: ScopedSlotStatus) {
  return (
    status === "unanswered" ||
    status === "partially_answered" ||
    status === "needs_follow_up" ||
    status === "deferred" ||
    status === "unable_to_verbalize"
  );
}

function canAskAgainStatus(status: ScopedSlotStatus) {
  return (
    status === "unanswered" ||
    status === "partially_answered" ||
    status === "needs_follow_up" ||
    status === "deferred"
  );
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

export function resolveDiscussionTopic(value: string | undefined) {
  const text = typeof value === "string" ? value.trim() : "";

  return (
    DISCUSSION_TOPICS.find(
      (topic) =>
        topic.id === text ||
        topic.slot_name === text ||
        topic.title === text,
    ) ??
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
  subSlotStates: StoredSubSlotState[] = [],
): FinalMinutesResult {
  const generatedAt = new Date().toISOString();
  const acpSlots = slots.filter((slot) =>
    ACP_SLOT_NAMES.includes(slot.slot_name as AcpSlotName),
  );
  const themes = buildThemeMinutesItems(RESEARCH_THEMES, acpSlots, subSlotStates, utterances);
  const optionalThemes = buildThemeMinutesItems(
    OPTIONAL_RESEARCH_THEMES,
    acpSlots,
    subSlotStates,
    utterances,
  );
  const themeMetrics = calculateThemeCompletenessMetrics(acpSlots);
  const auxiliaryItems = [buildUnresolvedAuxiliaryItem(utterances)];
  const acpMinutesInput = buildACPMinutesLLMInput(themes);
  const acpMinutes = buildACPMinutesFromStructuredInput(acpMinutesInput);
  const markdown = renderACPMinutesMarkdown(acpMinutes, generatedAt);
  const statedThemes = themes.filter((theme) =>
    theme.aspects.some((aspect) => aspect.evidence.length > 0),
  );
  const followUpItems = themes.flatMap((theme) =>
    theme.aspects
      .filter((aspect) => aspect.status !== "filled")
      .slice(0, 3)
      .map((aspect) => `${theme.title}: ${aspect.label}`),
  );
  const lines = [
    "# ACP・今後の暮らしに関する話し合い 要約",
    "",
    `話し合い日: ${formatJapaneseDate(generatedAt)}`,
    `参加者: ${session?.participant_code || "-"}`,
    `文書の位置付け: この文書は、話し合い時点における本人の考えを整理したものです。体調、生活状況、家族状況などによって希望は変化する可能性があります。重要な状況変化があった場合は、本人へ再確認してください。`,
    "",
    "## 本人の考えの概要",
    "",
    buildPersonCenteredOverview(statedThemes),
    "",
    "## テーマ別の整理",
    "",
  ];

  themes.forEach((theme) => {
    lines.push(`### ${theme.title}`);
    lines.push(`- 確認状況: ${formatResponseState(theme.response_state)}`);
    lines.push(`- 要約: ${theme.summary}`);
    lines.push("");
    theme.aspects.forEach((aspect) => {
      const evidenceText =
        aspect.evidence.length > 0
          ? aspect.evidence.map((evidence) => evidence.evidenceText).join(" / ")
          : "次回確認";
      lines.push(`- ${aspect.label}: ${formatAspectStatus(aspect.status)}。${evidenceText}`);
    });
    lines.push("");
  });

  lines.push("## 今後確認が必要なこと");
  lines.push("");
  if (followUpItems.length > 0) {
    followUpItems.slice(0, 12).forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- 現時点で大きな未確認事項は整理されていません。");
  }
  lines.push("");

  lines.push("## 根拠となる代表的な発話");
  lines.push("");
  collectRepresentativeEvidence(themes).forEach((evidence) => {
    lines.push(`- ${evidence}`);
  });
  lines.push("");
  lines.push("## 補足");
  lines.push("");
  lines.push("- 具体的な医療処置の希望は、本人が明確に述べた内容と、まだ確認が必要な内容を区別して扱ってください。");
  lines.push("- 介護者による要約は、本人の同意が確認できた場合のみ本人の考えとして整理しています。");

  return {
    markdown,
    json: {
      generated_at: generatedAt,
      session,
      discussion_topic: DISCUSSION_TOPIC,
      utterances,
      slots: acpSlots,
      acp_minutes: acpMinutes,
      acp_minutes_llm_input: acpMinutesInput,
      themes,
      optional_themes: optionalThemes,
      theme_metrics: themeMetrics,
      auxiliary_items: auxiliaryItems,
      summary: "保存済みのTheme/Aspect/根拠発話から生成した医療・介護者向け要約です。",
    },
  };
}

function buildThemeMinutesItems(
  themes: readonly (typeof ALL_RESEARCH_THEMES)[number][],
  slots: AcpSlotState[],
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
): ThemeMinutesItem[] {
  const utteranceById = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );

  return themes.map((theme) => {
    const aspectItems = theme.aspects.map((aspect) => {
      const stored = subSlotStates.find(
        (state) => state.mainSlotId === theme.id && state.subSlotId === aspect.id,
      );
      const aspectEvidence = buildAspectEvidence(theme, aspect, stored, utteranceById);
      const status = getAspectStatusFromSubSlot(stored, aspectEvidence);

      return {
        aspect_id: aspect.id,
        label: aspect.label,
        priority: aspect.priority,
        status,
        completion: stored?.completion,
        responseState: stored?.responseState,
        reasonCode: stored?.reasonCode,
        canAskAgain: stored?.canAskAgain,
        isDeferred: stored?.isDeferred,
        evidence: aspectEvidence,
      };
    });
    const responseState = getThemeResponseStateFromAspects(aspectItems, theme, slots);
    const evidence = aspectItems
      .flatMap((aspect) => aspect.evidence.map((item) => item.evidenceText))
      .filter(Boolean)
      .slice(0, 4)
      .join("\n");
    const summary = buildThemeSummaryFromAspects(theme, aspectItems, slots);

    return {
      theme_id: theme.id,
      title: theme.title,
      level: theme.level,
      response_state: responseState,
      summary,
      evidence_utterance: evidence,
      aspects: aspectItems,
    };
  });
}

export function buildACPMinutesLLMInput(themes: ThemeMinutesItem[]): ACPMinutesLLMInput {
  return {
    title: "これからの暮らしと大切にしたいこと",
    recordType: "acp_discussion_record_input",
    themes: themes
      .filter((theme) => isACPMinutesThemeId(theme.theme_id))
      .map((theme) => ({
        theme_id: theme.theme_id as keyof ACPMinutes["themes"],
        title: theme.title,
        response_state: theme.response_state,
        aspects: theme.aspects
          .map((aspect) => ({
            aspect_id: normalizeMinutesAspectId(theme.theme_id, aspect.aspect_id),
            label: aspect.label,
            priority: aspect.priority,
            status: aspect.status,
            completion: aspect.completion,
            responseState: aspect.responseState,
            reasonCode: aspect.reasonCode,
            canAskAgain: aspect.canAskAgain,
            isDeferred: aspect.isDeferred,
            evidence: aspect.evidence
              .map((evidence) => toACPAspectEvidence(evidence))
              .filter((evidence): evidence is ACPAspectEvidence => Boolean(evidence)),
          }))
          .filter((aspect) => aspect.evidence.length > 0),
      }))
      .filter((theme) => theme.aspects.length > 0),
  };
}

export function buildACPMinutesFromStructuredInput(input: ACPMinutesLLMInput): ACPMinutes {
  const getValues = (themeId: keyof ACPMinutes["themes"], aspectIds: string[]) =>
    getAspectValues(input, themeId, aspectIds);
  const getFirst = (themeId: keyof ACPMinutes["themes"], aspectIds: string[]) =>
    getValues(themeId, aspectIds)[0] ?? null;

  return {
    title: "これからの暮らしと大切にしたいこと",
    recordType: "acp_discussion_record",
    themes: {
      current_life_values: {
        title: "今の暮らしの中で大切にしていること",
        life_supports: getValues("current_life_values", ["valued_routine", "hobby_or_joy"]),
        reason: getFirst("current_life_values", ["reason"]),
        background: {
          relationships: getValues("current_life_values", ["relationships", "cross_connection"]),
          role: getValues("current_life_values", ["role"]),
          attachment: getValues("current_life_values", ["attachment", "cross_living_environment"]),
        },
      },
      future_life_continuity: {
        title: "これからも守っていきたい暮らし",
        continued_activity: getValues("future_life_continuity", ["continued_activity", "continued_relationship"]),
        self_continuation: getValues("future_life_continuity", ["self_continuation"]),
        not_want_to_lose: getValues("future_life_continuity", ["not_want_to_lose"]),
        reason: getFirst("future_life_continuity", ["reason"]),
        acceptable_change: getValues("future_life_continuity", ["acceptable_change"]),
        important_for_continuation: getValues("future_life_continuity", [
          "preferred_environment",
          "cross_selfhood",
          "cross_support",
          "cross_secure_living",
        ]),
      },
      selfhood: {
        title: "「自分らしく暮らす」ために大切なこと",
        self_determination: getValues("selfhood", ["self_determination"]),
        respect: getValues("selfhood", ["respect"]),
        purpose_or_role: getValues("selfhood", ["purpose_or_role"]),
        lifestyle: getValues("selfhood", ["lifestyle", "cross_values", "cross_living_environment", "cross_support"]),
        other_important_things: {
          privacy: getValues("selfhood", ["privacy"]),
          connection: getValues("selfhood", ["connection"]),
          comfort: getValues("selfhood", ["comfort"]),
        },
      },
      care_support: {
        title: "もし手助けが必要になったら",
        acceptable_support: getValues("care_support", ["acceptable_support"]),
        unacceptable_support: getValues("care_support", ["unacceptable_support"]),
        self_scope: getValues("care_support", ["self_scope"]),
        support_person: getValues("care_support", ["support_person"]),
        support_decision: getValues("care_support", ["decision_process"]),
        anxiety: getValues("care_support", ["anxiety"]),
        support_condition: getValues("care_support", ["support_condition", "timing"]),
      },
      family_communication: {
        title: "家族に伝えておきたいこと",
        request: getValues("family_communication", ["request"]),
        burden_concern: getValues("family_communication", ["burden_concern"]),
        feelings: getValues("family_communication", ["feelings"]),
        expected_judgement: getValues("family_communication", ["expected_judgement"]),
        avoidance: getValues("family_communication", ["avoidance"]),
        non_family_support: getValues("family_communication", ["non_family_support"]),
        unspoken: getValues("family_communication", ["unspoken"]),
      },
      proxy_decision_support: {
        title: "もし自分で決めることが難しくなったら",
        trusted_person: getValues("proxy_decision_support", ["trusted_person"]),
        trust_reason: getValues("proxy_decision_support", ["trust_reason"]),
        values_to_share: getValues("proxy_decision_support", ["values_to_share"]),
        involvement: getValues("proxy_decision_support", ["involvement"]),
        multiple_people: getValues("proxy_decision_support", ["multiple_people"]),
        not_decided: getAspectValues(input, "proxy_decision_support", ["not_decided"]).length > 0,
        hard_to_decide: getValues("proxy_decision_support", ["hard_to_decide"]),
      },
    },
    overall_summary: buildConservativeOverallSummary(input),
    narratives: buildFallbackThemeNarratives(input),
  };
}

export function validateACPMinutes(
  value: unknown,
  input?: ACPMinutesLLMInput,
): ACPMinutes | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ACPMinutes>;
  if (candidate.recordType !== "acp_discussion_record") return null;
  if (!candidate.themes || typeof candidate.themes !== "object") return null;
  if (!candidate.overall_summary || typeof candidate.overall_summary !== "object") return null;

  const evidenceIndex = input ? buildMinutesEvidenceIndex(input) : null;
  const narratives = normalizeThemeNarratives(candidate.narratives, input);

  return {
    title: normalizeString(candidate.title, "これからの暮らしと大切にしたいこと"),
    recordType: "acp_discussion_record",
    themes: {
      current_life_values: {
        title: normalizeString(candidate.themes.current_life_values?.title, "今の暮らしの中で大切にしていること"),
        life_supports: normalizeStringArray(candidate.themes.current_life_values?.life_supports),
        reason: normalizeNullableString(candidate.themes.current_life_values?.reason),
        background: {
          relationships: normalizeStringArray(candidate.themes.current_life_values?.background?.relationships),
          role: normalizeStringArray(candidate.themes.current_life_values?.background?.role),
          attachment: normalizeStringArray(candidate.themes.current_life_values?.background?.attachment),
        },
      },
      future_life_continuity: {
        title: normalizeString(candidate.themes.future_life_continuity?.title, "これからも守っていきたい暮らし"),
        continued_activity: normalizeStringArray(candidate.themes.future_life_continuity?.continued_activity),
        self_continuation: normalizeStringArray(candidate.themes.future_life_continuity?.self_continuation),
        not_want_to_lose: normalizeStringArray(candidate.themes.future_life_continuity?.not_want_to_lose),
        reason: normalizeNullableString(candidate.themes.future_life_continuity?.reason),
        acceptable_change: normalizeStringArray(candidate.themes.future_life_continuity?.acceptable_change),
        important_for_continuation: normalizeStringArray(candidate.themes.future_life_continuity?.important_for_continuation),
      },
      selfhood: {
        title: normalizeString(candidate.themes.selfhood?.title, "「自分らしく暮らす」ために大切なこと"),
        self_determination: normalizeStringArray(candidate.themes.selfhood?.self_determination),
        respect: normalizeStringArray(candidate.themes.selfhood?.respect),
        purpose_or_role: normalizeStringArray(candidate.themes.selfhood?.purpose_or_role),
        lifestyle: normalizeStringArray(candidate.themes.selfhood?.lifestyle),
        other_important_things: {
          privacy: normalizeStringArray(candidate.themes.selfhood?.other_important_things?.privacy),
          connection: normalizeStringArray(candidate.themes.selfhood?.other_important_things?.connection),
          comfort: normalizeStringArray(candidate.themes.selfhood?.other_important_things?.comfort),
        },
      },
      care_support: {
        title: normalizeString(candidate.themes.care_support?.title, "もし手助けが必要になったら"),
        acceptable_support: normalizeStringArray(candidate.themes.care_support?.acceptable_support),
        unacceptable_support: normalizeStringArray(candidate.themes.care_support?.unacceptable_support),
        self_scope: normalizeStringArray(candidate.themes.care_support?.self_scope),
        support_person: normalizeStringArray(candidate.themes.care_support?.support_person),
        support_decision: normalizeStringArray(candidate.themes.care_support?.support_decision),
        anxiety: normalizeStringArray(candidate.themes.care_support?.anxiety),
        support_condition: normalizeStringArray(candidate.themes.care_support?.support_condition),
      },
      family_communication: {
        title: normalizeString(candidate.themes.family_communication?.title, "家族に伝えておきたいこと"),
        request: normalizeStringArray(candidate.themes.family_communication?.request),
        burden_concern: normalizeStringArray(candidate.themes.family_communication?.burden_concern),
        feelings: normalizeStringArray(candidate.themes.family_communication?.feelings),
        expected_judgement: normalizeStringArray(candidate.themes.family_communication?.expected_judgement),
        avoidance: normalizeStringArray(candidate.themes.family_communication?.avoidance),
        non_family_support: normalizeStringArray(candidate.themes.family_communication?.non_family_support),
        unspoken: normalizeStringArray(candidate.themes.family_communication?.unspoken),
      },
      proxy_decision_support: {
        title: normalizeString(candidate.themes.proxy_decision_support?.title, "もし自分で決めることが難しくなったら"),
        trusted_person: normalizeStringArray(candidate.themes.proxy_decision_support?.trusted_person),
        trust_reason: normalizeStringArray(candidate.themes.proxy_decision_support?.trust_reason),
        values_to_share: normalizeStringArray(candidate.themes.proxy_decision_support?.values_to_share),
        involvement: normalizeStringArray(candidate.themes.proxy_decision_support?.involvement),
        multiple_people: normalizeStringArray(candidate.themes.proxy_decision_support?.multiple_people),
        not_decided: candidate.themes.proxy_decision_support?.not_decided === true,
        hard_to_decide: normalizeStringArray(candidate.themes.proxy_decision_support?.hard_to_decide),
      },
    },
    overall_summary: {
      core_values: normalizeGeneratedSummaries(candidate.overall_summary.core_values, evidenceIndex),
      cross_theme_connections: normalizeGeneratedConnections(candidate.overall_summary.cross_theme_connections, evidenceIndex),
      undecided_things: normalizeStringArray(candidate.overall_summary.undecided_things),
    },
    narratives,
    narrative_debug: {
      ...(candidate.narrative_debug ?? {}),
      validation: buildNarrativeValidationDebug(narratives, input),
    },
  };
}

export function renderACPMinutesMarkdown(minutes: ACPMinutes, generatedAt?: string) {
  const lines = [
    "# これからの暮らしと大切にしたいこと",
    "",
    "ACP 話し合いの記録",
    "",
    "この記録は、今回の話し合いの中で出てきた「大切にしたいこと」や「これからの希望」を、あとから本人や家族が振り返りやすい形にまとめたものです。",
  ];

  if (generatedAt) {
    lines.push("", `作成日: ${formatJapaneseDate(generatedAt)}`);
  }

  appendMinutesSection(lines, "本人の考えの概要", [
    ...minutes.overall_summary.core_values.map((item) => item.text),
    ...minutes.overall_summary.cross_theme_connections.map((item) => item.text),
    ...minutes.overall_summary.undecided_things,
  ]);
  appendMinutesSection(lines, minutes.themes.current_life_values.title, [
    ...prefixValues("今、暮らしを支えているもの", minutes.themes.current_life_values.life_supports),
    ...prefixValues("それが大切な理由", nullableToArray(minutes.themes.current_life_values.reason)),
    ...prefixValues("大切な人とのつながり", minutes.themes.current_life_values.background.relationships),
    ...prefixValues("家族や地域での役割", minutes.themes.current_life_values.background.role),
    ...prefixValues("自宅や地域への思い", minutes.themes.current_life_values.background.attachment),
  ]);
  appendMinutesSection(lines, minutes.themes.future_life_continuity.title, [
    ...prefixValues("これからも続けたいこと", minutes.themes.future_life_continuity.continued_activity),
    ...prefixValues("できる限り自分で続けたいこと", minutes.themes.future_life_continuity.self_continuation),
    ...prefixValues("失いたくないもの", minutes.themes.future_life_continuity.not_want_to_lose),
    ...prefixValues("なぜ続けたいのか", nullableToArray(minutes.themes.future_life_continuity.reason)),
    ...prefixValues("変わっても大丈夫だと思えること", minutes.themes.future_life_continuity.acceptable_change),
    ...prefixValues("続けるために大切になりそうなこと", minutes.themes.future_life_continuity.important_for_continuation),
  ]);
  appendMinutesSection(lines, minutes.themes.selfhood.title, [
    ...prefixValues("自分で決めていたいこと", minutes.themes.selfhood.self_determination),
    ...prefixValues("周囲に大切にしてほしいこと", minutes.themes.selfhood.respect),
    ...prefixValues("生きがいや、自分の役割", minutes.themes.selfhood.purpose_or_role),
    ...prefixValues("本人らしい暮らし方", minutes.themes.selfhood.lifestyle),
    ...prefixValues("プライバシー", minutes.themes.selfhood.other_important_things.privacy),
    ...prefixValues("人とのつながり", minutes.themes.selfhood.other_important_things.connection),
    ...prefixValues("心身の快適さ", minutes.themes.selfhood.other_important_things.comfort),
  ]);
  appendMinutesSection(lines, minutes.themes.care_support.title, [
    ...prefixValues("こんな手助けなら受け入れやすい", minutes.themes.care_support.acceptable_support),
    ...prefixValues("こういう手助けは避けたい", minutes.themes.care_support.unacceptable_support),
    ...prefixValues("手助けを受けても、自分で続けたいこと", minutes.themes.care_support.self_scope),
    ...prefixValues("誰に頼りたいか", minutes.themes.care_support.support_person),
    ...prefixValues("手助けについて大切にしたい考え方", minutes.themes.care_support.support_decision),
    ...prefixValues("気になっていること・不安", minutes.themes.care_support.anxiety),
    ...prefixValues("支援を受けたい条件", minutes.themes.care_support.support_condition),
  ]);
  appendMinutesSection(lines, minutes.themes.family_communication.title, [
    ...prefixValues("家族にお願いしたいこと", minutes.themes.family_communication.request),
    ...prefixValues("家族に負担をかけることについて", minutes.themes.family_communication.burden_concern),
    ...prefixValues("家族への気持ち", minutes.themes.family_communication.feelings),
    ...prefixValues("もし自分で判断することが難しくなったら", minutes.themes.family_communication.expected_judgement),
    ...prefixValues("家族にしてほしくないこと", minutes.themes.family_communication.avoidance),
    ...prefixValues("家族以外にも頼れる人", minutes.themes.family_communication.non_family_support),
    ...prefixValues("まだ言葉にできていないこと", minutes.themes.family_communication.unspoken),
  ]);
  appendMinutesSection(lines, minutes.themes.proxy_decision_support.title, [
    ...prefixValues("相談してほしい人", minutes.themes.proxy_decision_support.trusted_person),
    ...prefixValues("その人を信頼している理由", minutes.themes.proxy_decision_support.trust_reason),
    ...prefixValues("その人に知っておいてほしい自分の考え", minutes.themes.proxy_decision_support.values_to_share),
    ...prefixValues("どのように関わってほしいか", minutes.themes.proxy_decision_support.involvement),
    ...prefixValues("複数の人に相談してほしいか", minutes.themes.proxy_decision_support.multiple_people),
    ...(minutes.themes.proxy_decision_support.not_decided ? ["まだ特定の人を決めていない。"] : []),
    ...prefixValues("決めにくい理由", minutes.themes.proxy_decision_support.hard_to_decide),
  ]);

  return lines.join("\n");
}

function toACPAspectEvidence(evidence: EvidenceReference): ACPAspectEvidence | null {
  const rawText = stripSpeakerPrefix(evidence.evidenceText);
  const text = anonymizeACPText(rawText);
  if (!text) return null;

  return {
    value: normalizeMinutesSentence(text),
    evidence: text,
    speaker: normalizeEvidenceSpeaker(evidence.speaker),
    certainty: inferEvidenceCertainty(text),
    condition: inferEvidenceCondition(text),
    negation: hasNegation(text),
    sourceUtteranceId: evidence.evidenceUtteranceId,
    sourceTopicId: evidence.sourceTopicId,
  };
}

function getAspectValues(
  input: ACPMinutesLLMInput,
  themeId: keyof ACPMinutes["themes"],
  aspectIds: string[],
) {
  const idSet = new Set(aspectIds);
  const theme = input.themes.find((item) => item.theme_id === themeId);
  if (!theme) return [];

  return uniqueStrings(
    theme.aspects
      .filter((aspect) => idSet.has(aspect.aspect_id))
      .flatMap((aspect) => aspect.evidence.map(formatACPAspectForMinutes)),
  );
}

function buildConservativeOverallSummary(input: ACPMinutesLLMInput): ACPMinutes["overall_summary"] {
  const aspectThemes = new Map<string, Set<string>>();
  input.themes.forEach((theme) => {
    theme.aspects.forEach((aspect) => {
      if (!aspectThemes.has(aspect.aspect_id)) aspectThemes.set(aspect.aspect_id, new Set());
      aspectThemes.get(aspect.aspect_id)?.add(theme.theme_id);
    });
  });

  const selfContinuationAspects = ["self_continuation", "self_determination", "self_scope"]
    .filter((aspectId) => input.themes.some((theme) => theme.aspects.some((aspect) => aspect.aspect_id === aspectId)));
  const relatedThemes = uniqueStrings(
    input.themes
      .filter((theme) => theme.aspects.some((aspect) => selfContinuationAspects.includes(aspect.aspect_id)))
      .map((theme) => theme.theme_id),
  );
  const undecided = input.themes.flatMap((theme) =>
    theme.aspects
      .filter((aspect) =>
        aspect.aspect_id === "not_decided" ||
        aspect.evidence.some((evidence) => evidence.certainty === "迷いあり" || evidence.certainty === "条件付き"),
      )
      .flatMap((aspect) => aspect.evidence.map(formatACPAspectForMinutes)),
  );

  return {
    core_values:
      selfContinuationAspects.length >= 2
        ? [{
            text: "できることは、できるだけ自分で続けたいという思いが複数のテーマで確認されています。",
            source_aspects: selfContinuationAspects,
            source_utterance_ids: getSourceUtteranceIdsForAspects(input, selfContinuationAspects),
          }]
        : [],
    cross_theme_connections:
      selfContinuationAspects.length >= 2 && relatedThemes.length >= 2
        ? [{
            text: "自分で続けたいという思いが、暮らしの継続、自分らしさ、支援の希望にまたがって表れています。",
            source_aspects: selfContinuationAspects,
            related_themes: relatedThemes,
            source_utterance_ids: getSourceUtteranceIdsForAspects(input, selfContinuationAspects),
          }]
        : [],
    undecided_things: uniqueStrings(undecided),
  };
}

function buildFallbackThemeNarratives(input: ACPMinutesLLMInput): ACPMinutes["narratives"] {
  const narratives: ACPMinutes["narratives"] = {};

  input.themes.forEach((theme) => {
    narratives[theme.theme_id] = {
      currentThought: null,
      background: null,
      conditions: [],
      uncertainties: [],
      tensions: [],
      confirmationNeeded: [],
    };
  });

  return narratives;
}

function buildGroundedTextFromAspects(
  theme: ACPMinutesLLMInput["themes"][number],
  aspectIds: string[],
): GroundedMinutesText | null {
  const sourceAspects = theme.aspects.filter((aspect) => aspectIds.includes(aspect.aspect_id));
  const sourceUtteranceIds = uniqueStrings(
    sourceAspects.flatMap((aspect) =>
      aspect.evidence.map((evidence) => evidence.sourceUtteranceId ?? ""),
    ),
  );
  const evidenceTexts = uniqueStrings(
    sourceAspects.flatMap((aspect) =>
      aspect.evidence.map((evidence) => evidence.value || evidence.evidence || ""),
    ),
  );
  if (sourceUtteranceIds.length === 0 || evidenceTexts.length === 0) return null;

  return {
    text: buildFallbackNarrativeText(evidenceTexts),
    sourceUtteranceIds,
    sourceAspectIds: uniqueStrings(sourceAspects.map((aspect) => aspect.aspect_id)),
  };
}

function buildGroundedTextListFromAspects(
  theme: ACPMinutesLLMInput["themes"][number],
  aspectIds: string[],
) {
  return aspectIds
    .map((aspectId) => buildGroundedTextFromAspects(theme, [aspectId]))
    .filter((item): item is GroundedMinutesText => Boolean(item));
}

function getNarrativeAspectGroups(themeId: keyof ACPMinutes["themes"]) {
  switch (themeId) {
    case "current_life_values":
      return {
        currentThought: ["valued_routine", "hobby_or_joy"],
        background: ["reason", "relationships", "role", "attachment", "cross_connection", "cross_living_environment"],
        conditions: [],
        uncertainties: [],
      };
    case "future_life_continuity":
      return {
        currentThought: ["continued_activity", "self_continuation", "not_want_to_lose"],
        background: ["reason", "important_for_continuation", "preferred_environment", "cross_selfhood", "cross_support", "cross_secure_living"],
        conditions: ["acceptable_change"],
        uncertainties: [],
      };
    case "selfhood":
      return {
        currentThought: ["self_determination", "respect", "purpose_or_role", "lifestyle", "cross_values", "cross_living_environment", "cross_support"],
        background: ["privacy", "connection", "comfort"],
        conditions: [],
        uncertainties: [],
      };
    case "care_support":
      return {
        currentThought: ["acceptable_support", "unacceptable_support", "self_scope", "support_person", "decision_process"],
        background: ["anxiety"],
        conditions: ["support_condition", "timing"],
        uncertainties: [],
      };
    case "family_communication":
      return {
        currentThought: ["request", "burden_concern", "feelings", "expected_judgement", "avoidance", "non_family_support"],
        background: [],
        conditions: [],
        uncertainties: ["unspoken"],
      };
    case "proxy_decision_support":
      return {
        currentThought: ["trusted_person", "trust_reason", "values_to_share", "involvement", "multiple_people"],
        background: [],
        conditions: [],
        uncertainties: ["not_decided", "hard_to_decide"],
      };
  }
}

function buildFallbackNarrativeText(evidenceTexts: string[]) {
  return evidenceTexts
    .slice(0, 4)
    .map((text) => normalizeMinutesSentence(stripSpeakerPrefix(text)))
    .join("\n");
}

function normalizeThemeNarratives(
  value: unknown,
  input?: ACPMinutesLLMInput,
): ACPMinutes["narratives"] {
  const fallback = input ? buildFallbackThemeNarratives(input) : {};
  if (!value || typeof value !== "object") return fallback;

  const record = value as Record<string, unknown>;
  const evidenceIndex = input ? buildMinutesEvidenceIndex(input) : null;
  const next: ACPMinutes["narratives"] = {};

  Object.keys(fallback).forEach((themeId) => {
    if (!isACPMinutesThemeId(themeId)) return;
    const themeNarrative = record[themeId];
    const fallbackTheme = fallback[themeId] ?? {};
    next[themeId] =
      themeNarrative && typeof themeNarrative === "object"
        ? {
            currentThought:
              normalizeGroundedText((themeNarrative as Record<string, unknown>).currentThought, themeId, evidenceIndex, { rejectRawCopy: true }) ??
              fallbackTheme.currentThought ??
              null,
            background:
              normalizeGroundedText((themeNarrative as Record<string, unknown>).background, themeId, evidenceIndex, { rejectRawCopy: true }) ??
              fallbackTheme.background ??
              null,
            conditions: normalizeGroundedTextArray((themeNarrative as Record<string, unknown>).conditions, themeId, evidenceIndex, fallbackTheme.conditions, { rejectRawCopy: true }),
            uncertainties: normalizeGroundedTextArray((themeNarrative as Record<string, unknown>).uncertainties, themeId, evidenceIndex, fallbackTheme.uncertainties, { rejectRawCopy: true, section: "uncertainties" }),
            tensions: normalizeGroundedTextArray((themeNarrative as Record<string, unknown>).tensions, themeId, evidenceIndex, fallbackTheme.tensions, { rejectRawCopy: true, section: "tensions" }),
            confirmationNeeded: normalizeGroundedTextArray((themeNarrative as Record<string, unknown>).confirmationNeeded, themeId, evidenceIndex, fallbackTheme.confirmationNeeded, { rejectRawCopy: true }),
          }
        : fallbackTheme;
  });

  return next;
}

function buildNarrativeValidationDebug(
  narratives: ACPMinutes["narratives"],
  input?: ACPMinutesLLMInput,
): NonNullable<ACPMinutes["narrative_debug"]>["validation"] {
  if (!narratives) return [];
  const evidenceIndex = input ? buildMinutesEvidenceIndex(input) : new Map();

  return Object.entries(narratives).flatMap(([themeId, narrative]) => {
    if (!narrative) return [];

    return [
      ...groundedTextDebugRows(themeId, "currentThought", narrative.currentThought, evidenceIndex),
      ...groundedTextDebugRows(themeId, "background", narrative.background, evidenceIndex),
      ...groundedTextDebugRows(themeId, "conditions", narrative.conditions, evidenceIndex),
      ...groundedTextDebugRows(themeId, "uncertainties", narrative.uncertainties, evidenceIndex),
      ...groundedTextDebugRows(themeId, "tensions", narrative.tensions, evidenceIndex),
      ...groundedTextDebugRows(themeId, "confirmationNeeded", narrative.confirmationNeeded, evidenceIndex),
    ];
  });
}

function groundedTextDebugRows(
  themeId: string,
  field: string,
  value: GroundedMinutesText | GroundedMinutesText[] | null | undefined,
  evidenceIndex: Map<string, { speaker?: ACPAspectSpeaker; text?: string }>,
) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];

  return items.map((item) => ({
    themeId,
    field,
    text: item.text,
    sourceUtteranceIds: item.sourceUtteranceIds,
    sourceUtterances: item.sourceUtteranceIds
      .map((id) => {
        const evidence = evidenceIndex.get(id);
        if (!evidence?.text) return null;
        return {
          id,
          text: evidence.text,
          ...(evidence.speaker ? { speaker: evidence.speaker } : {}),
        };
      })
      .filter((source): source is { id: string; text: string; speaker?: ACPAspectSpeaker } => Boolean(source)),
    accepted: item.sourceUtteranceIds.length > 0,
  }));
}

function normalizeGroundedTextArray(
  value: unknown,
  themeId: keyof ACPMinutes["themes"],
  evidenceIndex: Map<string, { themeId: string; speaker?: ACPAspectSpeaker; text?: string }> | null,
  fallback: GroundedMinutesText[] = [],
  options: { rejectRawCopy?: boolean; section?: "uncertainties" | "tensions" } = {},
) {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => normalizeGroundedText(item, themeId, evidenceIndex, options))
    .map((item) => filterGroundedTextBySectionRules(item, options.section, evidenceIndex))
    .filter((item): item is GroundedMinutesText => Boolean(item));

  return items.length > 0 ? items : fallback;
}

function normalizeGroundedText(
  value: unknown,
  themeId: keyof ACPMinutes["themes"],
  evidenceIndex: Map<string, { themeId: string; speaker?: ACPAspectSpeaker; text?: string }> | null,
  options: { rejectRawCopy?: boolean } = {},
): GroundedMinutesText | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = normalizeString(record.text);
  const sourceUtteranceIds = normalizeStringArray(record.sourceUtteranceIds);
  if (!text || sourceUtteranceIds.length === 0) return null;

  if (evidenceIndex) {
    const validSourceUtteranceIds = sourceUtteranceIds.filter((id) => {
      const evidence = evidenceIndex.get(id);
      if (!evidence || evidence.themeId !== themeId) return false;
      return evidence.speaker === "本人" || evidence.speaker === "家族";
    });
    if (validSourceUtteranceIds.length === 0) return null;

    if (options.rejectRawCopy && looksLikeRawEvidenceCopy(text, validSourceUtteranceIds, evidenceIndex)) {
      return null;
    }

    return {
      text,
      sourceUtteranceIds: validSourceUtteranceIds,
      sourceAspectIds: normalizeStringArray(record.sourceAspectIds),
    };
  }

  return {
    text,
    sourceUtteranceIds,
    sourceAspectIds: normalizeStringArray(record.sourceAspectIds),
  };
}

function filterGroundedTextBySectionRules(
  item: GroundedMinutesText | null,
  section: "uncertainties" | "tensions" | undefined,
  evidenceIndex: Map<string, { text?: string }> | null,
) {
  if (!item || !section) return item;
  const sourceTexts = evidenceIndex
    ? item.sourceUtteranceIds.map((id) => evidenceIndex.get(id)?.text ?? "").join("\n")
    : "";
  const combinedText = `${item.text}\n${sourceTexts}`;

  if (section === "uncertainties" && !hasExplicitUncertaintyForMinutes(combinedText)) {
    return null;
  }

  if (section === "tensions") {
    if (item.sourceUtteranceIds.length < 2) return null;
    if (!hasExplicitTensionForMinutes(combinedText)) return null;
  }

  return item;
}

function hasExplicitUncertaintyForMinutes(text: string) {
  return /(分からない|わからない|分かんない|まだ.*(?:決め|考え)|決めていない|決まっていない|考えたことがない|迷っている|迷う|何とも言えない|なんとも言えない)/.test(text);
}

function hasExplicitTensionForMinutes(text: string) {
  return /(一方|反面|ただ|ただし|しかし|でも|けれど|けど|両方|同時に|迷|悩|気になる|心配|不安|負担|避けたい|したくない)/.test(text);
}

function buildMinutesEvidenceIndex(input: ACPMinutesLLMInput) {
  const index = new Map<string, { themeId: string; speaker?: ACPAspectSpeaker; text?: string }>();
  input.themes.forEach((theme) => {
    theme.aspects.forEach((aspect) => {
      aspect.evidence.forEach((evidence) => {
        if (!evidence.sourceUtteranceId) return;
        index.set(evidence.sourceUtteranceId, {
          themeId: theme.theme_id,
          speaker: evidence.speaker,
          text: evidence.evidence ?? evidence.value,
        });
      });
    });
  });
  return index;
}

function looksLikeRawEvidenceCopy(
  narrativeText: string,
  sourceUtteranceIds: string[],
  evidenceIndex: Map<string, { text?: string }>,
) {
  const normalizedNarrative = normalizeForMinutesCopyCheck(narrativeText);
  if (!normalizedNarrative) return false;
  if (/^「.*」$/.test(narrativeText.trim())) return true;

  const normalizedEvidenceTexts = sourceUtteranceIds
    .map((id) => evidenceIndex.get(id)?.text ?? "")
    .map((text) => normalizeForMinutesCopyCheck(text))
    .filter((text) => text.length >= 10);
  if (normalizedEvidenceTexts.length === 0) return false;

  if (normalizedEvidenceTexts.some((evidenceText) => {
    if (evidenceText.length < 12) return false;
    if (normalizedNarrative === evidenceText) return true;
    if (evidenceText.length >= 18 && normalizedNarrative.includes(evidenceText)) return true;
    return false;
  })) {
    return true;
  }

  const includedEvidenceTexts = normalizedEvidenceTexts.filter((evidenceText) =>
    evidenceText.length >= 12 && normalizedNarrative.includes(evidenceText),
  );
  if (includedEvidenceTexts.length >= 2) return true;

  const copiedLength = includedEvidenceTexts.reduce((total, evidenceText) => total + evidenceText.length, 0);
  if (sourceUtteranceIds.length >= 2 && copiedLength / normalizedNarrative.length >= 0.55) {
    return true;
  }

  return sourceUtteranceIds.some((id) => {
    const evidenceText = evidenceIndex.get(id)?.text;
    if (!evidenceText) return false;
    const normalizedEvidence = normalizeForMinutesCopyCheck(evidenceText);
    if (normalizedEvidence.length < 10) return false;

    return similarityRatio(normalizedNarrative, normalizedEvidence) >= 0.92;
  });
}

function normalizeForMinutesCopyCheck(value: string) {
  return value
    .replace(/^(本人|家族|介護者|その他|elder|caregiver)\s*[:：]\s*/i, "")
    .replace(/[「」『』"'\s、。,.，．！？!?]/g, "")
    .toLowerCase()
    .trim();
}

function similarityRatio(a: string, b: string) {
  if (!a || !b) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (shorter.length === 0) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;

  const distance = levenshteinDistance(longer, shorter);
  return 1 - distance / longer.length;
}

function levenshteinDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function getSourceUtteranceIdsForAspects(
  input: ACPMinutesLLMInput,
  aspectIds: string[],
) {
  const idSet = new Set(aspectIds);
  return uniqueStrings(
    input.themes.flatMap((theme) =>
      theme.aspects
        .filter((aspect) => idSet.has(aspect.aspect_id))
        .flatMap((aspect) => aspect.evidence.map((evidence) => evidence.sourceUtteranceId ?? "")),
    ),
  );
}

function normalizeMinutesAspectId(themeId: string, aspectId: string) {
  if (themeId === "care_support" && aspectId === "timing") return "support_condition";
  return aspectId;
}

function formatACPAspectForMinutes(evidence: ACPAspectEvidence) {
  return evidence.value;
}

function anonymizeACPText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[メール]")
    .replace(/\b\d{2,4}[-\s]?\d{2,4}[-\s]?\d{3,4}\b/g, "[電話番号]")
    .replace(/\b(?:patient|participant|研究参加者|患者)[-_ ]?[A-Za-z0-9]{3,}\b/gi, "[ID]")
    .replace(/[A-Za-z0-9_-]{8,}/g, "[ID]")
    .replace(/([一-龯]{2,4})(病院|クリニック|医院|医療センター)/g, "[医療機関]")
    .trim();
}

function normalizeMinutesSentence(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return /[。.!?！？]$/.test(text) ? text : `${text}。`;
}

function stripSpeakerPrefix(value: string) {
  return value.replace(/^(本人|家族|介護者|その他|elder|caregiver)\s*[:：]\s*/i, "").trim();
}

function normalizeEvidenceSpeaker(value: string): ACPAspectSpeaker {
  if (value === "elder") return "本人";
  if (value === "caregiver") return "家族";
  return "その他";
}

function inferEvidenceCertainty(text: string): ACPAspectCertainty {
  if (/(まだ|決めていない|迷|分から|わから|考えられない)/.test(text)) return "迷いあり";
  if (/(できれば|場合|なら|とき|時|うちは|状況|条件|かかるなら)/.test(text)) return "条件付き";
  return text ? "明確" : "不明";
}

function inferEvidenceCondition(text: string) {
  const match = text.match(/(.{0,24}(?:うちは|場合|なら|とき|時|状況).{0,24})/);
  return match ? match[1].trim() : null;
}

function hasNegation(text: string) {
  return /(嫌|いや|避けたい|したくない|してほしくない|望まない|不要|いらない|断る)/.test(text);
}

function isACPMinutesThemeId(value: string): value is keyof ACPMinutes["themes"] {
  return [
    "current_life_values",
    "future_life_continuity",
    "selfhood",
    "care_support",
    "family_communication",
    "proxy_decision_support",
  ].includes(value);
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? uniqueStrings(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))
    : [];
}

function normalizeGeneratedSummaries(
  value: unknown,
  evidenceIndex: Map<string, { themeId: string; speaker?: ACPAspectSpeaker; text?: string }> | null = null,
): ACPGeneratedSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const text = normalizeString(record.text);
      const sourceAspects = normalizeStringArray(record.source_aspects);
      const sourceUtteranceIds = normalizeStringArray(record.source_utterance_ids);
      const validSourceUtteranceIds = filterKnownEvidenceIds(sourceUtteranceIds, evidenceIndex);
      return text && sourceAspects.length >= 2 && validSourceUtteranceIds.length > 0
        ? {
            text,
            source_aspects: sourceAspects,
            source_utterance_ids: validSourceUtteranceIds,
          }
        : null;
    })
    .filter((item): item is ACPGeneratedSummary => Boolean(item));
}

function normalizeGeneratedConnections(
  value: unknown,
  evidenceIndex: Map<string, { themeId: string; speaker?: ACPAspectSpeaker; text?: string }> | null = null,
): ACPGeneratedConnection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const text = normalizeString(record.text);
      const sourceAspects = normalizeStringArray(record.source_aspects);
      const relatedThemes = normalizeStringArray(record.related_themes);
      const sourceUtteranceIds = normalizeStringArray(record.source_utterance_ids);
      const validSourceUtteranceIds = filterKnownEvidenceIds(sourceUtteranceIds, evidenceIndex);
      return text && sourceAspects.length >= 2 && relatedThemes.length >= 2 && validSourceUtteranceIds.length > 0
        ? {
            text,
            source_aspects: sourceAspects,
            related_themes: relatedThemes,
            source_utterance_ids: validSourceUtteranceIds,
          }
        : null;
    })
    .filter((item): item is ACPGeneratedConnection => Boolean(item));
}

function filterKnownEvidenceIds(
  ids: string[],
  evidenceIndex: Map<string, unknown> | null,
) {
  if (!evidenceIndex) return ids;
  return ids.filter((id) => evidenceIndex.has(id));
}

function appendMinutesSection(lines: string[], title: string, values: string[]) {
  const items = uniqueStrings(values);
  if (items.length === 0) return;
  lines.push("", `## ${title}`, "");
  items.forEach((item) => lines.push(`- ${item}`));
}

function prefixValues(label: string, values: string[]) {
  return values.map((value) => `${label}: ${value}`);
}

function nullableToArray(value: string | null) {
  return value ? [value] : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function buildAspectEvidence(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  aspect: (typeof ALL_RESEARCH_THEMES)[number]["aspects"][number],
  stored: StoredSubSlotState | undefined,
  utteranceById: Map<string, ConversationUtterance>,
): EvidenceReference[] {
  if (!stored || stored.evidenceUtteranceIds.length === 0) return [];

  return stored.evidenceUtteranceIds
    .map((id) => utteranceById.get(id))
    .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
    .map((utterance) => ({
      themeId: theme.id,
      aspectId: aspect.id,
      evidenceUtteranceId: utterance.id,
      evidenceText: `${SPEAKER_LABELS[utterance.speaker] ?? utterance.speaker}: ${anonymizeACPText(truncate(utterance.text, 160))}`,
      speaker: utterance.speaker,
      sourceTopicId: stored.lastUpdatedTopicId ?? theme.id,
      inferred: false,
    }));
}

function getAspectStatusFromSubSlot(
  stored: StoredSubSlotState | undefined,
  evidence: EvidenceReference[],
): AspectStatus {
  if (!stored) return "empty";
  if (stored.completion === "complete" && evidence.length > 0) return "filled";
  if (stored.completion === "partial" || evidence.length > 0) return "partial";
  return "empty";
}

function getThemeResponseStateFromAspects(
  aspects: ThemeMinutesItem["aspects"],
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  slots: AcpSlotState[],
): ResponseState {
  if (aspects.some((aspect) => aspect.status === "filled" || aspect.status === "partial")) {
    return "expressed";
  }

  return getResearchThemeResponseState(theme, slots);
}

function buildThemeSummaryFromAspects(
  theme: (typeof ALL_RESEARCH_THEMES)[number],
  aspects: ThemeMinutesItem["aspects"],
  slots: AcpSlotState[],
) {
  const expressed = aspects
    .filter((aspect) => aspect.evidence.length > 0)
    .map((aspect) => aspect.label);

  if (expressed.length > 0) {
    return `${expressed.slice(0, 5).join("、")}について本人の発言または本人同意のある要約が確認されています。`;
  }

  return getResearchThemeSummary(theme, slots) || "現時点では明確な確認ができていません。";
}

function buildPersonCenteredOverview(themes: ThemeMinutesItem[]) {
  const evidence = collectRepresentativeEvidence(themes).slice(0, 4);

  if (evidence.length === 0) {
    return "今回の記録からは、本人の価値観や意思決定方針として確定できる発言はまだ限定的です。次回、本人へ具体的に確認してください。";
  }

  return evidence.join("\n");
}

function collectRepresentativeEvidence(themes: ThemeMinutesItem[]) {
  const values = themes.flatMap((theme) =>
    theme.aspects.flatMap((aspect) =>
      aspect.evidence.map((evidence) => `${theme.title} / ${aspect.label}: ${evidence.evidenceText}`),
    ),
  );

  return [...new Set(values)].slice(0, 12);
}

function formatAspectStatus(status: AspectStatus) {
  switch (status) {
    case "filled":
      return "本人が明確に表明";
    case "partial":
      return "部分的に確認";
    default:
      return "未確認";
  }
}

function formatResponseState(state: ResponseState) {
  switch (state) {
    case "expressed":
      return "本人の考えを確認";
    case "no_preference":
      return "特に希望なしと確認";
    case "not_considered":
      return "現時点では未決定";
    case "difficulty_verbalizing":
      return "言語化が難しい";
    case "declined":
      return "今は話したくない";
    case "uncertain":
      return "部分的に確認";
    default:
      return "未確認";
  }
}

function formatJapaneseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

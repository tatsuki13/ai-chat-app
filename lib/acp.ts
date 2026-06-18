export type Speaker = "caregiver" | "elder";
export type SlotStatus = "filled" | "partial" | "empty";
export type ActionButtonType =
  | "update_memo"
  | "question_suggestions"
  | "topic_shift"
  | "exit_check";

export type Utterance = {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: string;
};

export type AcpSlotDefinition = {
  id: string;
  label: string;
  priority: number;
  keywords: string[];
  question: string;
  topicShift: string;
};

export type AcpSlotRecord = {
  id: string;
  label: string;
  status: SlotStatus;
  summary: string;
  evidence_utterance: string;
  confidence: number;
  updatedAt: string | null;
};

export type SuggestionKind = "question" | "topic_shift" | "exit_check";

export type AiSuggestion = {
  id: string;
  kind: SuggestionKind;
  targetSlotId?: string;
  targetSlotLabel?: string;
  title: string;
  text: string;
  bridge?: string;
  adopted?: boolean | null;
};

export type ExitJudgement = {
  decision: "終了してよい" | "もう少し確認した方がよい";
  reason: string;
  remainingImportantSlots: string[];
  keySlotFilledCount: number;
  keySlotCount: number;
};

export type ResearchActionLog = {
  id: string;
  timestamp: string;
  button_type: ActionButtonType;
  button_label: string;
  unfilled_slots: Array<{
    slot_id: string;
    label: string;
    status: SlotStatus;
  }>;
  ai_suggestions: AiSuggestion[];
  exit_judgement?: ExitJudgement;
  adopted: boolean | null;
};

export type ResearchSnapshot = {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  full_utterance_log: Utterance[];
  acp_slots: AcpSlotRecord[];
  markdown_minutes: string;
  button_logs: ResearchActionLog[];
};

export const ACTION_BUTTON_LABELS: Record<ActionButtonType, string> = {
  update_memo: "議事録を更新",
  question_suggestions: "追加質問候補",
  topic_shift: "話題切り替え",
  exit_check: "終了確認",
};

export const ACP_SLOT_DEFINITIONS: AcpSlotDefinition[] = [
  {
    id: "values",
    label: "本人が大切にしている価値観",
    priority: 1,
    keywords: [
      "大切",
      "価値",
      "自分らし",
      "生きがい",
      "楽しみ",
      "安心",
      "譲れない",
      "好き",
      "家族",
      "友人",
      "趣味",
      "信仰",
    ],
    question:
      "普段の暮らしの中で、これだけは大切にしたいと思うことはありますか？",
    topicShift:
      "ここまで大切にされていることを伺えたので、次は今後の暮らし方について少し伺ってもよろしいですか？",
  },
  {
    id: "future_living",
    label: "今後の生活希望",
    priority: 1,
    keywords: [
      "生活",
      "暮らし",
      "今後",
      "これから",
      "自宅",
      "家",
      "施設",
      "一人暮らし",
      "近く",
      "地域",
      "続けたい",
    ],
    question:
      "これからの生活で、できるだけ続けたい暮らし方や過ごし方はありますか？",
    topicShift:
      "今後の暮らし方のお話に続けて、手助けが必要になった時の希望も確認してよろしいですか？",
  },
  {
    id: "care_preferences",
    label: "介護に関する希望",
    priority: 1,
    keywords: [
      "介護",
      "手助け",
      "サポート",
      "支援",
      "世話",
      "入浴",
      "食事",
      "排泄",
      "買い物",
      "訪問",
      "ヘルパー",
      "負担",
    ],
    question:
      "もし日常生活で手助けが必要になった場合、どのようなサポートなら受け入れやすいですか？",
    topicShift:
      "生活の支援について整理できてきたので、医療や治療についてのお考えも少し伺ってよろしいですか？",
  },
  {
    id: "medical_treatment",
    label: "医療処置に関する希望",
    priority: 1,
    keywords: [
      "医療",
      "治療",
      "処置",
      "入院",
      "手術",
      "点滴",
      "薬",
      "痛み",
      "苦痛",
      "医師",
      "病院",
    ],
    question:
      "病気が重くなった時、治療や医療処置について大切にしたいことはありますか？",
    topicShift:
      "医療の希望に関わる大事な点として、延命治療についてのお考えも確認してよろしいですか？",
  },
  {
    id: "life_prolonging",
    label: "延命治療に関する考え",
    priority: 1,
    keywords: [
      "延命",
      "人工呼吸",
      "心臓マッサージ",
      "蘇生",
      "胃ろう",
      "管",
      "最期",
      "自然",
      "苦しい",
      "長く",
      "命",
    ],
    question:
      "延命治療について、受けたいことや避けたいことを今の時点で考えている範囲で教えていただけますか？",
    topicShift:
      "治療についてのお考えを伺えたので、最期をどこで迎えたいかという希望にも触れてよろしいですか？",
  },
  {
    id: "end_of_life_place",
    label: "最期を迎えたい場所",
    priority: 1,
    keywords: [
      "最期",
      "最後",
      "看取り",
      "亡くなる",
      "迎えたい",
      "場所",
      "自宅",
      "病院",
      "施設",
      "ホスピス",
    ],
    question:
      "もし最期の時期を考えるとしたら、どこで、誰と過ごせると安心だと思いますか？",
    topicShift:
      "過ごしたい場所のお話に関連して、代わりに意思決定をお願いしたい方も確認してよろしいですか？",
  },
  {
    id: "surrogate",
    label: "代理意思決定者",
    priority: 1,
    keywords: [
      "代理",
      "意思決定",
      "判断",
      "決めて",
      "相談",
      "娘",
      "息子",
      "配偶者",
      "夫",
      "妻",
      "兄弟",
      "姉妹",
      "任せる",
    ],
    question:
      "ご自身で判断しにくい時、医療や介護のことを誰に相談して決めてほしいですか？",
    topicShift:
      "誰に相談したいかが見えてきたので、ご家族に伝えておきたいことも伺ってよろしいですか？",
  },
  {
    id: "family_message",
    label: "家族に伝えておきたいこと",
    priority: 2,
    keywords: [
      "伝えたい",
      "言っておきたい",
      "ありがとう",
      "お願い",
      "迷惑",
      "負担",
    ],
    question:
      "ご家族に、今のうちに伝えておきたいことやお願いしておきたいことはありますか？",
    topicShift:
      "ご家族への思いを伺ったので、今感じている不安や心配も確認してよろしいですか？",
  },
  {
    id: "anxiety",
    label: "不安・心配",
    priority: 2,
    keywords: [
      "不安",
      "心配",
      "怖い",
      "困る",
      "迷う",
      "負担",
      "迷惑",
      "お金",
      "痛み",
      "孤独",
      "一人",
    ],
    question:
      "これからのことで、不安に感じていることや心配なことはありますか？",
    topicShift:
      "不安な点も整理できたので、まだ決めきれていないことが残っているか確認してよろしいですか？",
  },
  {
    id: "unresolved",
    label: "未解決の課題",
    priority: 2,
    keywords: [
      "未解決",
      "決まっていない",
      "まだ",
      "迷って",
      "確認",
      "課題",
      "問題",
      "分からない",
      "わからない",
    ],
    question:
      "今日の時点で、まだ決めきれないことや今後相談しておきたいことはありますか？",
    topicShift:
      "最後に、今日話した内容の中で後で確認したいことが残っていないか見直してもよろしいですか？",
  },
];

const KEY_SLOT_IDS = [
  "values",
  "future_living",
  "care_preferences",
  "medical_treatment",
  "life_prolonging",
  "end_of_life_place",
  "surrogate",
];

const PREFERENCE_HINTS = [
  "したい",
  "してほしい",
  "希望",
  "大切",
  "嫌",
  "避けたい",
  "お願い",
  "任せたい",
  "任せる",
  "ほしい",
  "思う",
  "安心",
  "決めている",
  "続けたい",
  "受けたい",
  "受けたくない",
];

const UNCERTAINTY_HINTS = [
  "わからない",
  "分からない",
  "まだ",
  "決めていない",
  "迷って",
  "考えたことがない",
  "なんとも",
  "どちらとも",
];

export function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptySlots(now = new Date().toISOString()): AcpSlotRecord[] {
  return ACP_SLOT_DEFINITIONS.map((slot) => ({
    id: slot.id,
    label: slot.label,
    status: "empty",
    summary: "未確認",
    evidence_utterance: "",
    confidence: 0,
    updatedAt: now,
  }));
}

export function getSlotDefinition(slotId: string) {
  return ACP_SLOT_DEFINITIONS.find((slot) => slot.id === slotId);
}

export function analyzeTranscript(transcript: Utterance[]): AcpSlotRecord[] {
  const now = new Date().toISOString();

  return ACP_SLOT_DEFINITIONS.map((slot) => analyzeSlot(slot, transcript, now));
}

export function getUnfilledSlots(slots: AcpSlotRecord[]) {
  return slots.filter((slot) => slot.status === "empty" || slot.status === "partial");
}

export function calculateCompletionRate(slots: AcpSlotRecord[]) {
  if (slots.length === 0) return 0;

  const score = slots.reduce((total, slot) => {
    if (slot.status === "filled") return total + 1;
    if (slot.status === "partial") return total + 0.5;
    return total;
  }, 0);

  return score / slots.length;
}

export function inferCurrentTopic(slots: AcpSlotRecord[], transcript: Utterance[]) {
  if (transcript.length === 0) return "ACP対話の導入";

  const recentText = transcript
    .slice(-4)
    .map((utterance) => utterance.text)
    .join(" ");

  const matchedDefinition = [...ACP_SLOT_DEFINITIONS]
    .sort((a, b) => getKeywordScore(recentText, b) - getKeywordScore(recentText, a))
    .find((definition) => getKeywordScore(recentText, definition) > 0);

  if (matchedDefinition) return matchedDefinition.label;

  const partialSlot = slots.find((slot) => slot.status === "partial");
  if (partialSlot) return partialSlot.label;

  const emptySlot = slots.find((slot) => slot.status === "empty");
  return emptySlot?.label ?? "ACP対話のまとめ";
}

export function createQuestionCandidates(
  slots: AcpSlotRecord[],
  transcript: Utterance[],
): AiSuggestion[] {
  return prioritizeSlots(slots, transcript)
    .slice(0, 3)
    .map((slot) => {
      const definition = getSlotDefinition(slot.id);

      return {
        id: createId("question"),
        kind: "question",
        targetSlotId: slot.id,
        targetSlotLabel: slot.label,
        title: slot.label,
        text: definition?.question ?? `${slot.label}について、もう少し伺ってもよろしいですか？`,
        adopted: null,
      };
    });
}

export function createTopicShiftSuggestions(
  slots: AcpSlotRecord[],
  transcript: Utterance[],
): AiSuggestion[] {
  const recentSummary = getRecentElderSummary(transcript);

  return prioritizeSlots(slots, transcript)
    .slice(0, 2)
    .map((slot) => {
      const definition = getSlotDefinition(slot.id);
      const bridge = recentSummary
        ? `ここまで「${recentSummary}」というお話が出ていました。`
        : "ここまでのお話を一度受け止めたうえで、";

      return {
        id: createId("topic"),
        kind: "topic_shift",
        targetSlotId: slot.id,
        targetSlotLabel: slot.label,
        title: slot.label,
        bridge,
        text: `${bridge}${definition?.topicShift ?? `${slot.label}について少し伺ってもよろしいですか？`}`,
        adopted: null,
      };
    });
}

export function createExitJudgement(slots: AcpSlotRecord[]): ExitJudgement {
  const keySlots = slots.filter((slot) => KEY_SLOT_IDS.includes(slot.id));
  const keyFilledCount = keySlots.filter((slot) => slot.status === "filled").length;
  const importantRemaining = keySlots
    .filter((slot) => slot.status !== "filled")
    .map((slot) => slot.label);
  const criticalEmpty = keySlots.filter(
    (slot) =>
      slot.status === "empty" &&
      ["values", "end_of_life_place", "surrogate"].includes(slot.id),
  );
  const canEnd = keyFilledCount >= 5 && criticalEmpty.length === 0;

  if (canEnd) {
    return {
      decision: "終了してよい",
      reason:
        "主要スロットの多くが埋まっており、価値観・最期の場所・代理意思決定者のいずれも空欄ではありません。残りは次回確認でも扱えます。",
      remainingImportantSlots: importantRemaining,
      keySlotFilledCount: keyFilledCount,
      keySlotCount: keySlots.length,
    };
  }

  const reason =
    criticalEmpty.length > 0
      ? `重要度の高い項目（${criticalEmpty.map((slot) => slot.label).join("、")}）が未確認です。`
      : "主要スロットの充足がまだ十分ではありません。";

  return {
    decision: "もう少し確認した方がよい",
    reason,
    remainingImportantSlots: importantRemaining,
    keySlotFilledCount: keyFilledCount,
    keySlotCount: keySlots.length,
  };
}

export function createMemoMarkdown(slots: AcpSlotRecord[], transcript: Utterance[]) {
  const lines = [
    "# ACP議事録",
    "",
    `作成日時: ${new Date().toISOString()}`,
    `発話数: ${transcript.length}`,
    "",
    "## スロット別整理",
    "",
  ];

  slots.forEach((slot) => {
    lines.push(`### ${slot.label}`);
    lines.push(`- 状態: ${slot.status}`);
    lines.push(`- 要約: ${slot.summary}`);
    lines.push(`- 根拠発話: ${slot.evidence_utterance || "未確認"}`);
    lines.push("");
  });

  lines.push("## 対話ログ");
  lines.push("");
  transcript.forEach((utterance) => {
    lines.push(
      `- ${utterance.timestamp} ${utterance.speaker === "caregiver" ? "介護者" : "高齢者役"}: ${utterance.text}`,
    );
  });

  return lines.join("\n");
}

export function createMemoJson(
  transcript: Utterance[],
  slots: AcpSlotRecord[],
  buttonLogs: ResearchActionLog[] = [],
) {
  return {
    generated_at: new Date().toISOString(),
    utterance_count: transcript.length,
    acp_slots: slots.map((slot) => ({
      slot_id: slot.id,
      slot_name: slot.label,
      status: slot.status,
      summary: slot.summary,
      evidence_utterance: slot.evidence_utterance,
    })),
    full_utterance_log: transcript,
    button_logs: buttonLogs,
  };
}

export function createResearchSnapshot(input: {
  sessionId: string;
  startedAt: string;
  transcript: Utterance[];
  slots: AcpSlotRecord[];
  actionLogs: ResearchActionLog[];
}): ResearchSnapshot {
  return {
    sessionId: input.sessionId,
    startedAt: input.startedAt,
    updatedAt: new Date().toISOString(),
    full_utterance_log: input.transcript,
    acp_slots: input.slots,
    markdown_minutes: createMemoMarkdown(input.slots, input.transcript),
    button_logs: input.actionLogs,
  };
}

export function createActionLog(input: {
  buttonType: ActionButtonType;
  slots: AcpSlotRecord[];
  suggestions?: AiSuggestion[];
  exitJudgement?: ExitJudgement;
}): ResearchActionLog {
  return {
    id: createId("action"),
    timestamp: new Date().toISOString(),
    button_type: input.buttonType,
    button_label: ACTION_BUTTON_LABELS[input.buttonType],
    unfilled_slots: getUnfilledSlots(input.slots).map((slot) => ({
      slot_id: slot.id,
      label: slot.label,
      status: slot.status,
    })),
    ai_suggestions: input.suggestions ?? [],
    exit_judgement: input.exitJudgement,
    adopted: null,
  };
}

function analyzeSlot(
  slot: AcpSlotDefinition,
  transcript: Utterance[],
  now: string,
): AcpSlotRecord {
  const candidates = transcript
    .map((utterance, index) => ({
      utterance,
      index,
      score: getUtteranceSlotScore(utterance, index, slot, transcript),
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const elderCandidates = candidates.filter((candidate) => candidate.utterance.speaker === "elder");

  if (elderCandidates.length > 0) {
    const selected = elderCandidates.slice(0, 2);
    const combinedText = selected.map((candidate) => candidate.utterance.text).join(" / ");
    const hasPreference = PREFERENCE_HINTS.some((hint) => combinedText.includes(hint));
    const hasUncertainty = UNCERTAINTY_HINTS.some((hint) => combinedText.includes(hint));
    const informativeLength = compactText(combinedText).length >= 24;
    const status: SlotStatus = hasUncertainty && !hasPreference ? "partial" : hasPreference || informativeLength ? "filled" : "partial";
    const confidence = Math.min(0.95, selected[0].score / 7);

    return {
      id: slot.id,
      label: slot.label,
      status,
      summary: summarizeEvidence(combinedText, status),
      evidence_utterance: formatEvidence(selected[0].utterance),
      confidence,
      updatedAt: now,
    };
  }

  const caregiverQuestion = candidates.find(
    (candidate) => candidate.utterance.speaker === "caregiver",
  );

  if (caregiverQuestion) {
    return {
      id: slot.id,
      label: slot.label,
      status: "partial",
      summary: "介護者から確認が出ているが、本人の回答はまだ明確に記録されていない。",
      evidence_utterance: formatEvidence(caregiverQuestion.utterance),
      confidence: 0.35,
      updatedAt: now,
    };
  }

  return {
    id: slot.id,
    label: slot.label,
    status: "empty",
    summary: "未確認",
    evidence_utterance: "",
    confidence: 0,
    updatedAt: now,
  };
}

function getUtteranceSlotScore(
  utterance: Utterance,
  index: number,
  slot: AcpSlotDefinition,
  transcript: Utterance[],
) {
  if (slot.id === "end_of_life_place" && !hasEndOfLifePlaceContext(utterance, index, transcript)) {
    return 0;
  }

  let score = getKeywordScore(utterance.text, slot);

  if (utterance.speaker === "elder") score += 0.5;
  if (utterance.speaker === "caregiver" && isQuestionLike(utterance.text)) score += 0.5;

  const previous = transcript[index - 1];
  if (
    utterance.speaker === "elder" &&
    previous?.speaker === "caregiver" &&
    getKeywordScore(previous.text, slot) > 0
  ) {
    score += 3;
  }

  const twoBack = transcript[index - 2];
  if (
    utterance.speaker === "elder" &&
    twoBack?.speaker === "caregiver" &&
    getKeywordScore(twoBack.text, slot) > 1
  ) {
    score += 1;
  }

  if (PREFERENCE_HINTS.some((hint) => utterance.text.includes(hint))) score += 0.5;
  if (compactText(utterance.text).length < 4) score -= 1;

  return score;
}

function hasEndOfLifePlaceContext(
  utterance: Utterance,
  index: number,
  transcript: Utterance[],
) {
  const contextText = [
    utterance.text,
    transcript[index - 1]?.text ?? "",
    transcript[index - 2]?.text ?? "",
  ].join(" ");

  return /最期|最後|看取り|亡くなる|迎えたい|終末期|ホスピス/.test(contextText);
}

function prioritizeSlots(slots: AcpSlotRecord[], transcript: Utterance[]) {
  const recentText = transcript
    .slice(-5)
    .map((utterance) => utterance.text)
    .join(" ");

  return getUnfilledSlots(slots)
    .map((slot) => {
      const definition = getSlotDefinition(slot.id);
      const flowScore = definition ? getNaturalFlowScore(recentText, definition) : 0;
      const statusScore = slot.status === "partial" ? 4 : 0;
      const priorityScore = definition ? 10 - definition.priority * 2 : 0;

      return {
        slot,
        score: flowScore + statusScore + priorityScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.slot);
}

function getNaturalFlowScore(text: string, definition: AcpSlotDefinition) {
  let score = getKeywordScore(text, definition);

  const relatedGroups = [
    {
      hints: ["家族", "娘", "息子", "妻", "夫", "迷惑"],
      slots: ["surrogate", "family_message", "anxiety"],
    },
    {
      hints: ["医療", "治療", "病院", "痛み", "延命"],
      slots: ["medical_treatment", "life_prolonging", "end_of_life_place"],
    },
    {
      hints: ["生活", "暮らし", "自宅", "家", "施設"],
      slots: ["future_living", "care_preferences", "end_of_life_place"],
    },
    {
      hints: ["不安", "心配", "困る", "怖い"],
      slots: ["anxiety", "unresolved"],
    },
  ];

  relatedGroups.forEach((group) => {
    const hasHint = group.hints.some((hint) => text.includes(hint));
    if (hasHint && group.slots.includes(definition.id)) score += 3;
  });

  return score;
}

function getKeywordScore(text: string, slot: AcpSlotDefinition) {
  const normalizedText = normalizeText(text);

  return slot.keywords.reduce((score, keyword) => {
    return normalizedText.includes(normalizeText(keyword)) ? score + 1 : score;
  }, 0);
}

function isQuestionLike(text: string) {
  return /[?？]|ですか|ますか|でしょうか|ありますか|よろしいですか/.test(text);
}

function summarizeEvidence(text: string, status: SlotStatus) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const short = truncate(trimmed, 96);

  if (status === "partial") {
    return `本人の発言はあるが、希望や条件はまだ一部のみ確認: ${short}`;
  }

  return short;
}

function formatEvidence(utterance: Utterance) {
  const speakerLabel = utterance.speaker === "caregiver" ? "介護者" : "高齢者役";
  return `${speakerLabel}: ${truncate(utterance.text, 120)}`;
}

function getRecentElderSummary(transcript: Utterance[]) {
  const recent = [...transcript].reverse().find((utterance) => utterance.speaker === "elder");
  if (!recent) return "";

  return truncate(recent.text.replace(/\s+/g, " ").trim(), 34);
}

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, "");
}

function compactText(text: string) {
  return text.replace(/\s+/g, "");
}

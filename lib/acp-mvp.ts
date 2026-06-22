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
  "未解決課題",
] as const;

export type AcpSlotName = (typeof ACP_SLOT_NAMES)[number];
export type SlotStatus = "empty" | "partial" | "filled";
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
    utterances: ConversationUtterance[];
    slots: AcpSlotState[];
    summary: string;
  };
};

export const BUTTON_LABELS: Record<ButtonType, string> = {
  next_question: "質問する",
  switch_topic: "話題を変える",
  check_end: "終了確認",
  update_slots: "議事録更新",
};

export const BUTTON_TYPES = Object.keys(BUTTON_LABELS) as ButtonType[];

export const SPEAKER_LABELS: Record<string, string> = {
  caregiver: "介護者",
  elder: "本人",
  family: "家族",
};

export function createEmptySlotStates(): AcpSlotState[] {
  return ACP_SLOT_NAMES.map((slotName) => ({
    slot_name: slotName,
    status: "empty",
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
        status: "empty",
        summary: "未確認",
        evidence_utterance: "",
      }
    );
  });
}

export function normalizeSlotStatus(value: unknown): SlotStatus {
  return value === "partial" || value === "filled" ? value : "empty";
}

export function isButtonType(value: unknown): value is ButtonType {
  return typeof value === "string" && BUTTON_TYPES.includes(value as ButtonType);
}

export function getUnfilledSlots(slots: AcpSlotState[]) {
  return slots.filter((slot) => slot.status === "empty" || slot.status === "partial");
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
): FinalMinutesResult {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# ACP対話 議事録",
    "",
    `生成日時: ${generatedAt}`,
    `発話数: ${utterances.length}`,
    "",
    "## ACPスロット",
    "",
  ];

  slots.forEach((slot) => {
    lines.push(`### ${slot.slot_name}`);
    lines.push(`- status: ${slot.status}`);
    lines.push(`- summary: ${slot.summary || "未確認"}`);
    lines.push(`- evidence_utterance: ${slot.evidence_utterance || "なし"}`);
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
      utterances,
      slots,
      summary: "会話ログとACPスロット状態から生成した議事録です。",
    },
  };
}

export function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

export const DISCUSSION_TOPIC = {
  title: "これからの暮らしと大切にしたいこと",
  description:
    "生活の希望、介護や医療への考え、家族に伝えておきたいことを、無理のない範囲で話し合います。",
};

export const DISCUSSION_TOPICS = [
  {
    slot_name: "今後の生活希望",
    title: "最近の生活と、これからも続けたいこと",
    opening_prompt:
      "最近の生活で、これからも続けたいことは何ですか。\nお二人で、話しやすいところから話してみてください。",
  },
  {
    slot_name: "価値観",
    title: "大切にしたいこと",
    opening_prompt:
      "普段の暮らしの中で、これだけは大切にしたいと思うことはありますか。",
  },
  {
    slot_name: "介護希望",
    title: "手助けが必要になった時の希望",
    opening_prompt:
      "もし暮らしの中で手助けが必要になった場合、どのような支援なら受け入れやすいですか。",
  },
  {
    slot_name: "医療処置への希望",
    title: "医療や治療について大切にしたいこと",
    opening_prompt:
      "治療や医療を受ける場面で、大切にしたいことや避けたいことはありますか。",
  },
  {
    slot_name: "代理意思決定者",
    title: "相談して決めてほしい人",
    opening_prompt:
      "ご自身で判断しにくい時、医療や介護のことを誰に相談して決めてほしいですか。",
  },
  {
    slot_name: "家族に伝えたいこと",
    title: "家族に伝えておきたいこと",
    opening_prompt:
      "ご家族に、今のうちに伝えておきたいことやお願いしておきたいことはありますか。",
  },
  {
    slot_name: "不安・心配",
    title: "不安や心配",
    opening_prompt:
      "これからのことで、不安に感じていることや心配なことはありますか。",
  },
  {
    slot_name: "延命治療への考え",
    title: "命に関わる治療についての考え",
    opening_prompt:
      "もし命に関わる状態になった時、延命治療について今の時点で考えていることはありますか。",
  },
  {
    slot_name: "最期を迎えたい場所",
    title: "最期の時期を過ごしたい場所",
    opening_prompt:
      "もし最期の時期を考えるとしたら、どこで誰と過ごせると安心だと思いますか。",
  },
  {
    slot_name: "未解決課題",
    title: "まだ決めきれないこと",
    opening_prompt:
      "今日話した中で、まだ決めきれないことや後で確認したいことはありますか。",
  },
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
  session?: { id?: string; participant_code?: string | null },
): FinalMinutesResult {
  const generatedAt = new Date().toISOString();
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
      session,
      discussion_topic: DISCUSSION_TOPIC,
      utterances,
      slots,
      summary: "会話ログとACPスロット状態から生成した議事録です。",
    },
  };
}

export function toJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

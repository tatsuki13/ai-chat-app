import type { AcpSlotRecord, Utterance } from "./acp";

export type AcpPromptMessage = {
  role: "system" | "user";
  content: string;
};

const SYSTEM_POLICY = [
  "あなたはACP対話支援AIです。",
  "AIは自律的に会話へ介入しません。",
  "介護者がボタンを押した場合のみ、議事録更新、追加質問候補、話題切り替え候補、終了判断を返します。",
  "高齢者役へ直接語りかけず、介護者が自然に使える文にしてください。",
  "研究分析用に、必ずJSONで返してください。",
].join("\n");

export function buildMemoPrompt(transcript: Utterance[]): AcpPromptMessage[] {
  return [
    { role: "system", content: SYSTEM_POLICY },
    {
      role: "user",
      content: [
        "次のACP対話ログを、指定スロットごとに整理してください。",
        "各スロットは filled / partial / empty、summary、evidence_utterance を返してください。",
        "JSON schema: { acp_slots: [{ slot_id, slot_name, status, summary, evidence_utterance }] }",
        "",
        renderTranscript(transcript),
      ].join("\n"),
    },
  ];
}

export function buildQuestionSuggestionPrompt(
  transcript: Utterance[],
  slots: AcpSlotRecord[],
): AcpPromptMessage[] {
  return [
    { role: "system", content: SYSTEM_POLICY },
    {
      role: "user",
      content: [
        "未充足スロットから、対話の流れに合う追加質問候補を3つ作ってください。",
        "介護者が高齢者役に自然に聞ける文体にしてください。",
        "JSON schema: { suggestions: [{ targetSlotId, targetSlotLabel, text }] }",
        "",
        "現在のスロット:",
        JSON.stringify(slots, null, 2),
        "",
        "対話ログ:",
        renderTranscript(transcript),
      ].join("\n"),
    },
  ];
}

export function buildTopicShiftPrompt(
  transcript: Utterance[],
  slots: AcpSlotRecord[],
): AcpPromptMessage[] {
  return [
    { role: "system", content: SYSTEM_POLICY },
    {
      role: "user",
      content: [
        "次に移るべき話題候補を作ってください。",
        "唐突にならない短い橋渡し文を含めてください。",
        "JSON schema: { suggestions: [{ targetSlotId, targetSlotLabel, bridge, text }] }",
        "",
        "現在のスロット:",
        JSON.stringify(slots, null, 2),
        "",
        "対話ログ:",
        renderTranscript(transcript),
      ].join("\n"),
    },
  ];
}

export function buildExitJudgementPrompt(slots: AcpSlotRecord[]): AcpPromptMessage[] {
  return [
    { role: "system", content: SYSTEM_POLICY },
    {
      role: "user",
      content: [
        "ACP対話を終了してよいか判定してください。",
        "主要スロットが十分に埋まっているか、未確認だが重要な項目が残っているかを理由付きで示してください。",
        "JSON schema: { decision: '終了してよい' | 'もう少し確認した方がよい', reason, remainingImportantSlots: [] }",
        "",
        "現在のスロット:",
        JSON.stringify(slots, null, 2),
      ].join("\n"),
    },
  ];
}

function renderTranscript(transcript: Utterance[]) {
  return transcript
    .map((utterance) => {
      const speaker = utterance.speaker === "caregiver" ? "caregiver" : "elder";
      return `[${utterance.timestamp}] ${speaker}: ${utterance.text}`;
    })
    .join("\n");
}

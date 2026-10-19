import type { ConversationUtterance, QuestionPolicyMetadata, QuestionType, StoredSubSlotState } from "../acp-mvp";

export const QUESTION_POLICY_VERSION = "pre-acp-question-v2";
export const DIALOGUE_PROTOCOL_VERSION = "pre-acp-theme-opening-v2";

export type QuestionHistoryItem = {
  content: string;
  topicId?: string | null;
  generatedAt?: string | null;
  targetMainSlotId?: string | null;
  targetSubSlotId?: string | null;
  questionPurpose?: string | null;
  questionType?: QuestionType | null;
  evidenceUtteranceIds?: string[];
  supportKey?: string | null;
  supportForUtteranceId?: string | null;
};

export function participantSpeaker(value: string) {
  if (value === "elder" || value === "A") return "elder";
  if (value === "caregiver" || value === "B") return "caregiver";
  return null;
}

export function currentParticipantUtterances(utterances: ConversationUtterance[], topicId: string) {
  return utterances.filter((item) => item.topic_id === topicId && item.text.trim() && participantSpeaker(item.original_speaker ?? item.speaker));
}

export function normalizeQuestionText(text: string) {
  return text.toLowerCase().replace(/[\s　。、．.！!？?「」『』"'`]/g, "");
}

export function repeatsQuestion(question: string, previous: string[]) {
  const normalized = normalizeQuestionText(question);
  return !normalized || previous.some((text) => {
    const other = normalizeQuestionText(text);
    return other && (normalized.includes(other) || other.includes(normalized));
  });
}

export function responseBarrier(text: string): "declined" | "held" | "difficulty" | null {
  if (/話したくない|話したくありません|答えたくない|答えたくありません|聞かないで|考えたくない|やめて|話すのは.*(?:嫌|いや)/.test(text)) return "declined";
  if (/今は.*(?:決められ|決めたく|保留)|まだ.*決められ|今は.*(?:話せ|話さ)|保留に|あとで|後で|今度に/.test(text)) return "held";
  if (/わからない|分からない|分かんない|わかりません|分かりません|思いつかない|思いつきません|浮かばない|考えたこと.*ない|言葉.*(?:出ない|出ません|難しい)|言語化.*難しい|うまく言えない|言えません|経験したこと.*ない/.test(text)) return "difficulty";
  return null;
}

// This is a conservative guard over explicit text, not a semantic classifier.
// A support key follows the preceding question's subject across repeated difficulties.
export function buildDialogueGuards(utterances: ConversationUtterance[], history: QuestionHistoryItem[], topicId: string, states: StoredSubSlotState[] = []) {
  const topicHistory = history.filter((item) => item.topicId === topicId || item.targetMainSlotId === topicId);
  const blockedEvidence = new Set<string>();
  const blockedSlots = new Set<string>();
  const difficulties: Array<{ utteranceId: string; key: string; slotId: string | null; supported: boolean }> = [];
  for (const utterance of currentParticipantUtterances(utterances, topicId)) {
    if (!utterance.id || participantSpeaker(utterance.original_speaker ?? utterance.speaker) !== "elder") continue;
    const related = states.filter((item) => item.mainSlotId === topicId && item.evidenceUtteranceIds.includes(utterance.id!));
    const barrier = responseBarrier(utterance.text) ?? (related.some((item) => item.responseState === "declined") ? "declined"
      : related.some((item) => item.responseState === "not_considered" || item.responseState === "unable_to_verbalize") ? "difficulty" : null);
    if (!barrier) continue;
    const at = utterance.created_at ?? utterance.createdAt;
    const preceding = at ? topicHistory.filter((item) => item.generatedAt && item.generatedAt <= at).at(-1) : undefined;
    const key = preceding?.supportKey ?? (preceding?.targetSubSlotId ? `${topicId}:${preceding.targetSubSlotId}` : preceding?.evidenceUtteranceIds?.length ? `${topicId}:${[...preceding.evidenceUtteranceIds].sort().join(",")}` : `${topicId}:${utterance.id}`);
    const supported = topicHistory.some((item) => item.supportKey === key);
    if (barrier === "declined" || barrier === "held" || supported) {
      blockedEvidence.add(utterance.id);
      for (const id of preceding?.evidenceUtteranceIds ?? []) blockedEvidence.add(id);
      if (!preceding) {
        const previous = currentParticipantUtterances(utterances, topicId)
          .slice(0, currentParticipantUtterances(utterances, topicId).indexOf(utterance))
          .filter((item) => participantSpeaker(item.original_speaker ?? item.speaker) === "elder" && !responseBarrier(item.text)).at(-1);
        if (previous?.id) blockedEvidence.add(previous.id);
      }
      if (preceding?.targetSubSlotId) blockedSlots.add(preceding.targetSubSlotId);
      for (const state of related) blockedSlots.add(state.subSlotId);
    }
    if (barrier === "difficulty") difficulties.push({ utteranceId: utterance.id, key, slotId: preceding?.targetSubSlotId ?? null, supported });
  }
  return { blockedEvidence: [...blockedEvidence], blockedSlots: [...blockedSlots], difficulties };
}

export class QuestionGenerationError extends Error {
  constructor(public readonly reason: string, public readonly policy: QuestionPolicyMetadata) {
    super(`ai_question_generation_failed:${reason}`);
    this.name = "QuestionGenerationError";
  }
}

// Only an explicitly classified prefix may move the persistent cursor.
export function classifiedPrefix<T extends { id?: string }>(utterances: T[], classifiedIds: string[]) {
  const classified = new Set(classifiedIds);
  const prefix: T[] = [];
  for (const utterance of utterances) {
    if (!utterance.id || !classified.has(utterance.id)) break;
    prefix.push(utterance);
  }
  return prefix;
}

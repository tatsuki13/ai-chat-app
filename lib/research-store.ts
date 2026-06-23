import type { Prisma } from "@prisma/client";
import { ACP_SLOT_NAMES, type AcpSlotState } from "./acp-mvp";
import { prisma } from "./prisma";

type AppSessionInput = {
  id: string;
  participantCode: string | null;
  condition: string | null;
  startedAt: Date;
  endedAt?: Date | null;
};

type AppUtteranceInput = {
  id: string;
  sessionId: string;
  speaker: string;
  text: string;
  createdAt: Date;
};

type AiSuggestionInput = {
  id: string;
  sessionId: string;
  triggerEventId?: string | null;
  suggestionType: string;
  content: string;
  reasoning?: string | null;
  targetSlot?: string | null;
  adopted?: boolean | null;
  createdAt: Date;
};

const warnedResearchWrites = new Set<string>();

export async function ensureStudySessionForAppSession(session: AppSessionInput) {
  return withResearchWrite("ensureStudySessionForAppSession", async () => {
    return prisma.studySession.upsert({
      where: { appSessionId: session.id },
      update: {
        participantCode: session.participantCode,
        condition: session.condition,
        completedAt: session.endedAt ?? undefined,
      },
      create: {
        appSessionId: session.id,
        participantCode: session.participantCode,
        condition: session.condition,
        startedAt: session.startedAt,
        completedAt: session.endedAt ?? undefined,
        source: "session_app",
        protocolVersion: "acp-mvp-v1",
      },
    });
  });
}

export async function saveStudyUtteranceForAppUtterance(
  utterance: AppUtteranceInput,
) {
  return withResearchWrite("saveStudyUtteranceForAppUtterance", async () => {
    const studySession = await getOrCreateStudySession(utterance.sessionId);
    if (!studySession) return null;

    const saved = await prisma.studyUtterance.upsert({
      where: { appUtteranceId: utterance.id },
      update: {
        speaker: utterance.speaker,
        text: utterance.text,
        timestamp: utterance.createdAt,
        charCount: utterance.text.length,
        wordCount: countWords(utterance.text),
        selfDisclosureCue: hasSelfDisclosureCue(utterance.text),
      },
      create: {
        sessionId: studySession.id,
        appUtteranceId: utterance.id,
        speaker: utterance.speaker,
        text: utterance.text,
        eventType: "human_utterance",
        timestamp: utterance.createdAt,
        charCount: utterance.text.length,
        wordCount: countWords(utterance.text),
        selfDisclosureCue: hasSelfDisclosureCue(utterance.text),
      },
    });

    await refreshStudySessionMetrics(utterance.sessionId);
    return saved;
  });
}

export async function deleteStudyUtteranceForAppUtterance(
  appUtteranceId: string,
  appSessionId: string,
) {
  return withResearchWrite("deleteStudyUtteranceForAppUtterance", async () => {
    await prisma.studyUtterance.deleteMany({
      where: { appUtteranceId },
    });
    await refreshStudySessionMetrics(appSessionId);
  });
}

export async function saveStudyInterventionForAiSuggestion(
  suggestion: AiSuggestionInput,
) {
  return withResearchWrite("saveStudyInterventionForAiSuggestion", async () => {
    const studySession = await getOrCreateStudySession(suggestion.sessionId);
    if (!studySession) return null;

    const saved = await prisma.studyIntervention.upsert({
      where: { appSuggestionId: suggestion.id },
      update: {
        buttonEventId: suggestion.triggerEventId ?? undefined,
        interventionType: suggestion.suggestionType,
        reason: suggestion.suggestionType,
        promptedSlotId: suggestion.targetSlot ?? undefined,
        aiText: suggestion.content,
        aiReasoning: suggestion.reasoning ?? undefined,
        adopted: suggestion.adopted ?? undefined,
        timestamp: suggestion.createdAt,
      },
      create: {
        sessionId: studySession.id,
        appSuggestionId: suggestion.id,
        buttonEventId: suggestion.triggerEventId ?? undefined,
        interventionType: suggestion.suggestionType,
        reason: suggestion.suggestionType,
        promptedSlotId: suggestion.targetSlot ?? undefined,
        aiText: suggestion.content,
        aiReasoning: suggestion.reasoning ?? undefined,
        source: "conversation_ai",
        adopted: suggestion.adopted ?? undefined,
        timestamp: suggestion.createdAt,
      },
    });

    await refreshStudySessionMetrics(suggestion.sessionId);
    return saved;
  });
}

export async function saveStudySlotStatesForSession(
  appSessionId: string,
  slots: AcpSlotState[],
) {
  return withResearchWrite("saveStudySlotStatesForSession", async () => {
    const studySession = await getOrCreateStudySession(appSessionId);
    if (!studySession) return null;

    await ensureAcpSlotDefinitions();

    for (const slot of slots) {
      if (!ACP_SLOT_NAMES.includes(slot.slot_name as (typeof ACP_SLOT_NAMES)[number])) {
        continue;
      }

      const sourceType = inferSlotSourceType(slot);
      const state = await prisma.studySlotState.upsert({
        where: {
          sessionId_slotId: {
            sessionId: studySession.id,
            slotId: String(slot.slot_name),
          },
        },
        update: {
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance || undefined,
          sourceType,
          confidence: inferSlotConfidence(slot, sourceType),
        },
        create: {
          sessionId: studySession.id,
          slotId: String(slot.slot_name),
          status: slot.status,
          summary: slot.summary,
          evidenceUtterance: slot.evidence_utterance || undefined,
          sourceType,
          confidence: inferSlotConfidence(slot, sourceType),
        },
      });

      await prisma.studySlotEvidence.deleteMany({
        where: { slotStateId: state.id },
      });

      if (slot.evidence_utterance) {
        await prisma.studySlotEvidence.create({
          data: {
            slotStateId: state.id,
            evidenceType: sourceType,
            sourceText: slot.evidence_utterance,
          },
        });
      }
    }

    await refreshStudySessionMetrics(appSessionId);
    return studySession;
  });
}

async function getOrCreateStudySession(appSessionId: string) {
  const existing = await prisma.studySession.findUnique({
    where: { appSessionId },
  });
  if (existing) return existing;

  const session = await prisma.session.findUnique({
    where: { id: appSessionId },
  });
  if (!session) return null;

  return ensureStudySessionForAppSession({
    id: session.id,
    participantCode: session.participantCode,
    condition: session.condition,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
  });
}

async function ensureAcpSlotDefinitions() {
  await Promise.all(
    ACP_SLOT_NAMES.map((slotName, index) =>
      prisma.acpSlotDefinition.upsert({
        where: { id: slotName },
        update: {
          label: slotName,
          priority: index + 1,
          active: true,
        },
        create: {
          id: slotName,
          label: slotName,
          category: "acp",
          priority: index + 1,
          active: true,
        },
      }),
    ),
  );
}

async function refreshStudySessionMetrics(appSessionId: string) {
  const studySession = await prisma.studySession.findUnique({
    where: { appSessionId },
    include: {
      interventions: true,
      slotStates: true,
      topicTrials: true,
      utterances: true,
    },
  });
  if (!studySession) return null;

  const timestamps = studySession.utterances
    .map((utterance) => utterance.timestamp.getTime())
    .filter((value) => Number.isFinite(value));
  const totalDurationSec =
    timestamps.length >= 2
      ? Math.max(0, Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 1000))
      : null;
  const filledSlotCount = studySession.slotStates.filter(
    (slot) => slot.status === "filled",
  ).length;
  const elderUtterances = studySession.utterances.filter(
    (utterance) => utterance.speaker === "elder",
  );
  const selfDisclosureCount = elderUtterances.filter(
    (utterance) => utterance.selfDisclosureCue,
  ).length;

  return prisma.sessionMetric.upsert({
    where: { sessionId: studySession.id },
    update: {
      totalTurns: studySession.utterances.length,
      totalWords: studySession.utterances.reduce(
        (total, utterance) => total + (utterance.wordCount ?? countWords(utterance.text)),
        0,
      ),
      totalCharacters: studySession.utterances.reduce(
        (total, utterance) => total + utterance.charCount,
        0,
      ),
      totalDurationSec,
      topicCount: studySession.topicTrials.length,
      interventionCount: studySession.interventions.length,
      silenceInterventionCount: studySession.interventions.filter(
        (intervention) =>
          /silence|沈黙/.test(
            `${intervention.reason ?? ""} ${intervention.interventionType}`,
          ),
      ).length,
      filledSlotCount,
      slotCompletionRate: filledSlotCount / ACP_SLOT_NAMES.length,
      selfDisclosureScore:
        elderUtterances.length > 0 ? selfDisclosureCount / elderUtterances.length : null,
      methodVersion: "initial-runtime-aggregate-v1",
      computedAt: new Date(),
    },
    create: {
      sessionId: studySession.id,
      totalTurns: studySession.utterances.length,
      totalWords: studySession.utterances.reduce(
        (total, utterance) => total + (utterance.wordCount ?? countWords(utterance.text)),
        0,
      ),
      totalCharacters: studySession.utterances.reduce(
        (total, utterance) => total + utterance.charCount,
        0,
      ),
      totalDurationSec,
      topicCount: studySession.topicTrials.length,
      interventionCount: studySession.interventions.length,
      silenceInterventionCount: studySession.interventions.filter(
        (intervention) =>
          /silence|沈黙/.test(
            `${intervention.reason ?? ""} ${intervention.interventionType}`,
          ),
      ).length,
      filledSlotCount,
      slotCompletionRate: filledSlotCount / ACP_SLOT_NAMES.length,
      selfDisclosureScore:
        elderUtterances.length > 0 ? selfDisclosureCount / elderUtterances.length : null,
      methodVersion: "initial-runtime-aggregate-v1",
    },
  });
}

async function withResearchWrite<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    if (!warnedResearchWrites.has(label)) {
      warnedResearchWrites.add(label);
      console.warn(`Research data write skipped (${label})`, error);
    }

    return null;
  }
}

function inferSlotSourceType(slot: AcpSlotState) {
  const text = `${slot.summary} ${slot.evidence_utterance}`;

  if (text.includes("(AI推測)")) return "inferred";
  if (/明示回答|思い当たるものはない|思い当たることはない/.test(text)) {
    return "explicit_none";
  }

  return "direct";
}

function inferSlotConfidence(slot: AcpSlotState, sourceType: string) {
  if (slot.status === "empty") return 0;
  if (sourceType === "inferred") return 0.5;
  if (sourceType === "explicit_none") return 0.8;
  if (slot.status === "filled") return 0.9;
  return 0.6;
}

function hasSelfDisclosureCue(text: string) {
  return /思う|感じ|不安|心配|好き|嫌|大切|希望|したい|してほしい|任せたい|迷う|わからない|分からない|言えない/.test(
    text,
  );
}

function countWords(text: string) {
  const matches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[A-Za-z0-9]+/gu);

  return matches?.length ?? 0;
}

export function toResearchJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

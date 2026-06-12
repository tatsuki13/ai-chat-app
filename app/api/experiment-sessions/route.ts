import { prisma } from "../../../lib/prisma";
import type { Prisma } from "../../../generated/prisma/client";

export const runtime = "nodejs";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return fallback;
}

function asStringOrUndefined(value: unknown) {
  const text = asString(value).trim();

  return text || undefined;
}

function asStringArray(value: unknown) {
  return asArray(value)
    .map((item) => asString(item).trim())
    .filter(Boolean);
}

function asInt(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function asDate(value: unknown) {
  if (!value) return undefined;

  const date = new Date(asString(value));

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mapUtterances(topicLog: Record<string, unknown>) {
  return asArray(topicLog.full_transcript).map((entry) => {
    const item = asObject(entry);
    const text = asString(item.text);

    return {
      speaker: asString(item.speaker, "unknown"),
      text,
      eventType: asString(item.event_type ?? item.eventType, "unknown"),
      timestamp: asDate(item.timestamp) ?? new Date(),
      messageId: asInt(item.message_id ?? item.messageId),
      charCount: asInt(item.char_count ?? item.charCount) ?? text.length,
      rawEntry: asJson(item),
    };
  });
}

function getDeliveredInterventions(topicLog: Record<string, unknown>) {
  const directInterventions = asArray(topicLog.interventions);

  if (directInterventions.length > 0) {
    return directInterventions;
  }

  return asArray(topicLog.silence_events).filter((entry) => {
    const item = asObject(entry);

    return asString(item.type) === "intervention_delivered";
  });
}

function mapInterventions(topicLog: Record<string, unknown>) {
  return getDeliveredInterventions(topicLog).map((entry) => {
    const item = asObject(entry);
    const reflectionText = asString(
      item.ai_reflection_text ?? item.aiReflectionText ?? item.text
    );

    return {
      reason: asString(item.intervention_reason ?? item.reason, "silence"),
      interventionNumber: asInt(
        item.intervention_number ?? item.interventionNumber
      ),
      promptedSlot: asStringOrUndefined(
        item.prompted_slot ?? item.promptedSlot
      ),
      aiReflectionText: reflectionText,
      silenceDurationMs: asInt(
        item.silence_duration_ms ?? item.silenceDurationMs
      ),
      expressedPoints: asJson(item.expressed_points ?? item.expressedPoints),
      source: asStringOrUndefined(item.source),
      messageId: asInt(item.message_id ?? item.messageId),
      timestamp: asDate(item.timestamp) ?? new Date(),
      rawEntry: asJson(item),
    };
  });
}

function mapTopicLog(topicLog: Record<string, unknown>, index: number) {
  const utterances = mapUtterances(topicLog);
  const interventions = mapInterventions(topicLog);
  const topicIndex = asInt(topicLog.topic_index ?? topicLog.topicIndex) ?? index;

  return {
    topicId: asString(topicLog.topic_id ?? topicLog.topicId, `topic-${topicIndex}`),
    topicIndex,
    level: asInt(topicLog.level),
    lead: asStringOrUndefined(topicLog.lead),
    question: asString(topicLog.question),
    acpSlots: asStringArray(topicLog.acp_slots ?? topicLog.acpSlots),
    expressedPoints: asJson(topicLog.expressed_points ?? topicLog.expressedPoints),
    missingOrUnclearSlots: asStringArray(
      topicLog.missing_or_unclear_slots ?? topicLog.missingOrUnclearSlots
    ),
    slotEvidence: asJson(topicLog.slot_evidence ?? topicLog.slotEvidence),
    presentedAt: asDate(topicLog.timestamp_topic_presented),
    startedAt: asDate(topicLog.topic_start_time ?? topicLog.startedAt),
    endedAt: asDate(topicLog.topic_end_time ?? topicLog.endedAt),
    firstUtteranceAt: asDate(
      topicLog.timestamp_first_utterance ?? topicLog.firstUtteranceAt
    ),
    latencyToFirstUtteranceMs: asInt(
      topicLog.latency_to_first_utterance_ms ??
        topicLog.latencyToFirstUtteranceMs
    ),
    endReason: asStringOrUndefined(topicLog.end_reason ?? topicLog.endReason),
    interventionCount: asInt(topicLog.intervention_count) ?? 0,
    silenceInterventionCount:
      asInt(topicLog.silence_intervention_count) ?? 0,
    utteranceCountUser: asInt(topicLog.utterance_count_user) ?? 0,
    utteranceCountPartner: asInt(topicLog.utterance_count_partner) ?? 0,
    totalUserCharCount: asInt(topicLog.total_user_char_count) ?? 0,
    totalPartnerCharCount: asInt(topicLog.total_partner_char_count) ?? 0,
    firstUtteranceDetected: Boolean(topicLog.first_utterance_detected),
    lastHumanUtteranceEndAt: asDate(topicLog.last_human_utterance_end_time),
    currentState: asStringOrUndefined(topicLog.current_state),
    stateHistory: asJson(topicLog.state_history),
    silenceEvents: asJson(topicLog.silence_events),
    rawLog: asJson(topicLog),
    ...(utterances.length > 0
      ? {
          utterances: {
            create: utterances,
          },
        }
      : {}),
    ...(interventions.length > 0
      ? {
          interventions: {
            create: interventions,
          },
        }
      : {}),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const log = asObject(body.log ?? body);
    const sessionId = asString(
      body.sessionId ?? log.sessionId ?? log.id,
      crypto.randomUUID()
    );
    const topicLogs = asArray(log.topicLogs).map((topicLog, index) =>
      mapTopicLog(asObject(topicLog), index)
    );

    const session = await prisma.experimentSession.upsert({
      where: {
        id: sessionId,
      },
      create: {
        id: sessionId,
        condition: asStringOrUndefined(log.condition),
        startedAt: asDate(log.startedAt),
        completedAt: asDate(log.completedAt),
        presetTopicDurationMs: asInt(log.preset_topic_duration_ms),
        silenceSoftThresholdMs: asInt(log.silence_soft_threshold_ms),
        silenceInterventionThresholdMs: asInt(
          log.silence_intervention_threshold_ms
        ),
        maxSilenceInterventionsPerTopic: asInt(
          log.max_silence_interventions_per_topic
        ),
        rawLog: asJson(log),
        ...(topicLogs.length > 0
          ? {
              topicLogs: {
                create: topicLogs,
              },
            }
          : {}),
      },
      update: {
        condition: asStringOrUndefined(log.condition),
        completedAt: asDate(log.completedAt),
        presetTopicDurationMs: asInt(log.preset_topic_duration_ms),
        silenceSoftThresholdMs: asInt(log.silence_soft_threshold_ms),
        silenceInterventionThresholdMs: asInt(
          log.silence_intervention_threshold_ms
        ),
        maxSilenceInterventionsPerTopic: asInt(
          log.max_silence_interventions_per_topic
        ),
        rawLog: asJson(log),
        topicLogs: {
          deleteMany: {},
          ...(topicLogs.length > 0
            ? {
                create: topicLogs,
              }
            : {}),
        },
      },
      include: {
        _count: {
          select: {
            topicLogs: true,
          },
        },
      },
    });

    return Response.json({
      ok: true,
      sessionId: session.id,
      topicLogCount: session._count.topicLogs,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Failed to save experiment session" },
      { status: 500 }
    );
  }
}

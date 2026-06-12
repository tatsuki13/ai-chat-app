'use client';

import { useEffect, useRef, useState } from 'react';

const CONDITION = 'neutral_moderator_agent';
const PRESET_TOPIC_DURATION_MS = 180000;
const SILENCE_SOFT_THRESHOLD_MS = 6000;
const SILENCE_INTERVENTION_THRESHOLD_MS = 10000;
const MAX_SILENCE_INTERVENTIONS_PER_TOPIC = 2;
const MAX_AI_INTERVENTIONS_PER_TOPIC = 3;
const SHORT_ANSWER_CHAR_THRESHOLD = 8;
const MIN_INTERVENTION_INTERVAL_MS = 12000;
const AI_REFLECTION_EVENT_TYPE = 'ai_reflection';

const TOPIC_STATE = {
  TOPIC_PRESENTED: 'topic_presented',
  WAITING_FIRST_UTTERANCE: 'waiting_first_utterance',
  IN_CONVERSATION: 'in_conversation',
  SILENCE_DETECTED: 'silence_detected',
  TOPIC_FINISHED: 'topic_finished'
};

const STATE_LABELS = {
  [TOPIC_STATE.TOPIC_PRESENTED]: '話題提示',
  [TOPIC_STATE.WAITING_FIRST_UTTERANCE]: '最初の発話待機中',
  [TOPIC_STATE.IN_CONVERSATION]: '会話中',
  [TOPIC_STATE.SILENCE_DETECTED]: '沈黙検知中',
  [TOPIC_STATE.TOPIC_FINISHED]: '終了'
};

const SPEAKERS = [
  { id: 'user', label: '本人' },
  { id: 'partner', label: '相手' }
];

const topics = [
  {
    id: 'daily_continuity',
    level: 1,
    lead: 'いまの暮らしで続けたいことについて、少し話してみましょう。',
    question: '最近の生活で、これからも続けたいことは何ですか。',
    acpSlots: [
      '続けたいこと',
      'その理由',
      '支えになっている人や環境',
      '不安なこと',
      '家族に伝えておきたいこと'
    ]
  },
  {
    id: 'personal_values',
    level: 2,
    lead: '自分らしい暮らしを支える価値観について、言葉にしてみましょう。',
    question: '年齢を重ねても、自分らしく暮らすために大切にしたいことは何ですか。',
    acpSlots: [
      '自分らしさ',
      '大切にしたい価値観',
      '変わってほしくないこと',
      '不安なこと',
      '周囲に望む関わり'
    ]
  },
  {
    id: 'future_living_place',
    level: 3,
    lead: '将来の暮らす場所について、少し話してみましょう。',
    question: '将来、どのような場所や環境で暮らしていたいと思いますか。',
    acpSlots: [
      '希望する場所',
      'その理由',
      '不安なこと',
      '受け入れられる支援',
      '家族に伝えておきたいこと'
    ]
  },
  {
    id: 'acceptable_support',
    level: 4,
    lead: '支援が必要になったときの受け入れやすさについて、整理してみましょう。',
    question:
      '家事、買い物、通院、入浴などで手助けが必要になったら、どんな助け方なら受け入れやすいですか。',
    acpSlots: [
      '必要になりそうな手助け',
      '受け入れられる支援',
      '受け入れにくいこと',
      '不安なこと',
      '誰に頼みやすいか'
    ]
  },
  {
    id: 'family_burden',
    level: 5,
    lead: '家族に頼ることへの気持ちについて、無理のない範囲で話してみましょう。',
    question:
      '家族に手伝ってもらうことについて、気になることや遠慮してしまうことはありますか。',
    acpSlots: [
      '頼みたいこと',
      '遠慮してしまうこと',
      '負担への不安',
      '家族に伝えておきたいこと',
      '家族以外に頼れる支援'
    ]
  },
  {
    id: 'decision_support',
    level: 6,
    lead: '自分で決めにくくなったときの相談先について、考えてみましょう。',
    question:
      '自分で医療や介護の方針を決めることが難しくなったら、誰に相談して決めてほしいですか。',
    acpSlots: [
      '相談したい相手',
      'その理由',
      '伝えておきたい価値観',
      '避けたい決め方',
      '家族に伝えておきたいこと'
    ]
  },
  {
    id: 'serious_illness_values',
    level: 7,
    lead: '重い病気になったときに大切にしたいことを、少し整理してみましょう。',
    question:
      '重い病気になったとき、治療を考えるうえで一番大切にしたいことは何ですか。',
    acpSlots: [
      '一番大切にしたいこと',
      'その理由',
      '不安なこと',
      '避けたいこと',
      '相談したい相手'
    ]
  },
  {
    id: 'end_of_life_comfort',
    level: 8,
    lead: '人生の最終段階を考えたときの安心について、話しやすいところから触れてみましょう。',
    question:
      '人生の最終段階を考えたとき、どこで、誰と、どのように過ごせると安心だと思いますか。',
    acpSlots: [
      '過ごしたい場所',
      '一緒にいたい人',
      '安心できる過ごし方',
      '不安なこと',
      '家族に伝えておきたいこと'
    ]
  }
];

function getIsoString(timeMs = Date.now()) {
  return new Date(timeMs).toISOString();
}

function createSessionId() {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `session-${getIsoString().replace(/[:.]/g, '-')}-${randomPart}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '未記録';

  return `${(Math.max(0, ms) / 1000).toFixed(1)}秒`;
}

function getAverage(values) {
  if (values.length === 0) return null;

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function getTopicPresentationMessage(topicIndex) {
  const topic = topics[topicIndex];

  return `話題 ${topicIndex + 1} です。\n\n${topic.lead}\n${topic.question}`;
}

function getTopicEndMessage() {
  return 'この話題はここまでにします。';
}

function getFallbackIntervention(interventionCount) {
  const templates = [
    'ここまでで、この話題について考え始めたことや、少し気になっていることが言葉になりつつあります。もし続けるなら、話しやすい観点を一つ選んで触れてみてもよさそうです。',
    'ここまでで、大切にしたいことを少しずつ探している様子が出ています。もし続けるなら、まだ言葉にしきれていない不安について触れてみてもよさそうです。'
  ];

  return templates[interventionCount % templates.length];
}

const SLOT_KEYWORD_GROUPS = [
  {
    pattern: /場所|環境|どこ|暮らす|過ごす/,
    keywords: ['自宅', '家', '施設', '病院', '地域', '場所', '環境', '暮ら', '住み慣れ', '近く']
  },
  {
    pattern: /理由|背景/,
    keywords: ['から', 'ので', 'ため', '理由', '安心', '落ち着', '好き', '大切', '慣れ']
  },
  {
    pattern: /不安|気になる|遠慮|心配|負担/,
    keywords: ['不安', '心配', '怖', '困', '迷惑', '負担', '遠慮', '嫌', 'つら', '不便']
  },
  {
    pattern: /支援|助け|手助け|関わり|周囲|頼/,
    keywords: ['支援', '助け', '手伝', 'お願い', '頼', 'ヘルパー', '訪問', '介護', '通院', '入浴', '買い物']
  },
  {
    pattern: /家族|伝え|誰|相談|相手|決め/,
    keywords: ['家族', '子ども', '娘', '息子', '夫', '妻', '兄弟', '姉妹', '伝え', '相談', '任せ', '決め']
  },
  {
    pattern: /価値観|大切|自分らしさ|一番|続けたい|変わってほしくない/,
    keywords: ['大切', '自分らし', '価値', '自由', '安心', '尊重', '納得', '好き', '普通', '続け']
  },
  {
    pattern: /治療|医療|介護|方針|病気|避けたい/,
    keywords: ['治療', '医療', '介護', '方針', '延命', '痛み', '苦し', '病気', '先生', '医師', '避け']
  },
  {
    pattern: /最終段階|人生|一緒|安心できる/,
    keywords: ['最期', '最後', '終末', '人生', '看取り', 'そば', '一緒', '穏やか', '安心']
  }
];

const INTERVENTION_REASON_LABELS = {
  silence: '沈黙',
  short_answer: '短い回答',
  manual_reflection: '手動整理'
};

function normalizeText(text) {
  return String(text || '').toLowerCase();
}

function getSlotKeywords(slot) {
  const normalizedSlot = normalizeText(slot);
  const keywords = new Set([normalizedSlot]);

  SLOT_KEYWORD_GROUPS.forEach((group) => {
    if (group.pattern.test(slot)) {
      group.keywords.forEach((keyword) => keywords.add(normalizeText(keyword)));
    }
  });

  return [...keywords].filter(Boolean);
}

function isSlotExpressed(slot, text) {
  const normalizedText = normalizeText(text);

  return getSlotKeywords(slot).some((keyword) => normalizedText.includes(keyword));
}

function truncateEvidenceText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();

  if (normalized.length <= 44) return normalized;

  return `${normalized.slice(0, 43)}…`;
}

function getExpressedPointLabels(topicLog) {
  return (topicLog?.expressed_points || []).map((point) => point.slot);
}

function getMissingOrUnclearSlots(topicLog) {
  if (!topicLog) return [];

  if (Array.isArray(topicLog.missing_or_unclear_slots)) {
    return topicLog.missing_or_unclear_slots;
  }

  return topicLog.acp_slots || [];
}

function getPromptedSlot(topicLog) {
  const missingSlots = getMissingOrUnclearSlots(topicLog);

  return missingSlots[0] || topicLog?.acp_slots?.[0] || null;
}

function updateAcpSlotState(topicLog, speaker, text, timeMs) {
  if (!topicLog) return;

  const nextEvidence = { ...(topicLog.slot_evidence || {}) };
  const slots = topicLog.acp_slots || [];

  slots.forEach((slot) => {
    if (nextEvidence[slot] || !isSlotExpressed(slot, text)) return;

    nextEvidence[slot] = {
      slot,
      speaker,
      text: truncateEvidenceText(text),
      timestamp: getIsoString(timeMs)
    };
  });

  topicLog.slot_evidence = nextEvidence;
  topicLog.expressed_points = slots
    .filter((slot) => nextEvidence[slot])
    .map((slot) => nextEvidence[slot]);
  topicLog.missing_or_unclear_slots = slots.filter((slot) => !nextEvidence[slot]);
}

function isExtremelyShortAnswer(text) {
  const compactText = String(text || '').replace(/\s+/g, '');

  return compactText.length > 0 && compactText.length <= SHORT_ANSWER_CHAR_THRESHOLD;
}

function createFallbackReflection(topicLog, promptedSlot) {
  const expressedLabels = getExpressedPointLabels(topicLog).slice(0, 2);
  const expressedText =
    expressedLabels.length > 0
      ? `${expressedLabels.join('や')}についての思い`
      : 'この話題について考え始めたことや、少し気になっていること';
  const nextSlot = promptedSlot || 'まだ言葉にしきれていないこと';

  return `ここまでで、${expressedText}が少しずつ言葉になっています。もし続けるなら、${nextSlot}について、話しやすい範囲で触れてみてもよさそうです。`;
}

function clampModeratorReply(text) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return getFallbackIntervention(0);
  if (normalized.length <= 120) return normalized;

  return `${normalized.slice(0, 119)}…`;
}

function createMessage({ id, text, sender, topicIndex, eventType, timeMs }) {
  return {
    id,
    text,
    sender,
    topicIndex,
    eventType,
    createdAt: getIsoString(timeMs)
  };
}

function createTranscriptEntry({ speaker, text, eventType, timeMs }) {
  return {
    speaker,
    text,
    event_type: eventType,
    timestamp: getIsoString(timeMs)
  };
}

function createTopicLog({ topicIndex, timeMs }) {
  const topic = topics[topicIndex];

  return {
    topic_id: topic.id,
    topic_index: topicIndex,
    level: topic.level,
    lead: topic.lead,
    question: topic.question,
    acp_slots: topic.acpSlots,
    expressed_points: [],
    missing_or_unclear_slots: [...topic.acpSlots],
    slot_evidence: {},
    condition: CONDITION,
    timestamp_topic_presented: getIsoString(timeMs),
    timestamp_first_utterance: null,
    latency_to_first_utterance_ms: null,
    topic_start_time: getIsoString(timeMs),
    topic_end_time: null,
    end_reason: null,
    intervention_count: 0,
    silence_intervention_count: 0,
    last_intervention_reason: null,
    last_intervention_time: null,
    interventions: [],
    silence_events: [],
    full_transcript: [],
    utterance_count_user: 0,
    utterance_count_partner: 0,
    total_user_char_count: 0,
    total_partner_char_count: 0,
    first_utterance_detected: false,
    last_human_utterance_end_time: null,
    current_state: TOPIC_STATE.TOPIC_PRESENTED,
    state_history: [
      {
        state: TOPIC_STATE.TOPIC_PRESENTED,
        at: getIsoString(timeMs),
        reason: 'topic_presented'
      }
    ]
  };
}

function calculateSummary(topicLogs) {
  const completedTopics = topicLogs.filter((topicLog) => topicLog.topic_end_time);
  const latencies = topicLogs
    .map((topicLog) => topicLog.latency_to_first_utterance_ms)
    .filter((value) => Number.isFinite(value));

  return {
    condition: CONDITION,
    topicCount: topics.length,
    startedTopicCount: topicLogs.length,
    completedTopicCount: completedTopics.length,
    totalInterventionCount: topicLogs.reduce(
      (total, topicLog) => total + topicLog.intervention_count,
      0
    ),
    totalSilenceEventCount: topicLogs.reduce(
      (total, topicLog) => total + topicLog.silence_events.length,
      0
    ),
    averageLatencyToFirstUtteranceMs: getAverage(latencies),
    totalUtteranceCountUser: topicLogs.reduce(
      (total, topicLog) => total + topicLog.utterance_count_user,
      0
    ),
    totalUtteranceCountPartner: topicLogs.reduce(
      (total, topicLog) => total + topicLog.utterance_count_partner,
      0
    ),
    totalUserCharCount: topicLogs.reduce(
      (total, topicLog) => total + topicLog.total_user_char_count,
      0
    ),
    totalPartnerCharCount: topicLogs.reduce(
      (total, topicLog) => total + topicLog.total_partner_char_count,
      0
    )
  };
}

function createInitialSession() {
  const timeMs = Date.now();

  return {
    sessionId: createSessionId(),
    condition: CONDITION,
    startedAt: getIsoString(timeMs),
    updatedAt: getIsoString(timeMs),
    completedAt: null,
    preset_topic_duration_ms: PRESET_TOPIC_DURATION_MS,
    silence_soft_threshold_ms: SILENCE_SOFT_THRESHOLD_MS,
    silence_intervention_threshold_ms: SILENCE_INTERVENTION_THRESHOLD_MS,
    max_silence_interventions_per_topic: MAX_SILENCE_INTERVENTIONS_PER_TOPIC,
    topics: topics.map((topic, index) => ({
      topic_id: topic.id,
      topic_index: index,
      level: topic.level,
      lead: topic.lead,
      acpSlots: topic.acpSlots,
      question: topic.question
    })),
    messages: [],
    events: [
      {
        type: 'session_started',
        at: getIsoString(timeMs)
      }
    ],
    topicLogs: [],
    summary: calculateSummary([])
  };
}

function getSpeakerLabel(sender) {
  if (sender === 'moderator') return '司会者';
  if (sender === 'partner') return '相手';
  if (sender === 'system') return '記録';

  return '本人';
}

function getRecentTranscript(topicLog) {
  return topicLog.full_transcript
    .filter(
      (entry) =>
        entry.speaker !== 'moderator' ||
        entry.event_type === 'silence_intervention' ||
        entry.event_type === AI_REFLECTION_EVENT_TYPE
    )
    .slice(-8)
    .map((entry) => `${getSpeakerLabel(entry.speaker)}: ${entry.text}`)
    .join('\n');
}

export default function ChatPage() {
  const initialSessionRef = useRef(null);

  if (initialSessionRef.current === null) {
    initialSessionRef.current = createInitialSession();
  }

  const sessionRef = useRef(initialSessionRef.current);
  const nextMessageIdRef = useRef(1);
  const activeTopicIndexRef = useRef(null);
  const nextTopicIndexRef = useRef(0);
  const currentTopicStateRef = useRef(TOPIC_STATE.TOPIC_FINISHED);
  const topicStartedAtMsRef = useRef(null);
  const lastHumanUtteranceEndTimeRef = useRef(null);
  const firstUtteranceDetectedRef = useRef(false);
  const silenceSoftLoggedRef = useRef(false);
  const interventionInFlightRef = useRef(false);
  const neonSaveInFlightRef = useRef(false);
  const neonSaveCompletedRef = useRef(false);
  const inputTextRef = useRef('');
  const isSessionCompleteRef = useRef(false);
  const messagesEndRef = useRef(null);

  const [messages, setMessages] = useState(sessionRef.current.messages);
  const [inputText, setInputText] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('user');
  const [currentTopicIndex, setCurrentTopicIndex] = useState(null);
  const [topicState, setTopicState] = useState(TOPIC_STATE.TOPIC_FINISHED);
  const [displayNow, setDisplayNow] = useState(Date.now());
  const [metricsVersion, setMetricsVersion] = useState(0);

  const isSessionComplete = isSessionCompleteRef.current;
  const activeTopicLog =
    currentTopicIndex === null
      ? null
      : sessionRef.current.topicLogs.find(
          (topicLog) =>
            topicLog.topic_index === currentTopicIndex && !topicLog.topic_end_time
        ) || null;
  const nextTopicNumber = Math.min(nextTopicIndexRef.current + 1, topics.length);
  const progressValue =
    currentTopicIndex === null ? nextTopicIndexRef.current : currentTopicIndex + 1;
  const latencyDisplay = activeTopicLog
    ? formatDuration(activeTopicLog.latency_to_first_utterance_ms)
    : '未記録';
  const silenceDurationMs =
    activeTopicLog &&
    firstUtteranceDetectedRef.current &&
    lastHumanUtteranceEndTimeRef.current
      ? displayNow - lastHumanUtteranceEndTimeRef.current
      : null;
  const silenceDisplay =
    silenceDurationMs === null ? '無効' : formatDuration(silenceDurationMs);
  const interventionCountDisplay = activeTopicLog
    ? `${activeTopicLog.intervention_count} / ${MAX_AI_INTERVENTIONS_PER_TOPIC}`
    : `0 / ${MAX_AI_INTERVENTIONS_PER_TOPIC}`;
  const canStartTopic =
    !isSessionComplete &&
    currentTopicIndex === null &&
    nextTopicIndexRef.current < topics.length;
  const hasActiveTopic = currentTopicIndex !== null && !isSessionComplete;
  const canUseTranscriptInput =
    hasActiveTopic && topicState !== TOPIC_STATE.TOPIC_FINISHED;
  const expressedSlotLabels = getExpressedPointLabels(activeTopicLog);
  const missingSlotLabels = getMissingOrUnclearSlots(activeTopicLog);
  const lastInterventionReasonDisplay = activeTopicLog?.last_intervention_reason
    ? INTERVENTION_REASON_LABELS[activeTopicLog.last_intervention_reason]
    : '未実施';
  const canRequestManualReflection = Boolean(
    hasActiveTopic &&
    activeTopicLog &&
    !interventionInFlightRef.current &&
    activeTopicLog.intervention_count < MAX_AI_INTERVENTIONS_PER_TOPIC
  );

  const refreshSessionSnapshot = (session = sessionRef.current) => {
    session.updatedAt = getIsoString();
    session.summary = calculateSummary(session.topicLogs);
  };

  const saveSessionToNeon = async (reason, session = sessionRef.current) => {
    if (!session.completedAt || neonSaveInFlightRef.current || neonSaveCompletedRef.current) {
      return;
    }

    neonSaveInFlightRef.current = true;
    session.updatedAt = getIsoString();
    session.summary = calculateSummary(session.topicLogs);

    try {
      const response = await fetch('/api/experiment-sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: session.sessionId,
          reason,
          log: session
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save experiment session');
      }

      neonSaveCompletedRef.current = true;
      console.log('saved to neon');
    } catch (error) {
      console.error('Failed to save experiment session to Neon', error);
    } finally {
      neonSaveInFlightRef.current = false;
    }
  };

  const syncSessionState = (reason) => {
    sessionRef.current.summary = calculateSummary(sessionRef.current.topicLogs);
    setMessages([...sessionRef.current.messages]);
    setMetricsVersion((version) => version + 1);
    refreshSessionSnapshot();
  };

  const findActiveTopicLog = () => {
    if (activeTopicIndexRef.current === null) return null;

    return (
      sessionRef.current.topicLogs.find(
        (topicLog) =>
          topicLog.topic_index === activeTopicIndexRef.current &&
          !topicLog.topic_end_time
      ) || null
    );
  };

  const transitionTopicState = (nextState, timeMs, reason) => {
    currentTopicStateRef.current = nextState;
    setTopicState(nextState);

    const topicLog = findActiveTopicLog();
    if (topicLog) {
      topicLog.current_state = nextState;
      topicLog.state_history.push({
        state: nextState,
        at: getIsoString(timeMs),
        reason
      });
    }

    sessionRef.current.events.push({
      type: 'topic_state_changed',
      topic_index: activeTopicIndexRef.current,
      state: nextState,
      reason,
      at: getIsoString(timeMs)
    });
  };

  const pushMessage = ({ text, sender, topicIndex, eventType, timeMs }) => {
    const message = createMessage({
      id: nextMessageIdRef.current,
      text,
      sender,
      topicIndex,
      eventType,
      timeMs
    });

    nextMessageIdRef.current += 1;
    sessionRef.current.messages.push(message);

    return message;
  };

  const appendTranscriptEntry = (topicLog, entry) => {
    if (!topicLog) return;

    topicLog.full_transcript.push(createTranscriptEntry(entry));
  };

  const startTopic = (topicIndex, source) => {
    if (topicIndex >= topics.length) return;

    const timeMs = Date.now();
    const topicLog = createTopicLog({ topicIndex, timeMs });

    sessionRef.current.topicLogs.push(topicLog);
    activeTopicIndexRef.current = topicIndex;
    nextTopicIndexRef.current = topicIndex + 1;
    topicStartedAtMsRef.current = timeMs;
    lastHumanUtteranceEndTimeRef.current = null;
    firstUtteranceDetectedRef.current = false;
    silenceSoftLoggedRef.current = false;

    const message = pushMessage({
      text: getTopicPresentationMessage(topicIndex),
      sender: 'moderator',
      topicIndex,
      eventType: 'topic_presented',
      timeMs
    });
    appendTranscriptEntry(topicLog, {
      speaker: 'moderator',
      text: message.text,
      eventType: 'topic_presented',
      timeMs
    });

    sessionRef.current.events.push({
      type: 'topic_presented',
      topic_id: topicLog.topic_id,
      topic_index: topicIndex,
      source,
      message_id: message.id,
      at: getIsoString(timeMs)
    });

    setCurrentTopicIndex(topicIndex);
    transitionTopicState(
      TOPIC_STATE.WAITING_FIRST_UTTERANCE,
      timeMs,
      'waiting_for_first_utterance'
    );
    syncSessionState('topic_started');
  };

  const completeSession = (timeMs) => {
    if (sessionRef.current.completedAt) return;

    sessionRef.current.completedAt = getIsoString(timeMs);
    isSessionCompleteRef.current = true;
    sessionRef.current.events.push({
      type: 'session_completed',
      at: getIsoString(timeMs)
    });
    saveSessionToNeon('session_completed');
  };

  const finishActiveTopic = (reason, shouldStartNext) => {
    const topicLog = findActiveTopicLog();
    if (!topicLog) return;

    const timeMs = Date.now();
    const topicIndex = activeTopicIndexRef.current;

    transitionTopicState(TOPIC_STATE.TOPIC_FINISHED, timeMs, reason);

    topicLog.topic_end_time = getIsoString(timeMs);
    topicLog.end_reason = reason;

    const message = pushMessage({
      text: getTopicEndMessage(),
      sender: 'moderator',
      topicIndex,
      eventType: 'topic_finished',
      timeMs
    });
    appendTranscriptEntry(topicLog, {
      speaker: 'moderator',
      text: message.text,
      eventType: 'topic_finished',
      timeMs
    });

    sessionRef.current.events.push({
      type: 'topic_finished',
      topic_id: topicLog.topic_id,
      topic_index: topicIndex,
      reason,
      message_id: message.id,
      at: getIsoString(timeMs)
    });

    activeTopicIndexRef.current = null;
    topicStartedAtMsRef.current = null;
    lastHumanUtteranceEndTimeRef.current = null;
    firstUtteranceDetectedRef.current = false;
    silenceSoftLoggedRef.current = false;
    setCurrentTopicIndex(null);

    if (nextTopicIndexRef.current >= topics.length) {
      completeSession(timeMs);
    }

    syncSessionState('topic_finished');

    if (
      shouldStartNext &&
      !isSessionCompleteRef.current &&
      nextTopicIndexRef.current < topics.length
    ) {
      startTopic(nextTopicIndexRef.current, reason);
    }
  };

  const recordFirstUtterance = (topicLog, timeMs) => {
    if (!topicLog || topicLog.first_utterance_detected) return;

    const latencyMs = Math.max(0, timeMs - Date.parse(topicLog.topic_start_time));

    firstUtteranceDetectedRef.current = true;
    topicLog.first_utterance_detected = true;
    topicLog.timestamp_first_utterance = getIsoString(timeMs);
    topicLog.latency_to_first_utterance_ms = latencyMs;
    sessionRef.current.events.push({
      type: 'first_utterance_detected',
      topic_id: topicLog.topic_id,
      topic_index: topicLog.topic_index,
      latency_to_first_utterance_ms: latencyMs,
      at: getIsoString(timeMs)
    });
    transitionTopicState(
      TOPIC_STATE.IN_CONVERSATION,
      timeMs,
      'first_utterance_detected'
    );
  };

  const recordHumanUtterance = (speaker, text, timeMs) => {
    const topicLog = findActiveTopicLog();
    if (!topicLog) return;

    recordFirstUtterance(topicLog, timeMs);

    lastHumanUtteranceEndTimeRef.current = timeMs;
    topicLog.last_human_utterance_end_time = getIsoString(timeMs);
    silenceSoftLoggedRef.current = false;

    if (speaker === 'partner') {
      topicLog.utterance_count_partner += 1;
      topicLog.total_partner_char_count += text.length;
    } else {
      topicLog.utterance_count_user += 1;
      topicLog.total_user_char_count += text.length;
    }

    const message = pushMessage({
      text,
      sender: speaker,
      topicIndex: activeTopicIndexRef.current,
      eventType: 'human_utterance',
      timeMs
    });
    appendTranscriptEntry(topicLog, {
      speaker,
      text,
      eventType: 'human_utterance',
      timeMs
    });
    updateAcpSlotState(topicLog, speaker, text, timeMs);

    sessionRef.current.events.push({
      type: 'human_utterance',
      topic_id: topicLog.topic_id,
      topic_index: topicLog.topic_index,
      speaker,
      message_id: message.id,
      char_count: text.length,
      expressed_points: topicLog.expressed_points,
      missing_or_unclear_slots: topicLog.missing_or_unclear_slots,
      at: getIsoString(timeMs)
    });

    if (currentTopicStateRef.current === TOPIC_STATE.SILENCE_DETECTED) {
      transitionTopicState(
        TOPIC_STATE.IN_CONVERSATION,
        timeMs,
        'human_utterance_after_silence'
      );
    }

    return {
      topicLog,
      isShortAnswer: isExtremelyShortAnswer(text)
    };
  };

  const recordSoftSilence = (topicLog, timeMs, silenceDurationMs) => {
    silenceSoftLoggedRef.current = true;
    topicLog.silence_events.push({
      type: 'soft_threshold',
      timestamp: getIsoString(timeMs),
      silence_duration_ms: silenceDurationMs,
      threshold_ms: SILENCE_SOFT_THRESHOLD_MS
    });
    sessionRef.current.events.push({
      type: 'silence_soft_threshold',
      topic_id: topicLog.topic_id,
      topic_index: topicLog.topic_index,
      silence_duration_ms: silenceDurationMs,
      at: getIsoString(timeMs)
    });

    if (currentTopicStateRef.current !== TOPIC_STATE.SILENCE_DETECTED) {
      transitionTopicState(
        TOPIC_STATE.SILENCE_DETECTED,
        timeMs,
        'silence_soft_threshold'
      );
    }

    syncSessionState('silence_soft_threshold');
  };

  const canRequestModeratorIntervention = (topicLog, interventionReason, timeMs) => {
    if (!topicLog || topicLog.topic_end_time || interventionInFlightRef.current) {
      return false;
    }

    if (topicLog.intervention_count >= MAX_AI_INTERVENTIONS_PER_TOPIC) {
      return false;
    }

    if (
      interventionReason === 'silence' &&
      topicLog.silence_intervention_count >= MAX_SILENCE_INTERVENTIONS_PER_TOPIC
    ) {
      return false;
    }

    if (interventionReason !== 'manual_reflection' && topicLog.last_intervention_time) {
      const lastInterventionTimeMs = Date.parse(topicLog.last_intervention_time);

      if (
        Number.isFinite(lastInterventionTimeMs) &&
        timeMs - lastInterventionTimeMs < MIN_INTERVENTION_INTERVAL_MS
      ) {
        return false;
      }
    }

    return true;
  };

  const requestModeratorIntervention = async (
    topicLog,
    { interventionReason, silenceDurationMs = null }
  ) => {
    const requestStartedAtMs = Date.now();
    if (!canRequestModeratorIntervention(topicLog, interventionReason, requestStartedAtMs)) {
      return;
    }

    const topicIndex = topicLog.topic_index;
    const lastHumanUtteranceEndTime = topicLog.last_human_utterance_end_time;
    const interventionNumber = topicLog.intervention_count + 1;
    const expressedPoints = [...(topicLog.expressed_points || [])];
    const alreadyExpressedPoints = expressedPoints.map(
      (point) => `${point.slot}: ${point.text}`
    );
    const missingOrUnclearSlots = getMissingOrUnclearSlots(topicLog);
    const promptedSlot = getPromptedSlot(topicLog);

    interventionInFlightRef.current = true;

    if (interventionReason === 'silence') {
      topicLog.silence_events.push({
        type: 'intervention_requested',
        timestamp: getIsoString(requestStartedAtMs),
        silence_duration_ms: silenceDurationMs,
        intervention_number: interventionNumber,
        threshold_ms: SILENCE_INTERVENTION_THRESHOLD_MS,
        intervention_reason: interventionReason,
        expressed_points: expressedPoints,
        prompted_slot: promptedSlot
      });
    }

    sessionRef.current.events.push({
      type: 'moderator_intervention_requested',
      topic_id: topicLog.topic_id,
      topic_index: topicIndex,
      intervention_reason: interventionReason,
      silence_duration_ms: silenceDurationMs,
      intervention_number: interventionNumber,
      intervention_count: topicLog.intervention_count,
      expressed_points: expressedPoints,
      prompted_slot: promptedSlot,
      at: getIsoString(requestStartedAtMs)
    });
    syncSessionState(`${interventionReason}_intervention_requested`);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          current_topic: {
            topic_id: topicLog.topic_id,
            topic_index: topicLog.topic_index,
            level: topicLog.level,
            lead: topicLog.lead,
            question: topicLog.question
          },
          acpSlots: topicLog.acp_slots,
          recent_transcript: getRecentTranscript(topicLog),
          already_expressed_points: alreadyExpressedPoints,
          missing_or_unclear_slots: missingOrUnclearSlots,
          silence_duration_ms: silenceDurationMs,
          intervention_count: topicLog.intervention_count,
          intervention_reason: interventionReason,
          prompted_slot: promptedSlot
        })
      });
      const data = await response.json();
      const activeTopicStillCurrent =
        activeTopicIndexRef.current === topicIndex &&
        findActiveTopicLog()?.last_human_utterance_end_time === lastHumanUtteranceEndTime;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to request moderator intervention');
      }

      if (!activeTopicStillCurrent) {
        if (interventionReason === 'silence') {
          topicLog.silence_events.push({
            type: 'intervention_cancelled',
            timestamp: getIsoString(),
            reason: 'conversation_resumed',
            intervention_reason: interventionReason
          });
        }
        sessionRef.current.events.push({
          type: 'moderator_intervention_cancelled',
          topic_id: topicLog.topic_id,
          topic_index: topicIndex,
          intervention_reason: interventionReason,
          timestamp: getIsoString(),
          reason: 'conversation_resumed'
        });
        syncSessionState(`${interventionReason}_intervention_cancelled`);
        return;
      }

      const timeMs = Date.now();
      const reply = clampModeratorReply(
        data.reply || createFallbackReflection(topicLog, promptedSlot)
      );
      const message = pushMessage({
        text: reply,
        sender: 'moderator',
        topicIndex,
        eventType: AI_REFLECTION_EVENT_TYPE,
        timeMs
      });

      topicLog.intervention_count += 1;
      if (interventionReason === 'silence') {
        topicLog.silence_intervention_count += 1;
      }
      topicLog.last_intervention_reason = interventionReason;
      topicLog.last_intervention_time = getIsoString(timeMs);
      appendTranscriptEntry(topicLog, {
        speaker: 'moderator',
        text: reply,
        eventType: AI_REFLECTION_EVENT_TYPE,
        timeMs
      });

      const deliveredIntervention = {
        timestamp: getIsoString(timeMs),
        intervention_number: topicLog.intervention_count,
        intervention_reason: interventionReason,
        expressed_points: expressedPoints,
        prompted_slot: promptedSlot,
        ai_reflection_text: reply,
        message_id: message.id,
        source: data.source || 'openai'
      };

      topicLog.interventions.push(deliveredIntervention);
      if (interventionReason === 'silence') {
        topicLog.silence_events.push({
          type: 'intervention_delivered',
          timestamp: getIsoString(timeMs),
          silence_duration_ms: lastHumanUtteranceEndTime
            ? timeMs - Date.parse(lastHumanUtteranceEndTime)
            : null,
          intervention_number: topicLog.intervention_count,
          message_id: message.id,
          text: reply,
          intervention_reason: interventionReason,
          expressed_points: expressedPoints,
          prompted_slot: promptedSlot,
          ai_reflection_text: reply
        });
      }
      sessionRef.current.events.push({
        type: 'moderator_intervention_delivered',
        topic_id: topicLog.topic_id,
        topic_index: topicIndex,
        intervention_reason: interventionReason,
        silence_duration_ms: lastHumanUtteranceEndTime
          ? timeMs - Date.parse(lastHumanUtteranceEndTime)
          : null,
        intervention_count: topicLog.intervention_count,
        expressed_points: expressedPoints,
        prompted_slot: promptedSlot,
        ai_reflection_text: reply,
        message_id: message.id,
        at: getIsoString(timeMs)
      });
      syncSessionState(`${interventionReason}_intervention_delivered`);
    } catch (error) {
      console.error(error);

      const activeTopicStillCurrent =
        activeTopicIndexRef.current === topicIndex &&
        findActiveTopicLog()?.last_human_utterance_end_time === lastHumanUtteranceEndTime;

      if (activeTopicStillCurrent) {
        const timeMs = Date.now();
        const reply = clampModeratorReply(
          createFallbackReflection(topicLog, promptedSlot)
        );
        const message = pushMessage({
          text: reply,
          sender: 'moderator',
          topicIndex,
          eventType: AI_REFLECTION_EVENT_TYPE,
          timeMs
        });

        topicLog.intervention_count += 1;
        if (interventionReason === 'silence') {
          topicLog.silence_intervention_count += 1;
        }
        topicLog.last_intervention_reason = interventionReason;
        topicLog.last_intervention_time = getIsoString(timeMs);
        appendTranscriptEntry(topicLog, {
          speaker: 'moderator',
          text: reply,
          eventType: AI_REFLECTION_EVENT_TYPE,
          timeMs
        });

        const fallbackIntervention = {
          timestamp: getIsoString(timeMs),
          intervention_number: topicLog.intervention_count,
          intervention_reason: interventionReason,
          expressed_points: expressedPoints,
          prompted_slot: promptedSlot,
          ai_reflection_text: reply,
          message_id: message.id,
          source: 'fallback'
        };

        topicLog.interventions.push(fallbackIntervention);
        if (interventionReason === 'silence') {
          topicLog.silence_events.push({
            type: 'intervention_delivered',
            timestamp: getIsoString(timeMs),
            silence_duration_ms: lastHumanUtteranceEndTime
              ? timeMs - Date.parse(lastHumanUtteranceEndTime)
              : null,
            intervention_number: topicLog.intervention_count,
            message_id: message.id,
            text: reply,
            source: 'fallback',
            intervention_reason: interventionReason,
            expressed_points: expressedPoints,
            prompted_slot: promptedSlot,
            ai_reflection_text: reply
          });
        }
        sessionRef.current.events.push({
          type: 'moderator_intervention_delivered',
          topic_id: topicLog.topic_id,
          topic_index: topicIndex,
          intervention_reason: interventionReason,
          timestamp: getIsoString(timeMs),
          silence_duration_ms: lastHumanUtteranceEndTime
            ? timeMs - Date.parse(lastHumanUtteranceEndTime)
            : null,
          intervention_count: topicLog.intervention_count,
          expressed_points: expressedPoints,
          prompted_slot: promptedSlot,
          ai_reflection_text: reply,
          message_id: message.id,
          source: 'fallback',
          at: getIsoString(timeMs)
        });
        syncSessionState(`${interventionReason}_intervention_fallback`);
      }
    } finally {
      interventionInFlightRef.current = false;
    }
  };

  const checkTimers = () => {
    const timeMs = Date.now();
    setDisplayNow(timeMs);

    const topicLog = findActiveTopicLog();
    if (!topicLog || topicLog.topic_end_time) return;

    if (
      topicStartedAtMsRef.current &&
      timeMs - topicStartedAtMsRef.current >= PRESET_TOPIC_DURATION_MS
    ) {
      finishActiveTopic('preset_topic_duration_elapsed', false);
      return;
    }

    if (!firstUtteranceDetectedRef.current || !lastHumanUtteranceEndTimeRef.current) {
      return;
    }

    const silenceDurationMs = timeMs - lastHumanUtteranceEndTimeRef.current;

    if (silenceDurationMs >= SILENCE_SOFT_THRESHOLD_MS && !silenceSoftLoggedRef.current) {
      recordSoftSilence(topicLog, timeMs, silenceDurationMs);

      if (silenceDurationMs < SILENCE_INTERVENTION_THRESHOLD_MS) {
        return;
      }
    }

    if (
      silenceDurationMs >= SILENCE_SOFT_THRESHOLD_MS &&
      currentTopicStateRef.current !== TOPIC_STATE.SILENCE_DETECTED
    ) {
      transitionTopicState(
        TOPIC_STATE.SILENCE_DETECTED,
        timeMs,
        'silence_detected'
      );
    }

    const nextInterventionDueMs =
      lastHumanUtteranceEndTimeRef.current +
      SILENCE_INTERVENTION_THRESHOLD_MS +
      topicLog.intervention_count * SILENCE_INTERVENTION_THRESHOLD_MS;

    if (
      silenceDurationMs >= SILENCE_INTERVENTION_THRESHOLD_MS &&
      timeMs >= nextInterventionDueMs &&
      topicLog.silence_intervention_count < MAX_SILENCE_INTERVENTIONS_PER_TOPIC &&
      topicLog.intervention_count < MAX_AI_INTERVENTIONS_PER_TOPIC &&
      !interventionInFlightRef.current
    ) {
      requestModeratorIntervention(topicLog, {
        interventionReason: 'silence',
        silenceDurationMs
      });
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    refreshSessionSnapshot();
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(checkTimers, 1000);

    return () => window.clearInterval(timerId);
  }, []);

  const resetConversation = () => {
    const nextSession = createInitialSession();

    sessionRef.current = nextSession;
    nextMessageIdRef.current = 1;
    activeTopicIndexRef.current = null;
    nextTopicIndexRef.current = 0;
    currentTopicStateRef.current = TOPIC_STATE.TOPIC_FINISHED;
    topicStartedAtMsRef.current = null;
    lastHumanUtteranceEndTimeRef.current = null;
    firstUtteranceDetectedRef.current = false;
    silenceSoftLoggedRef.current = false;
    interventionInFlightRef.current = false;
    neonSaveInFlightRef.current = false;
    neonSaveCompletedRef.current = false;
    inputTextRef.current = '';
    isSessionCompleteRef.current = false;

    setMessages(nextSession.messages);
    setInputText('');
    setCurrentTopicIndex(null);
    setTopicState(TOPIC_STATE.TOPIC_FINISHED);
    setDisplayNow(Date.now());
    setMetricsVersion((version) => version + 1);
    refreshSessionSnapshot(nextSession);
  };

  const handleInputChange = (event) => {
    const nextText = event.target.value;

    inputTextRef.current = nextText;
    setInputText(nextText);
  };

  const handleSendMessage = (event) => {
    event.preventDefault();

    const trimmedText = inputTextRef.current.trim();
    if (!trimmedText || !canUseTranscriptInput) return;

    const timeMs = Date.now();
    const utteranceResult = recordHumanUtterance(selectedSpeaker, trimmedText, timeMs);

    inputTextRef.current = '';
    setInputText('');
    syncSessionState('human_utterance');

    if (utteranceResult?.isShortAnswer) {
      requestModeratorIntervention(utteranceResult.topicLog, {
        interventionReason: 'short_answer',
        silenceDurationMs: 0
      });
    }
  };

  const handleStartTopic = () => {
    if (!canStartTopic) return;

    startTopic(nextTopicIndexRef.current, 'experimenter_start');
  };

  const handleNextTopic = () => {
    if (!hasActiveTopic) return;

    finishActiveTopic('experimenter_next_topic', true);
  };

  const handleFinishTopic = () => {
    if (!hasActiveTopic) return;

    finishActiveTopic('experimenter_finish_topic', false);
  };

  const handleManualReflection = () => {
    const topicLog = findActiveTopicLog();
    if (!topicLog) return;

    const timeMs = Date.now();
    const manualSilenceDurationMs = lastHumanUtteranceEndTimeRef.current
      ? timeMs - lastHumanUtteranceEndTimeRef.current
      : null;

    requestModeratorIntervention(topicLog, {
      interventionReason: 'manual_reflection',
      silenceDurationMs: manualSilenceDurationMs
    });
  };

  const renderMessageLabel = (message) => (
    <div
      style={{
        fontSize: '11px',
        color: message.sender === 'moderator' ? '#6b7280' : 'rgba(255,255,255,0.78)',
        marginBottom: '3px'
      }}
    >
      {getSpeakerLabel(message.sender)}
    </div>
  );

  const metricItems = [
    ['状態', STATE_LABELS[topicState]],
    ['発話開始潜時', latencyDisplay],
    ['沈黙時間', silenceDisplay],
    ['介入回数', interventionCountDisplay]
  ];

  const perspectiveItems = [
    ['話された観点', expressedSlotLabels.length ? expressedSlotLabels : ['未整理']],
    ['まだ触れていない観点', missingSlotLabels.length ? missingSlotLabels : ['なし']],
    ['直近のAI介入理由', [lastInterventionReasonDisplay]]
  ];

  return (
    <main className="appShell">
      <section
        className="workspace"
        aria-label="これからの暮らしについて話すチャット"
      >
        <aside className="controlPane" aria-label="進行管理">
          <header className="controlHeader">
            <div>
              <h1>これからの暮らし相談</h1>
              <p>中立的司会者エージェント</p>
            </div>

            <button
              className="resetButton"
              type="button"
              onClick={resetConversation}
            >
              最初から
            </button>
          </header>

          <section className="progressPanel" aria-label="進捗">
            <div className="progressMeta">
              <span>進捗</span>
              <strong>
                {isSessionComplete
                  ? '完了'
                  : currentTopicIndex === null
                    ? `${Math.min(nextTopicNumber, topics.length)} / ${topics.length}`
                    : `${currentTopicIndex + 1} / ${topics.length}`}
              </strong>
            </div>
            <div className="progressTrack" aria-hidden="true">
              <div
                className="progressFill"
                style={{ width: `${(progressValue / topics.length) * 100}%` }}
              />
            </div>
          </section>

          <section className="controlSection" aria-label="話題操作">
            <button
              className="controlButton primary"
              type="button"
              onClick={handleStartTopic}
              disabled={!canStartTopic}
            >
              話題開始
            </button>
            <button
              className="controlButton"
              type="button"
              onClick={handleNextTopic}
              disabled={!hasActiveTopic}
            >
              次の話題へ
            </button>
            <button
              className="controlButton danger"
              type="button"
              onClick={handleFinishTopic}
              disabled={!hasActiveTopic}
            >
              この話題を終了
            </button>
            <button
              className="controlButton emphasis"
              type="button"
              onClick={handleManualReflection}
              disabled={!canRequestManualReflection}
            >
              整理して促す
            </button>
          </section>

          <section className="metricGrid" aria-label="状態">
            {metricItems.map(([label, value]) => (
              <div className="metricCell" key={label}>
                <div className="metricLabel">{label}</div>
                <div className="metricValue">{value}</div>
              </div>
            ))}
          </section>

          <section className="perspectivePanel" aria-label="ACP観点">
            {perspectiveItems.map(([label, values]) => (
              <div className="perspectiveGroup" key={label}>
                <div className="perspectiveLabel">{label}</div>
                <div className="tagList">
                  {values.map((value) => (
                    <span className="tag" key={value}>
                      {value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </aside>

        <section className="chatPane" aria-label="会話エリア">
          <div className="chatHeader">
            <h2>会話ログ</h2>
          </div>

          <div className="chatLog" aria-label="会話ログ">
            {messages.map((message) => {
              const isModerator = message.sender === 'moderator';
              const isPartner = message.sender === 'partner';

              return (
                <div
                  className="messageBubble"
                  key={message.id}
                  style={{
                    alignSelf: isModerator ? 'flex-start' : 'flex-end',
                    background: isModerator
                      ? '#ffffff'
                      : isPartner
                        ? '#5f557b'
                        : '#245c52',
                    color: isModerator ? '#1f2933' : 'white',
                    border: isModerator
                      ? '1px solid #dbe1e4'
                      : '1px solid transparent',
                    borderRadius: isModerator
                      ? '16px 16px 16px 4px'
                      : '16px 16px 4px 16px'
                  }}
                >
                  {renderMessageLabel(message)}
                  {message.text}
                </div>
              );
            })}

            <div ref={messagesEndRef} />
          </div>

          <form className="composer" onSubmit={handleSendMessage}>
            <div className="speakerSwitcher" aria-label="発話者切り替え">
              {SPEAKERS.map((speaker) => {
                const selected = selectedSpeaker === speaker.id;

                return (
                  <button
                    className={`speakerButton${selected ? ' selected' : ''}`}
                    key={speaker.id}
                    type="button"
                    onClick={() => setSelectedSpeaker(speaker.id)}
                  >
                    {speaker.label}
                  </button>
                );
              })}
            </div>

            <input
              className="messageInput"
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder={
                canUseTranscriptInput
                  ? '発話を入力'
                  : '話題開始後に入力できます'
              }
              disabled={!canUseTranscriptInput}
            />
            <button
              className="submitButton"
              type="submit"
              disabled={!canUseTranscriptInput}
            >
              追加
            </button>
          </form>
        </section>
      </section>

      <style jsx>{`
        .appShell {
          min-height: 100vh;
          box-sizing: border-box;
          background: #f4f6f5;
          color: #1f2933;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family:
            "Hiragino Sans", "Yu Gothic", "Meiryo", system-ui, sans-serif;
        }

        .workspace {
          width: min(1400px, calc(100vw - 48px));
          height: min(860px, calc(100vh - 48px));
          min-height: 620px;
          background: #ffffff;
          border: 1px solid #d7dee2;
          border-radius: 8px;
          box-shadow: 0 18px 40px rgba(31, 41, 51, 0.14);
          display: grid;
          grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
          overflow: hidden;
        }

        .controlPane {
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          background: #fbfcfb;
          border-right: 1px solid #d7dee2;
          display: flex;
          flex-direction: column;
        }

        .controlHeader {
          background: #245c52;
          color: white;
          padding: 20px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }

        .controlHeader h1 {
          margin: 0;
          font-size: 20px;
          line-height: 1.35;
          font-weight: 700;
        }

        .controlHeader p {
          margin: 5px 0 0;
          font-size: 13px;
          opacity: 0.88;
        }

        .resetButton,
        .controlButton,
        .speakerButton,
        .submitButton {
          border-radius: 6px;
          cursor: pointer;
          font: inherit;
          white-space: nowrap;
        }

        .resetButton {
          flex: 0 0 auto;
          border: 1px solid rgba(255, 255, 255, 0.72);
          background: rgba(255, 255, 255, 0.12);
          color: white;
          padding: 8px 12px;
        }

        .progressPanel,
        .controlSection,
        .metricGrid,
        .perspectivePanel {
          padding: 16px 18px;
          border-bottom: 1px solid #e3e8eb;
        }

        .progressMeta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: #516066;
          font-size: 13px;
          margin-bottom: 9px;
        }

        .progressMeta strong {
          color: #1f2933;
          font-size: 14px;
        }

        .progressTrack {
          height: 8px;
          background: #dfe6e5;
          border-radius: 999px;
          overflow: hidden;
        }

        .progressFill {
          height: 100%;
          background: #d26f3f;
        }

        .controlSection {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }

        .controlButton {
          width: 100%;
          padding: 10px 12px;
          background: #ffffff;
          color: #245c52;
          border: 1px solid #9eb2a7;
          font-weight: 700;
          text-align: center;
        }

        .controlButton.primary {
          background: #245c52;
          color: #ffffff;
          border-color: #245c52;
        }

        .controlButton.danger {
          color: #8a3f2a;
          border-color: #d9aa96;
        }

        .controlButton.emphasis {
          border-color: #6c9a88;
        }

        .controlButton:disabled,
        .submitButton:disabled {
          background: #e5e9eb;
          border-color: #d3d9dd;
          color: #6b7280;
          cursor: default;
          opacity: 0.65;
        }

        .metricGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .metricCell {
          min-width: 0;
          background: #ffffff;
          border: 1px solid #dfe6e9;
          border-radius: 6px;
          padding: 9px 10px;
        }

        .metricLabel,
        .perspectiveLabel {
          color: #64727a;
          font-size: 11px;
          font-weight: 700;
        }

        .metricValue {
          margin-top: 3px;
          color: #1f2933;
          font-size: 13px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .perspectivePanel {
          display: flex;
          flex-direction: column;
          gap: 14px;
          border-bottom: 0;
        }

        .tagList {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 7px;
        }

        .tag {
          max-width: 100%;
          border: 1px solid #d6dee2;
          background: #ffffff;
          color: #1f2933;
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 12px;
          line-height: 1.35;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chatPane {
          min-width: 0;
          min-height: 0;
          background: #f7f9f8;
          display: flex;
          flex-direction: column;
        }

        .chatHeader {
          flex: 0 0 auto;
          padding: 16px 24px;
          background: #ffffff;
          border-bottom: 1px solid #e3e8eb;
        }

        .chatHeader h2 {
          margin: 0;
          color: #1f2933;
          font-size: 16px;
          line-height: 1.35;
        }

        .chatLog {
          flex: 1;
          min-height: 0;
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .messageBubble {
          max-width: min(760px, 82%);
          padding: 10px 14px 12px;
          line-height: 1.7;
          font-size: 15px;
          word-break: break-word;
          white-space: pre-line;
          box-shadow: 0 1px 2px rgba(31, 41, 51, 0.06);
        }

        .composer {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 14px 16px;
          border-top: 1px solid #e3e8eb;
          background: #ffffff;
          align-items: center;
        }

        .speakerSwitcher {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .speakerButton {
          padding: 10px 12px;
          background: #ffffff;
          color: #245c52;
          border: 1px solid #9eb2a7;
        }

        .speakerButton.selected {
          background: #245c52;
          color: #ffffff;
          font-weight: 700;
        }

        .messageInput {
          flex: 1 1 280px;
          min-width: 0;
          padding: 12px;
          border-radius: 6px;
          border: 1px solid #cbd5da;
          background: #ffffff;
          color: #1f2933;
          font: inherit;
          font-size: 15px;
        }

        .messageInput:disabled {
          background: #eef2f3;
          color: #6b7280;
        }

        .submitButton {
          padding: 11px 18px;
          background: #d26f3f;
          color: white;
          border: 1px solid #d26f3f;
          font-weight: 700;
        }

        @media (max-width: 900px) {
          .appShell {
            align-items: stretch;
            padding: 16px;
          }

          .workspace {
            width: 100%;
            height: auto;
            min-height: calc(100vh - 32px);
            grid-template-columns: 1fr;
            grid-template-rows: auto minmax(520px, 1fr);
            overflow: visible;
          }

          .controlPane {
            overflow: visible;
            border-right: 0;
            border-bottom: 1px solid #d7dee2;
          }

          .controlSection {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .chatPane {
            min-height: 560px;
          }

          .chatLog {
            min-height: 420px;
          }
        }

        @media (max-width: 560px) {
          .appShell {
            padding: 12px;
          }

          .workspace {
            min-height: calc(100vh - 24px);
          }

          .controlHeader {
            flex-direction: column;
            align-items: stretch;
          }

          .controlSection,
          .metricGrid {
            grid-template-columns: 1fr;
          }

          .chatHeader,
          .chatLog {
            padding-left: 16px;
            padding-right: 16px;
          }

          .messageBubble {
            max-width: 94%;
          }

          .composer {
            align-items: stretch;
          }

          .speakerSwitcher,
          .messageInput,
          .submitButton {
            width: 100%;
          }

          .speakerButton {
            flex: 1;
          }
        }
      `}</style>
    </main>
  );
}

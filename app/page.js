'use client';

import { useEffect, useRef, useState } from 'react';

const CONDITION = 'neutral_moderator_agent';
const PRESET_TOPIC_DURATION_MS = 180000;
const SILENCE_SOFT_THRESHOLD_MS = 6000;
const SILENCE_INTERVENTION_THRESHOLD_MS = 10000;
const MAX_SILENCE_INTERVENTIONS_PER_TOPIC = 2;

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
    id: 'topic_1',
    question: '最近の生活で、これからも続けたいことは何ですか。'
  },
  {
    id: 'topic_2',
    question: '年齢を重ねても、自分らしく暮らすために大切にしたいことは何ですか。'
  },
  {
    id: 'topic_3',
    question: '将来、どのような場所や環境で暮らしていたいと思いますか。'
  },
  {
    id: 'topic_4',
    question:
      '家事、買い物、通院、入浴などで手助けが必要になったら、どんな助け方なら受け入れやすいですか。'
  },
  {
    id: 'topic_5',
    question:
      '家族に手伝ってもらうことについて、気になることや遠慮してしまうことはありますか。'
  },
  {
    id: 'topic_6',
    question:
      '自分で医療や介護の方針を決めることが難しくなったら、誰に相談して決めてほしいですか。'
  },
  {
    id: 'topic_7',
    question:
      '重い病気になったとき、治療を考えるうえで一番大切にしたいことは何ですか。'
  },
  {
    id: 'topic_8',
    question:
      '人生の最終段階を考えたとき、どこで、誰と、どのように過ごせると安心だと思いますか。'
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
  return `話題 ${topicIndex + 1} です。\n\n${topics[topicIndex].question}`;
}

function getTopicEndMessage() {
  return 'この話題はここまでにします。';
}

function getFallbackIntervention(interventionCount) {
  const templates = [
    '少し考える時間が必要な話題かもしれません。話しやすいところからで大丈夫です。',
    '無理に結論を出さなくても大丈夫です。思いつく範囲で話してみてください。'
  ];

  return templates[interventionCount % templates.length];
}

function clampModeratorReply(text) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return getFallbackIntervention(0);
  if (normalized.length <= 80) return normalized;

  return `${normalized.slice(0, 79)}…`;
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
    question: topic.question,
    condition: CONDITION,
    timestamp_topic_presented: getIsoString(timeMs),
    timestamp_first_utterance: null,
    latency_to_first_utterance_ms: null,
    topic_start_time: getIsoString(timeMs),
    topic_end_time: null,
    end_reason: null,
    intervention_count: 0,
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
    .filter((entry) => entry.speaker !== 'moderator' || entry.event_type === 'silence_intervention')
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
    ? `${activeTopicLog.intervention_count} / ${MAX_SILENCE_INTERVENTIONS_PER_TOPIC}`
    : `0 / ${MAX_SILENCE_INTERVENTIONS_PER_TOPIC}`;
  const canStartTopic =
    !isSessionComplete &&
    currentTopicIndex === null &&
    nextTopicIndexRef.current < topics.length;
  const hasActiveTopic = currentTopicIndex !== null && !isSessionComplete;
  const canUseTranscriptInput =
    hasActiveTopic && topicState !== TOPIC_STATE.TOPIC_FINISHED;

  const persistSessionLog = (reason, session = sessionRef.current) => {
    session.updatedAt = getIsoString();
    session.summary = calculateSummary(session.topicLogs);

    fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        reason,
        log: session
      })
    }).catch((error) => {
      console.error('Failed to save session log', error);
    });
  };

  const syncSessionState = (reason) => {
    sessionRef.current.summary = calculateSummary(sessionRef.current.topicLogs);
    setMessages([...sessionRef.current.messages]);
    setMetricsVersion((version) => version + 1);
    persistSessionLog(reason);
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

    sessionRef.current.events.push({
      type: 'human_utterance',
      topic_id: topicLog.topic_id,
      topic_index: topicLog.topic_index,
      speaker,
      message_id: message.id,
      char_count: text.length,
      at: getIsoString(timeMs)
    });

    if (currentTopicStateRef.current === TOPIC_STATE.SILENCE_DETECTED) {
      transitionTopicState(
        TOPIC_STATE.IN_CONVERSATION,
        timeMs,
        'human_utterance_after_silence'
      );
    }
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

  const requestSilenceIntervention = async (topicLog, silenceDurationMs) => {
    const requestStartedAtMs = Date.now();
    const topicIndex = topicLog.topic_index;
    const lastHumanUtteranceEndTime = topicLog.last_human_utterance_end_time;
    const interventionNumber = topicLog.intervention_count + 1;

    interventionInFlightRef.current = true;

    topicLog.silence_events.push({
      type: 'intervention_requested',
      timestamp: getIsoString(requestStartedAtMs),
      silence_duration_ms: silenceDurationMs,
      intervention_number: interventionNumber,
      threshold_ms: SILENCE_INTERVENTION_THRESHOLD_MS
    });
    sessionRef.current.events.push({
      type: 'silence_intervention_requested',
      topic_id: topicLog.topic_id,
      topic_index: topicIndex,
      silence_duration_ms: silenceDurationMs,
      intervention_count: topicLog.intervention_count,
      at: getIsoString(requestStartedAtMs)
    });
    syncSessionState('silence_intervention_requested');

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
            question: topicLog.question
          },
          recent_transcript: getRecentTranscript(topicLog),
          silence_duration_ms: silenceDurationMs,
          intervention_count: topicLog.intervention_count
        })
      });
      const data = await response.json();
      const activeTopicStillCurrent =
        activeTopicIndexRef.current === topicIndex &&
        findActiveTopicLog()?.last_human_utterance_end_time === lastHumanUtteranceEndTime;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to request silence intervention');
      }

      if (!activeTopicStillCurrent) {
        topicLog.silence_events.push({
          type: 'intervention_cancelled',
          timestamp: getIsoString(),
          reason: 'conversation_resumed'
        });
        syncSessionState('silence_intervention_cancelled');
        return;
      }

      const timeMs = Date.now();
      const reply = clampModeratorReply(data.reply || getFallbackIntervention(0));
      const message = pushMessage({
        text: reply,
        sender: 'moderator',
        topicIndex,
        eventType: 'silence_intervention',
        timeMs
      });

      topicLog.intervention_count += 1;
      appendTranscriptEntry(topicLog, {
        speaker: 'moderator',
        text: reply,
        eventType: 'silence_intervention',
        timeMs
      });
      topicLog.silence_events.push({
        type: 'intervention_delivered',
        timestamp: getIsoString(timeMs),
        silence_duration_ms: timeMs - Date.parse(lastHumanUtteranceEndTime),
        intervention_number: topicLog.intervention_count,
        message_id: message.id,
        text: reply
      });
      sessionRef.current.events.push({
        type: 'silence_intervention_delivered',
        topic_id: topicLog.topic_id,
        topic_index: topicIndex,
        silence_duration_ms: timeMs - Date.parse(lastHumanUtteranceEndTime),
        intervention_count: topicLog.intervention_count,
        message_id: message.id,
        at: getIsoString(timeMs)
      });
      syncSessionState('silence_intervention_delivered');
    } catch (error) {
      console.error(error);

      const activeTopicStillCurrent =
        activeTopicIndexRef.current === topicIndex &&
        findActiveTopicLog()?.last_human_utterance_end_time === lastHumanUtteranceEndTime;

      if (activeTopicStillCurrent) {
        const timeMs = Date.now();
        const reply = getFallbackIntervention(topicLog.intervention_count);
        const message = pushMessage({
          text: reply,
          sender: 'moderator',
          topicIndex,
          eventType: 'silence_intervention',
          timeMs
        });

        topicLog.intervention_count += 1;
        appendTranscriptEntry(topicLog, {
          speaker: 'moderator',
          text: reply,
          eventType: 'silence_intervention',
          timeMs
        });
        topicLog.silence_events.push({
          type: 'intervention_delivered',
          timestamp: getIsoString(timeMs),
          silence_duration_ms: timeMs - Date.parse(lastHumanUtteranceEndTime),
          intervention_number: topicLog.intervention_count,
          message_id: message.id,
          text: reply,
          source: 'fallback'
        });
        syncSessionState('silence_intervention_fallback');
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
      finishActiveTopic('preset_topic_duration_elapsed', true);
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
      topicLog.intervention_count < MAX_SILENCE_INTERVENTIONS_PER_TOPIC &&
      !interventionInFlightRef.current
    ) {
      requestSilenceIntervention(topicLog, silenceDurationMs);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    persistSessionLog('session_started');

    const handlePageHide = () => {
      const session = sessionRef.current;
      session.updatedAt = getIsoString();
      session.summary = calculateSummary(session.topicLogs);

      if (!navigator.sendBeacon) return;

      const payload = JSON.stringify({
        sessionId: session.sessionId,
        reason: 'pagehide',
        log: session
      });
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/logs', blob);
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
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
    inputTextRef.current = '';
    isSessionCompleteRef.current = false;

    setMessages(nextSession.messages);
    setInputText('');
    setCurrentTopicIndex(null);
    setTopicState(TOPIC_STATE.TOPIC_FINISHED);
    setDisplayNow(Date.now());
    setMetricsVersion((version) => version + 1);
    persistSessionLog('session_started', nextSession);
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
    recordHumanUtterance(selectedSpeaker, trimmedText, timeMs);

    inputTextRef.current = '';
    setInputText('');
    syncSessionState('human_utterance');
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

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f3f0e8',
        color: '#1f2933',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        fontFamily:
          '"Hiragino Sans", "Yu Gothic", "Meiryo", system-ui, sans-serif'
      }}
    >
      <section
        aria-label="これからの暮らしについて話すチャット"
        style={{
          width: 'min(860px, 100%)',
          height: 'min(820px, calc(100vh - 48px))',
          minHeight: '620px',
          background: '#fffaf0',
          border: '1px solid #d8d1c2',
          borderRadius: '8px',
          boxShadow: '0 18px 40px rgba(31, 41, 51, 0.14)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        <header
          style={{
            background: '#245c52',
            color: 'white',
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: '20px',
                lineHeight: 1.35,
                fontWeight: 700
              }}
            >
              これからの暮らし相談
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '13px', opacity: 0.9 }}>
              中立的司会者エージェント
            </p>
          </div>

          <button
            type="button"
            onClick={resetConversation}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.7)',
              background: 'rgba(255, 255, 255, 0.12)',
              color: 'white',
              borderRadius: '6px',
              padding: '8px 12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            最初から
          </button>
        </header>

        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #e4ddcf',
            background: '#fff5df',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <div
            aria-hidden="true"
            style={{
              flex: 1,
              height: '8px',
              background: '#e5ddca',
              borderRadius: '999px',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${(progressValue / topics.length) * 100}%`,
                height: '100%',
                background: '#d26f3f'
              }}
            />
          </div>
          <span style={{ fontSize: '13px', color: '#5f6c72' }}>
            {isSessionComplete
              ? '完了'
              : currentTopicIndex === null
                ? `${Math.min(nextTopicNumber, topics.length)} / ${topics.length}`
                : `${currentTopicIndex + 1} / ${topics.length}`}
          </span>
        </div>

        <div
          style={{
            borderBottom: '1px solid #e4ddcf',
            background: '#fffaf0',
            padding: '14px 20px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            alignItems: 'center'
          }}
        >
          <button
            type="button"
            onClick={handleStartTopic}
            disabled={!canStartTopic}
            style={{
              padding: '9px 12px',
              background: canStartTopic ? '#245c52' : '#d7d1c5',
              color: canStartTopic ? 'white' : '#6b7280',
              border: '1px solid transparent',
              borderRadius: '6px',
              cursor: canStartTopic ? 'pointer' : 'default',
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            話題開始
          </button>
          <button
            type="button"
            onClick={handleNextTopic}
            disabled={!hasActiveTopic}
            style={{
              padding: '9px 12px',
              background: '#ffffff',
              color: '#245c52',
              border: '1px solid #9eb2a7',
              borderRadius: '6px',
              cursor: hasActiveTopic ? 'pointer' : 'default',
              opacity: hasActiveTopic ? 1 : 0.5,
              whiteSpace: 'nowrap'
            }}
          >
            次の話題へ
          </button>
          <button
            type="button"
            onClick={handleFinishTopic}
            disabled={!hasActiveTopic}
            style={{
              padding: '9px 12px',
              background: '#ffffff',
              color: '#8a3f2a',
              border: '1px solid #d9aa96',
              borderRadius: '6px',
              cursor: hasActiveTopic ? 'pointer' : 'default',
              opacity: hasActiveTopic ? 1 : 0.5,
              whiteSpace: 'nowrap'
            }}
          >
            この話題を終了
          </button>

          <div
            style={{
              flex: '1 1 420px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
              gap: '8px',
              minWidth: 0
            }}
          >
            {[
              ['状態', STATE_LABELS[topicState]],
              ['発話開始潜時', latencyDisplay],
              ['沈黙時間', silenceDisplay],
              ['介入回数', interventionCountDisplay]
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  minWidth: 0,
                  background: '#fbf7ee',
                  border: '1px solid #e4ddcf',
                  borderRadius: '6px',
                  padding: '7px 9px'
                }}
              >
                <div style={{ fontSize: '11px', color: '#6b7280' }}>{label}</div>
                <div
                  style={{
                    fontSize: '13px',
                    color: '#1f2933',
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            padding: '20px',
            overflowY: 'auto',
            background: '#fbf7ee',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {messages.map((message) => {
            const isModerator = message.sender === 'moderator';
            const isPartner = message.sender === 'partner';

            return (
              <div
                key={message.id}
                style={{
                  alignSelf: isModerator ? 'flex-start' : 'flex-end',
                  background: isModerator
                    ? '#ffffff'
                    : isPartner
                      ? '#5f557b'
                      : '#245c52',
                  color: isModerator ? '#1f2933' : 'white',
                  padding: '10px 14px 12px',
                  border: isModerator ? '1px solid #e0d8c8' : '1px solid transparent',
                  borderRadius: isModerator
                    ? '16px 16px 16px 4px'
                    : '16px 16px 4px 16px',
                  maxWidth: '82%',
                  lineHeight: 1.7,
                  fontSize: '15px',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-line'
                }}
              >
                {renderMessageLabel(message)}
                {message.text}
              </div>
            );
          })}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSendMessage}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            padding: '14px',
            borderTop: '1px solid #e4ddcf',
            background: '#fffaf0',
            alignItems: 'center'
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '6px',
              alignItems: 'center'
            }}
          >
            {SPEAKERS.map((speaker) => {
              const selected = selectedSpeaker === speaker.id;

              return (
                <button
                  key={speaker.id}
                  type="button"
                  onClick={() => setSelectedSpeaker(speaker.id)}
                  style={{
                    padding: '10px 12px',
                    background: selected ? '#245c52' : '#ffffff',
                    color: selected ? 'white' : '#245c52',
                    border: '1px solid #9eb2a7',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    fontWeight: selected ? 700 : 400
                  }}
                >
                  {speaker.label}
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={
              canUseTranscriptInput
                ? '発話を入力'
                : '話題開始後に入力できます'
            }
            disabled={!canUseTranscriptInput}
            style={{
              flex: '1 1 240px',
              minWidth: 0,
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #cfc5b2',
              background: canUseTranscriptInput ? 'white' : '#eee8dc',
              fontSize: '15px'
            }}
          />
          <button
            type="submit"
            disabled={!canUseTranscriptInput}
            style={{
              padding: '10px 18px',
              background: '#d26f3f',
              color: 'white',
              border: '1px solid #d26f3f',
              borderRadius: '6px',
              cursor: canUseTranscriptInput ? 'pointer' : 'default',
              opacity: canUseTranscriptInput ? 1 : 0.55,
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            追加
          </button>
        </form>
      </section>
    </main>
  );
}

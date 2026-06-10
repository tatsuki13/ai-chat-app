'use client';

import { useEffect, useRef, useState } from 'react';

const SILENCE_THRESHOLD_MS = 10000;

const topics = [
  {
    question: '最近の生活で、これからも続けたいことは何ですか。'
  },
  {
    question: '年齢を重ねても、自分らしく暮らすために大切にしたいことは何ですか。'
  },
  {
    question: '将来、どのような場所や環境で暮らしていたいと思いますか。'
  },
  {
    question:
      '家事、買い物、通院、入浴などで手助けが必要になったら、どんな助け方なら受け入れやすいですか。'
  },
  {
    question:
      '家族に手伝ってもらうことについて、気になることや遠慮してしまうことはありますか。'
  },
  {
    question:
      '自分で医療や介護の方針を決めることが難しくなったら、誰に相談して決めてほしいですか。'
  },
  {
    question:
      '重い病気になったとき、治療を考えるうえで一番大切にしたいことは何ですか。'
  },
  {
    question:
      '人生の最終段階を考えたとき、どこで、誰と、どのように過ごせると安心だと思いますか。'
  }
];

function getTopicStartMessage(topicIndex) {
  return `話題 ${topicIndex + 1} です。\n\n${topics[topicIndex].question}`;
}

function getIsoString(timeMs = Date.now()) {
  return new Date(timeMs).toISOString();
}

function getAverage(values) {
  if (values.length === 0) return null;

  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function calculateSummary(topicLogs) {
  const analyzableTopics = topicLogs.filter((topicLog) =>
    ['answered', 'manual_skip', 'silence_skip'].includes(topicLog.completionType)
  );
  const skippedTopics = analyzableTopics.filter((topicLog) =>
    ['manual_skip', 'silence_skip'].includes(topicLog.completionType)
  );
  const speechStartLatencies = analyzableTopics
    .map((topicLog) => topicLog.speechStartLatencyMs)
    .filter((value) => Number.isFinite(value));
  const silenceDurations = analyzableTopics
    .map((topicLog) => topicLog.silenceDurationMs)
    .filter((value) => Number.isFinite(value));

  return {
    topicCount: topics.length,
    startedTopicCount: topicLogs.length,
    completedTopicCount: analyzableTopics.length,
    answeredCount: analyzableTopics.filter(
      (topicLog) => topicLog.completionType === 'answered'
    ).length,
    skippedCount: skippedTopics.length,
    manualSkipCount: analyzableTopics.filter(
      (topicLog) => topicLog.completionType === 'manual_skip'
    ).length,
    silenceSkipCount: analyzableTopics.filter(
      (topicLog) => topicLog.completionType === 'silence_skip'
    ).length,
    resetTopicCount: topicLogs.filter((topicLog) => topicLog.completionType === 'reset')
      .length,
    skipRate:
      analyzableTopics.length === 0
        ? 0
        : Number((skippedTopics.length / analyzableTopics.length).toFixed(4)),
    averageSpeechStartLatencyMs: getAverage(speechStartLatencies),
    averageSilenceDurationMs: getAverage(silenceDurations),
    totalSilenceDurationMs: silenceDurations.reduce((total, value) => total + value, 0)
  };
}

function createSessionId() {
  const randomPart =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `session-${getIsoString().replace(/[:.]/g, '-')}-${randomPart}`;
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

function createTopicLog({ topicIndex, source, timeMs }) {
  return {
    topicIndex,
    question: topics[topicIndex].question,
    startedAt: getIsoString(timeMs),
    startSource: source,
    firstInputAt: null,
    speechStartLatencyMs: null,
    completedAt: null,
    completionType: null,
    silenceDurationMs: null,
    topicElapsedMs: null
  };
}

function createInitialSession() {
  const timeMs = Date.now();
  const firstMessage = createMessage({
    id: 1,
    text: getTopicStartMessage(0),
    sender: 'bot',
    topicIndex: 0,
    eventType: 'topic_start',
    timeMs
  });
  const topicLogs = [createTopicLog({ topicIndex: 0, source: 'initial', timeMs })];

  return {
    sessionId: createSessionId(),
    startedAt: getIsoString(timeMs),
    updatedAt: getIsoString(timeMs),
    completedAt: null,
    resetAt: null,
    silenceThresholdMs: SILENCE_THRESHOLD_MS,
    topics: topics.map((topic, index) => ({
      topicIndex: index,
      question: topic.question
    })),
    messages: [firstMessage],
    events: [
      {
        type: 'topic_started',
        topicIndex: 0,
        source: 'initial',
        messageId: firstMessage.id,
        at: getIsoString(timeMs)
      }
    ],
    topicLogs,
    summary: calculateSummary(topicLogs)
  };
}

export default function ChatPage() {
  const initialSessionRef = useRef(null);

  if (initialSessionRef.current === null) {
    initialSessionRef.current = createInitialSession();
  }

  const sessionRef = useRef(initialSessionRef.current);
  const nextMessageIdRef = useRef(sessionRef.current.messages.length + 1);
  const currentTopicIndexRef = useRef(0);
  const topicStartedAtMsRef = useRef(
    Date.parse(sessionRef.current.topicLogs[0].startedAt)
  );
  const lastActivityAtMsRef = useRef(topicStartedAtMsRef.current);
  const speechStartedRef = useRef(false);
  const inputTextRef = useRef('');
  const isCompleteRef = useRef(false);
  const messagesEndRef = useRef(null);

  const [messages, setMessages] = useState(sessionRef.current.messages);
  const [inputText, setInputText] = useState('');
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);

  const isComplete = currentTopicIndex >= topics.length;
  const progressValue = Math.min(currentTopicIndex + 1, topics.length);

  const persistSessionLog = (reason, session = sessionRef.current) => {
    session.updatedAt = getIsoString();
    session.summary = calculateSummary(session.topicLogs);

    const payload = JSON.stringify({
      sessionId: session.sessionId,
      reason,
      log: session
    });

    fetch('/api/logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: payload
    }).catch((error) => {
      console.error('Failed to save session log', error);
    });
  };

  const syncSessionState = (reason) => {
    sessionRef.current.summary = calculateSummary(sessionRef.current.topicLogs);
    setMessages([...sessionRef.current.messages]);
    persistSessionLog(reason);
  };

  const setActiveTopicIndex = (topicIndex) => {
    currentTopicIndexRef.current = topicIndex;
    isCompleteRef.current = topicIndex >= topics.length;
    setCurrentTopicIndex(topicIndex);
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

  const findCurrentTopicLog = () =>
    sessionRef.current.topicLogs.find(
      (topicLog) => topicLog.topicIndex === currentTopicIndexRef.current
    );

  const recordSpeechStarted = (timeMs, shouldPersist = true) => {
    if (speechStartedRef.current || isCompleteRef.current) return;

    const topicLog = findCurrentTopicLog();
    if (!topicLog) return;

    const latencyMs = Math.max(0, timeMs - topicStartedAtMsRef.current);

    speechStartedRef.current = true;
    topicLog.firstInputAt = getIsoString(timeMs);
    topicLog.speechStartLatencyMs = latencyMs;
    sessionRef.current.events.push({
      type: 'speech_started',
      topicIndex: currentTopicIndexRef.current,
      latencyMs,
      at: getIsoString(timeMs)
    });

    if (shouldPersist) {
      persistSessionLog('speech_started');
    }
  };

  const completeCurrentTopic = (completionType, timeMs) => {
    const topicLog = findCurrentTopicLog();
    if (!topicLog || topicLog.completedAt) return currentTopicIndexRef.current;

    const silenceDurationMs = Math.max(0, timeMs - lastActivityAtMsRef.current);
    const topicElapsedMs = Math.max(0, timeMs - topicStartedAtMsRef.current);

    topicLog.completedAt = getIsoString(timeMs);
    topicLog.completionType = completionType;
    topicLog.silenceDurationMs = silenceDurationMs;
    topicLog.topicElapsedMs = topicElapsedMs;
    sessionRef.current.events.push({
      type: completionType === 'answered' ? 'topic_answered' : 'topic_skipped',
      topicIndex: currentTopicIndexRef.current,
      completionType,
      speechStartLatencyMs: topicLog.speechStartLatencyMs,
      silenceDurationMs,
      topicElapsedMs,
      at: getIsoString(timeMs)
    });

    return currentTopicIndexRef.current;
  };

  const startTopic = (topicIndex, source, timeMs) => {
    const message = pushMessage({
      text: getTopicStartMessage(topicIndex),
      sender: 'bot',
      topicIndex,
      eventType: 'topic_start',
      timeMs
    });

    sessionRef.current.topicLogs.push(
      createTopicLog({ topicIndex, source, timeMs })
    );
    sessionRef.current.events.push({
      type: 'topic_started',
      topicIndex,
      source,
      messageId: message.id,
      at: getIsoString(timeMs)
    });

    topicStartedAtMsRef.current = timeMs;
    lastActivityAtMsRef.current = timeMs;
    speechStartedRef.current = false;
    setActiveTopicIndex(topicIndex);
  };

  const completeSession = (timeMs) => {
    if (sessionRef.current.completedAt) return;

    sessionRef.current.completedAt = getIsoString(timeMs);
    sessionRef.current.events.push({
      type: 'session_completed',
      at: getIsoString(timeMs),
      summary: calculateSummary(sessionRef.current.topicLogs)
    });
    setActiveTopicIndex(topics.length);
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
    if (isComplete || inputText.trim()) return undefined;

    const timerId = window.setTimeout(() => {
      if (isCompleteRef.current || inputTextRef.current.trim()) return;

      const timeMs = Date.now();
      const silenceDurationMs = timeMs - lastActivityAtMsRef.current;
      if (silenceDurationMs < SILENCE_THRESHOLD_MS) return;

      const completedTopicIndex = completeCurrentTopic('silence_skip', timeMs);
      const nextTopicIndex = completedTopicIndex + 1;

      if (nextTopicIndex < topics.length) {
        startTopic(nextTopicIndex, 'silence_timeout', timeMs);
      } else {
        completeSession(timeMs);
      }

      syncSessionState('silence_timeout');
    }, SILENCE_THRESHOLD_MS);

    return () => window.clearTimeout(timerId);
  }, [currentTopicIndex, inputText, isComplete]);

  const resetConversation = () => {
    const timeMs = Date.now();
    const activeTopicLog = findCurrentTopicLog();

    if (activeTopicLog && !activeTopicLog.completedAt) {
      activeTopicLog.completedAt = getIsoString(timeMs);
      activeTopicLog.completionType = 'reset';
      activeTopicLog.silenceDurationMs = Math.max(
        0,
        timeMs - lastActivityAtMsRef.current
      );
      activeTopicLog.topicElapsedMs = Math.max(0, timeMs - topicStartedAtMsRef.current);
    }

    sessionRef.current.resetAt = getIsoString(timeMs);
    sessionRef.current.events.push({
      type: 'session_reset',
      topicIndex: currentTopicIndexRef.current,
      at: getIsoString(timeMs)
    });
    persistSessionLog('session_reset');

    const nextSession = createInitialSession();
    sessionRef.current = nextSession;
    nextMessageIdRef.current = nextSession.messages.length + 1;
    currentTopicIndexRef.current = 0;
    topicStartedAtMsRef.current = Date.parse(nextSession.topicLogs[0].startedAt);
    lastActivityAtMsRef.current = topicStartedAtMsRef.current;
    speechStartedRef.current = false;
    inputTextRef.current = '';
    isCompleteRef.current = false;

    setMessages(nextSession.messages);
    setInputText('');
    setCurrentTopicIndex(0);
    persistSessionLog('session_started');
  };

  const handleInputChange = (event) => {
    const nextText = event.target.value;
    const timeMs = Date.now();

    inputTextRef.current = nextText;
    setInputText(nextText);

    if (isCompleteRef.current) return;

    lastActivityAtMsRef.current = timeMs;

    if (nextText.trim()) {
      recordSpeechStarted(timeMs);
    }
  };

  const handleSendMessage = (event) => {
    event.preventDefault();

    const trimmedText = inputTextRef.current.trim();
    if (!trimmedText || isCompleteRef.current) return;

    const timeMs = Date.now();
    recordSpeechStarted(timeMs, false);
    inputTextRef.current = '';
    setInputText('');

    const userMessage = pushMessage({
      text: trimmedText,
      sender: 'user',
      topicIndex: currentTopicIndexRef.current,
      eventType: 'user_answer',
      timeMs
    });

    sessionRef.current.events.push({
      type: 'user_message',
      topicIndex: currentTopicIndexRef.current,
      messageId: userMessage.id,
      text: trimmedText,
      at: getIsoString(timeMs)
    });

    const completedTopicIndex = completeCurrentTopic('answered', timeMs);
    const nextTopicIndex = completedTopicIndex + 1;

    if (nextTopicIndex < topics.length) {
      startTopic(nextTopicIndex, 'after_answer', timeMs);
    } else {
      completeSession(timeMs);
    }

    syncSessionState('user_answer');
  };

  const handleSkipTopic = () => {
    if (isCompleteRef.current) return;

    const timeMs = Date.now();
    inputTextRef.current = '';
    setInputText('');

    const completedTopicIndex = completeCurrentTopic('manual_skip', timeMs);
    const nextTopicIndex = completedTopicIndex + 1;

    if (nextTopicIndex < topics.length) {
      startTopic(nextTopicIndex, 'manual_skip', timeMs);
    } else {
      completeSession(timeMs);
    }

    syncSessionState('manual_skip');
  };

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
          width: 'min(760px, 100%)',
          height: 'min(760px, calc(100vh - 48px))',
          minHeight: '560px',
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
              中立的司会者が話題開始のみを行います
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
            {isComplete ? '完了' : `${progressValue} / ${topics.length}`}
          </span>
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
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
                background: message.sender === 'user' ? '#245c52' : '#ffffff',
                color: message.sender === 'user' ? 'white' : '#1f2933',
                padding: '12px 14px',
                border:
                  message.sender === 'user'
                    ? '1px solid #245c52'
                    : '1px solid #e0d8c8',
                borderRadius:
                  message.sender === 'user'
                    ? '16px 16px 4px 16px'
                    : '16px 16px 16px 4px',
                maxWidth: '82%',
                lineHeight: 1.7,
                fontSize: '15px',
                wordBreak: 'break-word',
                whiteSpace: 'pre-line'
              }}
            >
              {message.text}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSendMessage}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            gap: '10px',
            padding: '14px',
            borderTop: '1px solid #e4ddcf',
            background: '#fffaf0'
          }}
        >
          <input
            type="text"
            value={inputText}
            onChange={handleInputChange}
            placeholder={
              isComplete
                ? '最初から始めると、もう一度話せます'
                : 'ここに返答を入力'
            }
            disabled={isComplete}
            style={{
              minWidth: 0,
              padding: '12px',
              borderRadius: '6px',
              border: '1px solid #cfc5b2',
              background: isComplete ? '#eee8dc' : 'white',
              fontSize: '15px'
            }}
          />
          <button
            type="button"
            onClick={handleSkipTopic}
            disabled={isComplete}
            style={{
              padding: '10px 14px',
              background: '#ffffff',
              color: '#245c52',
              border: '1px solid #9eb2a7',
              borderRadius: '6px',
              cursor: isComplete ? 'default' : 'pointer',
              opacity: isComplete ? 0.5 : 1,
              whiteSpace: 'nowrap'
            }}
          >
            スキップ
          </button>
          <button
            type="submit"
            disabled={isComplete}
            style={{
              padding: '10px 18px',
              background: '#d26f3f',
              color: 'white',
              border: '1px solid #d26f3f',
              borderRadius: '6px',
              cursor: isComplete ? 'default' : 'pointer',
              opacity: isComplete ? 0.55 : 1,
              whiteSpace: 'nowrap',
              fontWeight: 700
            }}
          >
            送信
          </button>
        </form>
      </section>
    </main>
  );
}

"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createLiveTranscriptKey,
  type LiveTranscriptEvent,
  type RemoteMicRealtimeEvent,
  type RemoteMicRole,
} from "../../../lib/remote-mic/control-events";

type PracticeMode = "practice" | "experiment";
type Speaker = RemoteMicRole;
type SpeechPhase =
  | "idle"
  | "preparing-mute"
  | "ready-to-play"
  | "playing"
  | "echo-guard"
  | "resuming"
  | "error";
type PlaybackStatus = "completed" | "failed" | "cancelled" | "text_only" | "not_started";
type PracticeStep = "setup" | "talk" | "question" | "second-topic" | "completed";
type PracticeSession = {
  id: string;
  condition: string | null;
};
type PracticeTopic = {
  id: string;
  title: string;
  openingPrompt: string;
  hints?: string[];
};
type PracticeUtterance = {
  id: string;
  speaker: Speaker;
  text: string;
  created_at: string;
  source_group_id?: string | null;
};
type LiveTranscript = {
  key: string;
  sessionId: string;
  role: Speaker;
  streamId: string;
  transcriptId: string;
  revision: number;
  text: string;
  status: "partial" | "final";
  startedAt?: string;
  firstPartialAt?: string;
  finalizedAt?: string;
};
type RemoteMicRoleStatus = {
  status: "connected" | "disconnected";
  ready: boolean;
  readyReason?: string | null;
  lastSeenAt?: string | null;
  lastHeartbeatAt?: string | null;
  muted?: boolean;
  realtimeConnected?: boolean;
  captureState?: "idle" | "listening" | "suppressed" | "reconnecting" | "error";
};
type FixedRemoteMicActiveState = {
  sessionId: string;
  participantCode: string | null;
  mode?: PracticeMode;
  endedAt: string | null;
  dialogueStartedAt: string | null;
  roles: Record<Speaker, RemoteMicRoleStatus>;
};
type FixedRemoteMicActiveResponse = {
  active: FixedRemoteMicActiveState | null;
};
type AiSpeechStateResponse = {
  state: {
    revision?: number | null;
  } | null;
};

const MODE: PracticeMode = "practice";
const PRACTICE_TOPICS: PracticeTopic[] = [
  {
    id: "practice-animals-1",
    title: "操作練習の話題 1",
    openingPrompt:
      "好きな動物は何ですか。その動物のどのようなところが好きか、二人で話してみてください。",
    hints: ["どんなところが好きですか", "なんで好きになったんでしょうか"],
  },
  {
    id: "practice-animals-2",
    title: "操作練習の話題 2",
    openingPrompt:
      "動物を飼った経験や、動物と触れ合った思い出があれば、二人で話してみてください。",
  },
];
const REMOTE_MIC_STATUS_POLL_MS = 1500;
const REMOTE_MIC_CONTROL_STATE_TIMEOUT_MS = 8000;
const REMOTE_MIC_CONTROL_STATE_POLL_MS = 250;
const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45000;
const BROWSER_SPEECH_ENABLED =
  process.env.NEXT_PUBLIC_BROWSER_SPEECH_ENABLED !== "false";

export default function PracticePage() {
  return (
    <Suspense fallback={<PracticeLoading />}>
      <PracticePageClient />
    </Suspense>
  );
}

function PracticePageClient() {
  const router = useRouter();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [topicIndex, setTopicIndex] = useState(0);
  const [step, setStep] = useState<PracticeStep>("setup");
  const [utterances, setUtterances] = useState<PracticeUtterance[]>([]);
  const [liveTranscripts, setLiveTranscripts] = useState<Record<string, LiveTranscript>>({});
  const [remoteMicStatuses, setRemoteMicStatuses] = useState<Record<Speaker, RemoteMicRoleStatus>>(
    emptyRemoteMicStatuses(),
  );
  const [setupError, setSetupError] = useState("");
  const [statusText, setStatusText] = useState("練習を準備しています");
  const [questionText, setQuestionText] = useState("");
  const [questionError, setQuestionError] = useState("");
  const [questionLoading, setQuestionLoading] = useState(false);
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase>("idle");
  const [spokenTopicIds, setSpokenTopicIds] = useState<Record<string, boolean>>({});

  const sessionRef = useRef<PracticeSession | null>(null);
  const utterancesRef = useRef<PracticeUtterance[]>([]);
  const liveTranscriptsRef = useRef<Record<string, LiveTranscript>>({});
  const remoteMicStatusesRef = useRef<Record<Speaker, RemoteMicRoleStatus>>(
    emptyRemoteMicStatuses(),
  );
  const questionInFlightRef = useRef<Promise<void> | null>(null);
  const activePlaybackRef = useRef<{
    sessionId: string;
    playbackId: string;
    contentType: "topic" | "question";
  } | null>(null);

  const currentTopic = PRACTICE_TOPICS[topicIndex] ?? PRACTICE_TOPICS[0];
  const connectedRoles = getConnectedRoles(remoteMicStatuses);
  const missingRoles = getMissingRoles(remoteMicStatuses);
  const bothMicsReady = missingRoles.length === 0;
  const conversationEntries = createConversationEntries(
    utterances,
    Object.values(liveTranscripts),
  );
  const currentInstruction = getCurrentInstruction({
    step,
    bothMicsReady,
    questionLoading,
    speechPhase,
  });

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    utterancesRef.current = utterances;
  }, [utterances]);

  useEffect(() => {
    liveTranscriptsRef.current = liveTranscripts;
  }, [liveTranscripts]);

  useEffect(() => {
    remoteMicStatusesRef.current = remoteMicStatuses;
  }, [remoteMicStatuses]);

  useEffect(() => {
    let cancelled = false;

    async function createPracticeSession() {
      setSetupError("");
      try {
        const response = await fetch("/api/session/practice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: MODE }),
        });
        if (!response.ok) throw new Error(`practice session failed: ${response.status}`);

        const data = (await response.json()) as {
          session: PracticeSession;
          active?: FixedRemoteMicActiveState;
        };
        if (cancelled) {
          void cleanupPracticeSession(data.session.id);
          return;
        }

        sessionRef.current = data.session;
        setSession(data.session);
        if (data.active?.roles) {
          setRemoteMicStatuses(normalizeRemoteMicStatuses(data.active.roles));
        }
        setStatusText("スマートフォンマイクを接続してください");
      } catch (error) {
        console.warn("[practice setup failed]", error);
        setSetupError("練習ページを準備できませんでした。実験担当者にお知らせください。");
        setStatusText("準備エラー");
      }
    }

    void createPracticeSession();

    return () => {
      cancelled = true;
      const practiceSession = sessionRef.current;
      if (practiceSession) {
        void cleanupPracticeSession(practiceSession.id);
      }
      cancelBrowserSpeech();
    };
  }, []);

  useEffect(() => {
    if (!session?.id) return;

    let stopped = false;
    async function refresh() {
      const status = await fetchFixedRemoteMicStatus(session.id).catch((error) => {
        console.warn("[practice remote mic status failed]", error);
        return null;
      });
      if (!status || stopped) return;
      setRemoteMicStatuses(status.roles);
    }

    void refresh();
    const timerId = window.setInterval(() => void refresh(), REMOTE_MIC_STATUS_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timerId);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;

    const source = new EventSource(
      `/api/ai/speech-state/stream?sessionId=${encodeURIComponent(session.id)}`,
    );
    source.onmessage = (event) => {
      try {
        handleRemoteMicRealtimeEvent(JSON.parse(event.data) as RemoteMicRealtimeEvent);
      } catch {}
    };
    source.onerror = () => {
      console.warn("[practice speech stream disconnected]", { sessionId: session.id });
    };

    return () => {
      source.close();
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id || !bothMicsReady || step === "completed") return;
    if (spokenTopicIds[currentTopic.id] || speechPhase !== "idle") return;

    setSpokenTopicIds((current) => ({ ...current, [currentTopic.id]: true }));
    setStep(topicIndex === 0 ? "talk" : "second-topic");
    setStatusText("話題を読み上げています");
    void playSpokenContent({
      contentType: "topic",
      text: currentTopic.openingPrompt,
      topicId: currentTopic.id,
    }).finally(() => {
      if (sessionRef.current?.id === session.id) {
        setStatusText("表示された話題について話してください");
      }
    });
  }, [
    bothMicsReady,
    currentTopic.id,
    currentTopic.openingPrompt,
    session?.id,
    speechPhase,
    spokenTopicIds,
    step,
    topicIndex,
  ]);

  async function handleGeneratePracticeQuestion() {
    if (questionInFlightRef.current) {
      await questionInFlightRef.current;
      return;
    }

    const run = runGeneratePracticeQuestion();
    questionInFlightRef.current = run.finally(() => {
      questionInFlightRef.current = null;
    });
    await questionInFlightRef.current;
  }

  async function runGeneratePracticeQuestion() {
    if (!sessionRef.current || questionLoading) return;
    if (!bothMicsReady) {
      setQuestionError(getMissingMicMessage(missingRoles));
      return;
    }

    setQuestionLoading(true);
    setQuestionError("");
    setStatusText("AIの質問を生成しています");

    try {
      const response = await fetch("/api/ai/practice-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: MODE,
          topic: currentTopic.openingPrompt,
          utterances: utterancesRef.current.map((utterance) => ({
            speaker: utterance.speaker,
            text: utterance.text,
          })),
        }),
      });
      if (!response.ok) throw new Error(`practice question failed: ${response.status}`);

      const data = (await response.json()) as {
        suggestion?: { transition_phrase?: string; question?: string | null };
      };
      const nextQuestion = [
        data.suggestion?.transition_phrase?.trim(),
        data.suggestion?.question?.trim(),
      ].filter(Boolean).join("\n\n");

      if (!nextQuestion) throw new Error("practice question empty");

      setQuestionText(nextQuestion);
      setStep("question");
      setStatusText("AIの質問を読み上げています");
      await playSpokenContent({
        contentType: "question",
        text: nextQuestion,
        topicId: currentTopic.id,
      });
      setStatusText("質問の表示と読み上げを確認してください");
    } catch (error) {
      console.warn("[practice question failed]", error);
      const fallback = "その動物のことを思い出すと、どんな気持ちになりますか。";
      setQuestionText(fallback);
      setQuestionError("質問生成に失敗したため、練習用の質問を表示しました。");
      setStep("question");
      await playSpokenContent({
        contentType: "question",
        text: fallback,
        topicId: currentTopic.id,
      }).catch(() => undefined);
      setStatusText("練習は続けられます");
    } finally {
      setQuestionLoading(false);
    }
  }

  function handleNextTopic() {
    if (topicIndex >= PRACTICE_TOPICS.length - 1) return;
    setTopicIndex((current) => current + 1);
    setQuestionText("");
    setQuestionError("");
    setStep("second-topic");
    setStatusText("次の練習話題に進みました");
  }

  async function handleFinishPractice() {
    const practiceSession = sessionRef.current;
    cancelBrowserSpeech();
    setSpeechPhase("idle");
    setStep("completed");
    setStatusText("練習は完了です");
    setSession(null);
    sessionRef.current = null;
    setRemoteMicStatuses(emptyRemoteMicStatuses());
    if (practiceSession) {
      await cleanupPracticeSession(practiceSession.id).catch((error) => {
        console.warn("[practice cleanup after finish failed]", error);
      });
    }
  }

  function handleProceedToExperiment() {
    router.push("/session");
  }

  function handleRemoteMicRealtimeEvent(event: RemoteMicRealtimeEvent) {
    if (event.sessionId !== sessionRef.current?.id) return;

    if (event.type === "transcript.partial" || event.type === "transcript.final") {
      applyLiveTranscriptEvent(event);
      return;
    }

    if (event.type === "transcript.discarded") {
      const key = createLiveTranscriptKey(event);
      setLiveTranscripts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    if (
      event.type === "ai_speech_snapshot" ||
      event.type === "ai_speech_started" ||
      event.type === "ai_speech_ended"
    ) {
      if (event.type === "ai_speech_started" && event.active) {
        setSpeechPhase("playing");
      } else if (event.type === "ai_speech_ended") {
        setSpeechPhase("echo-guard");
      }
      if ("roles" in event && event.roles) {
        setRemoteMicStatuses(normalizeRemoteMicStatuses(event.roles as Record<Speaker, RemoteMicRoleStatus>));
      }
    }
  }

  function applyLiveTranscriptEvent(event: LiveTranscriptEvent) {
    const key = createLiveTranscriptKey(event);
    const transcript: LiveTranscript = {
      key,
      sessionId: event.sessionId,
      role: event.role,
      streamId: event.streamId,
      transcriptId: event.transcriptId,
      revision: event.revision,
      text: event.text,
      status: event.type === "transcript.final" ? "final" : "partial",
      startedAt: event.startedAt,
      firstPartialAt: event.firstPartialAt,
      finalizedAt: event.finalizedAt,
    };

    if (event.type === "transcript.final") {
      setLiveTranscripts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setUtterances((current) => {
        if (current.some((utterance) => utterance.source_group_id === event.transcriptId)) {
          return current;
        }
        return [
          ...current,
          {
            id: `practice-${event.role}-${event.transcriptId}`,
            speaker: event.role,
            text: event.text,
            created_at: event.finalizedAt ?? new Date().toISOString(),
            source_group_id: event.transcriptId,
          },
        ].slice(-30);
      });
      return;
    }

    setLiveTranscripts((current) => ({
      ...current,
      [key]: transcript,
    }));
  }

  async function playSpokenContent(input: {
    contentType: "topic" | "question";
    text: string;
    topicId: string | null;
  }) {
    const currentSession = sessionRef.current;
    const text = input.text.trim();
    if (!currentSession || !text || activePlaybackRef.current) return;

    const playbackId = crypto.randomUUID();
    let playbackStatus: PlaybackStatus = "failed";
    let playbackErrorCode: string | null = null;
    let speechStateStarted = false;
    const ackTargetRoles = getConnectedRoles(remoteMicStatusesRef.current);
    activePlaybackRef.current = {
      sessionId: currentSession.id,
      playbackId,
      contentType: input.contentType,
    };

    try {
      setSpeechPhase("preparing-mute");
      const startResponse = await updateAiSpeechState({
        sessionId: currentSession.id,
        action: "start",
        playbackId,
        contentType: input.contentType,
      });
      speechStateStarted = true;
      if (getAiSpeechStateRevision(startResponse) === null) {
        throw new Error("speech-state revision missing");
      }

      const suppressed = await waitForRemoteMicCaptureState({
        sessionId: currentSession.id,
        captureState: "suppressed",
        targetRoles: ackTargetRoles,
      });
      if (suppressed.ok === false) {
        playbackStatus = "not_started";
        playbackErrorCode = suppressed.reason;
        setSetupError(getMicControlError("マイクの一時ミュートを確認できませんでした", suppressed.roles));
        setSpeechPhase("error");
        return;
      }

      setSpeechPhase("ready-to-play");
      if (BROWSER_SPEECH_ENABLED) {
        const speechResult = await playBrowserSpeech(text, () => {
          setSpeechPhase("playing");
        });
        playbackStatus = speechResult.status;
        playbackErrorCode = speechResult.errorCode;
      } else {
        playbackStatus = "text_only";
        playbackErrorCode = "browser_speech_unavailable";
      }
    } catch (error) {
      playbackStatus = "failed";
      playbackErrorCode =
        error instanceof Error ? error.name || error.message : "playback_failed";
      setSpeechPhase("error");
    } finally {
      if (speechStateStarted) {
        setSpeechPhase(playbackStatus === "completed" ? "echo-guard" : "resuming");
        await updateAiSpeechState({
          sessionId: currentSession.id,
          action: playbackStatus === "completed" ? "end" : "cancel",
          playbackId,
          contentType: input.contentType,
          playbackStatus,
          playbackErrorCode,
        }).catch((error) => {
          console.warn("[practice speech-state release failed]", error);
        });

        const resumed = await waitForRemoteMicCaptureState({
          sessionId: currentSession.id,
          captureState: "listening",
          targetRoles: ackTargetRoles,
        });
        if (resumed.ok === false) {
          setSetupError(getMicControlError("マイクの自動復帰を確認できませんでした", resumed.roles));
        }
      }

      activePlaybackRef.current = null;
      setSpeechPhase("idle");
    }
  }

  const micIssue = useMemo(() => getMissingMicMessage(missingRoles), [missingRoles]);

  if (step === "completed") {
    return (
      <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
          <div className="rounded-md border border-stone-200 bg-white p-6 shadow-sm">
            <div className="text-[12px] font-black uppercase tracking-[0.08em] text-emerald-700">
              操作練習
            </div>
            <h1 className="mt-3 text-2xl font-black">操作の練習は完了です。</h1>
            <p className="mt-3 text-[15px] font-bold leading-relaxed text-stone-700">
              分からないことがある場合は、実験担当者にお知らせください。
            </p>
            <button
              type="button"
              onClick={handleProceedToExperiment}
              className="mt-6 min-h-12 rounded-md bg-stone-950 px-5 text-[15px] font-black text-white active:scale-[0.99]"
            >
              本番へ進む
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-4 text-stone-950">
      <section className="mx-auto flex max-w-6xl flex-col gap-3">
        <header className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-black uppercase tracking-[0.08em] text-emerald-800">
                操作練習
              </div>
              <h1 className="mt-1 text-xl font-black">本番前の操作確認</h1>
            </div>
            <div className="rounded-md bg-white px-3 py-1 text-[12px] font-black text-stone-700">
              {statusText}
            </div>
          </div>
          <p className="mt-2 max-w-3xl whitespace-pre-line text-[13px] font-bold leading-relaxed text-stone-700">
            これから操作の練習を行います。{"\n"}
            画面に表示された話題について、普段どおりお話しください。{"\n"}
            途中で「AIに質問してもらう」と「次の話題へ」を一度ずつ試します。{"\n"}
            この練習内容は、本番の記録には含まれません。
          </p>
        </header>

        <div className="grid gap-3 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <section className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <h2 className="text-[14px] font-black">現在行う操作</h2>
              <p className="mt-2 rounded-md bg-stone-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-stone-700">
                {currentInstruction}
              </p>
              {micIssue ? (
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-900">
                  {micIssue}
                </p>
              ) : null}
              {setupError ? (
                <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-800">
                  {setupError}
                </p>
              ) : null}
            </section>

            <section className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <h2 className="text-[14px] font-black">スマートフォンマイク</h2>
              <div className="mt-2 grid gap-2">
                <MicStatusRow label="本人用マイク" status={remoteMicStatuses.elder} />
                <MicStatusRow label="介護者用マイク" status={remoteMicStatuses.caregiver} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href="/mic/elder"
                  target="_blank"
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-[12px] font-black text-stone-700"
                >
                  本人用を開く
                </a>
                <a
                  href="/mic/caregiver"
                  target="_blank"
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-[12px] font-black text-stone-700"
                >
                  介護者用を開く
                </a>
              </div>
            </section>
          </aside>

          <section className="grid min-h-[70vh] gap-3 lg:grid-rows-[auto_minmax(0,1fr)_auto]">
            <section className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
              <div className="text-[12px] font-black text-emerald-700">
                {currentTopic.title}
              </div>
              <p className="mt-2 whitespace-pre-line text-[20px] font-black leading-relaxed">
                {currentTopic.openingPrompt}
              </p>
              {currentTopic.hints?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {currentTopic.hints.map((hint) => (
                    <span
                      key={hint}
                      className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-[12px] font-bold text-stone-600"
                    >
                      {hint}
                    </span>
                  ))}
                </div>
              ) : null}
              {questionText ? (
                <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                  <div className="text-[12px] font-black text-sky-800">
                    AIの質問
                  </div>
                  <p className="mt-1 whitespace-pre-line text-[16px] font-black leading-relaxed text-sky-950">
                    {questionText}
                  </p>
                  {questionError ? (
                    <p className="mt-2 text-[12px] font-bold text-amber-800">
                      {questionError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="min-h-[320px] overflow-hidden rounded-md border border-stone-200 bg-white shadow-sm">
              <div className="border-b border-stone-200 px-4 py-2 text-[13px] font-black">
                会話ログ
              </div>
              <div className="flex h-full max-h-[48vh] flex-col gap-2 overflow-y-auto p-3">
                {conversationEntries.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center rounded-md bg-stone-50 px-4 text-center text-[13px] font-bold text-stone-500">
                    スマートフォンマイクで話すと、ここに発話が表示されます。
                  </div>
                ) : (
                  conversationEntries.map((entry) =>
                    entry.kind === "live" ? (
                      <LiveSpeechBubble key={entry.key} transcript={entry.transcript} />
                    ) : (
                      <SpeechBubble key={entry.key} utterance={entry.utterance} />
                    ),
                  )
                )}
              </div>
            </section>

            <footer className="grid gap-2 sm:grid-cols-3">
              <ActionButton
                label="AIに質問してもらう"
                busy={questionLoading}
                disabled={!session || !bothMicsReady || questionLoading || speechPhase !== "idle"}
                onClick={() => void handleGeneratePracticeQuestion()}
              />
              <ActionButton
                label="次の話題へ"
                busy={false}
                disabled={topicIndex >= PRACTICE_TOPICS.length - 1 || speechPhase !== "idle"}
                onClick={handleNextTopic}
              />
              <ActionButton
                label="練習を終了する"
                busy={false}
                disabled={speechPhase !== "idle" && speechPhase !== "error"}
                onClick={() => void handleFinishPractice()}
              />
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}

function PracticeLoading() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <div className="mx-auto max-w-3xl rounded-md border border-stone-200 bg-white p-5 text-[14px] font-bold">
        練習ページを準備しています。
      </div>
    </main>
  );
}

function MicStatusRow(props: { label: string; status: RemoteMicRoleStatus }) {
  const ready = props.status.ready;
  const captureState = props.status.captureState ?? "idle";
  const value = ready
    ? captureState === "suppressed"
      ? "AI音声中ミュート"
      : "接続済み"
    : props.status.status === "connected"
      ? "接続確認中"
      : "未接続";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-bold text-stone-600">{props.label}</span>
      <span
        className={`rounded-md px-2 py-0.5 text-[11px] font-black ${
          ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function LiveSpeechBubble(props: { transcript: LiveTranscript }) {
  const isCaregiver = props.transcript.role === "caregiver";
  return (
    <div className={`flex ${isCaregiver ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isCaregiver
            ? "border-sky-200 bg-sky-50 text-sky-950"
            : "border-emerald-200 bg-emerald-50 text-stone-950"
        } border-dashed opacity-75`}
      >
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <div className={`text-[10px] font-black ${isCaregiver ? "text-sky-700" : "text-emerald-700"}`}>
            {isCaregiver ? "介護者" : "本人"}
          </div>
          <div className="rounded-md bg-white/70 px-2 py-0.5 text-[10px] font-black">
            認識中
          </div>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {props.transcript.text}
        </p>
      </article>
    </div>
  );
}

function SpeechBubble(props: { utterance: PracticeUtterance }) {
  const isCaregiver = props.utterance.speaker === "caregiver";
  return (
    <div className={`flex ${isCaregiver ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isCaregiver
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-stone-200 bg-[#fffdf7] text-stone-950"
        }`}
      >
        <div className={`mb-0.5 text-[10px] font-black ${isCaregiver ? "text-sky-100" : "text-emerald-700"}`}>
          {isCaregiver ? "介護者" : "本人"}
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {props.utterance.text}
        </p>
        <time className={`mt-1 block text-[10px] font-bold ${isCaregiver ? "text-sky-100" : "text-stone-400"}`}>
          {formatDateTime(props.utterance.created_at)}
        </time>
      </article>
    </div>
  );
}

function ActionButton(props: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-[14px] font-black text-stone-800 shadow-sm active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400"
    >
      {props.busy ? "処理中" : props.label}
    </button>
  );
}

async function fetchFixedRemoteMicStatus(sessionId: string) {
  const response = await fetch(
    `/api/remote-mic/fixed/active?sessionId=${encodeURIComponent(sessionId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`remote mic status failed: ${response.status}`);

  const data = (await response.json()) as FixedRemoteMicActiveResponse;
  return data.active
    ? { roles: normalizeRemoteMicStatuses(data.active.roles), dialogueStartedAt: data.active.dialogueStartedAt }
    : { roles: emptyRemoteMicStatuses(), dialogueStartedAt: null };
}

async function updateAiSpeechState(input: {
  sessionId: string;
  playbackId: string;
  action: "start" | "end" | "cancel" | "log";
  contentType: "topic" | "question";
  playbackStatus?: PlaybackStatus;
  playbackErrorCode?: string | null;
}): Promise<AiSpeechStateResponse> {
  const response = await fetch("/api/ai/speech-state", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`speech-state failed: ${response.status}`);

  return response.json() as Promise<AiSpeechStateResponse>;
}

async function cleanupPracticeSession(sessionId: string) {
  await fetch(`/api/session/practice?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    keepalive: true,
  });
}

async function waitForRemoteMicCaptureState(input: {
  sessionId: string;
  captureState: "suppressed" | "listening";
  targetRoles: Speaker[];
}): Promise<{ ok: true } | { ok: false; roles: Speaker[]; reason: string }> {
  if (input.targetRoles.length === 0) return { ok: true };

  const deadline = Date.now() + REMOTE_MIC_CONTROL_STATE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await fetchFixedRemoteMicStatus(input.sessionId).catch(() => null);
    const roles = status?.roles ?? emptyRemoteMicStatuses();
    const notReady = input.targetRoles.filter((role) => {
      const roleStatus = roles[role];
      return !roleStatus.ready || roleStatus.captureState !== input.captureState;
    });
    if (notReady.length === 0) return { ok: true };

    await sleep(REMOTE_MIC_CONTROL_STATE_POLL_MS);
  }

  return { ok: false, roles: input.targetRoles, reason: "state_update_failed" };
}

function playBrowserSpeech(
  text: string,
  onStart: (startedAt: string) => void,
) {
  return new Promise<{
    startedAt: string | null;
    endedAt: string;
    status: Extract<PlaybackStatus, "completed" | "failed" | "cancelled">;
    errorCode: string | null;
  }>((resolve, reject) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      reject(new Error("browser_speech_unavailable"));
      return;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.resume();
    let settled = false;
    let startedAt: string | null = null;
    let timeoutId: number;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const japaneseVoice =
      voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ??
      voices.find((voice) => /japanese|japan/i.test(voice.name)) ??
      null;

    if (japaneseVoice) utterance.voice = japaneseVoice;
    utterance.lang = "ja-JP";
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.volume = 1;

    const finish = (result: {
      startedAt: string | null;
      endedAt: string;
      status: Extract<PlaybackStatus, "completed" | "failed" | "cancelled">;
      errorCode: string | null;
    }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };

    utterance.onstart = () => {
      startedAt = new Date().toISOString();
      onStart(startedAt);
    };
    utterance.onend = () => {
      finish({
        startedAt,
        endedAt: new Date().toISOString(),
        status: "completed",
        errorCode: null,
      });
    };
    utterance.onerror = (event) => {
      const errorCode = event.error || "browser_speech_error";
      finish({
        startedAt,
        endedAt: new Date().toISOString(),
        status: errorCode === "canceled" || errorCode === "interrupted" ? "cancelled" : "failed",
        errorCode,
      });
    };
    timeoutId = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      finish({
        startedAt,
        endedAt: new Date().toISOString(),
        status: "failed",
        errorCode: "speech_safety_timeout",
      });
    }, AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS);
    window.speechSynthesis.speak(utterance);
    window.setTimeout(() => window.speechSynthesis.resume(), 0);
  });
}

function cancelBrowserSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function getAiSpeechStateRevision(response: AiSpeechStateResponse | null) {
  const revision = response?.state?.revision;
  return typeof revision === "number" && Number.isFinite(revision) ? revision : null;
}

function createConversationEntries(
  utterances: PracticeUtterance[],
  liveTranscripts: LiveTranscript[],
) {
  const finalSourceGroupIds = new Set(
    utterances
      .map((utterance) => utterance.source_group_id?.trim())
      .filter((sourceGroupId): sourceGroupId is string => Boolean(sourceGroupId)),
  );
  return [
    ...utterances.map((utterance) => ({
      kind: "final" as const,
      key: utterance.source_group_id || utterance.id,
      createdAt: utterance.created_at,
      utterance,
    })),
    ...liveTranscripts
      .filter((transcript) => !finalSourceGroupIds.has(transcript.transcriptId))
      .map((transcript) => ({
        kind: "live" as const,
        key: transcript.key,
        createdAt:
          transcript.startedAt ??
          transcript.firstPartialAt ??
          transcript.finalizedAt ??
          new Date().toISOString(),
        transcript,
      })),
  ].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

function normalizeRemoteMicStatuses(
  roles: Record<Speaker, RemoteMicRoleStatus>,
): Record<Speaker, RemoteMicRoleStatus> {
  const now = Date.now();
  return {
    elder: normalizeRoleStatus(roles.elder, now),
    caregiver: normalizeRoleStatus(roles.caregiver, now),
  };
}

function normalizeRoleStatus(
  status: RemoteMicRoleStatus | undefined,
  now: number,
): RemoteMicRoleStatus {
  const lastSeenMs = status?.lastSeenAt ? new Date(status.lastSeenAt).getTime() : 0;
  const heartbeatFresh = lastSeenMs > 0 && now - lastSeenMs <= 30000;
  const ready = Boolean(
    heartbeatFresh &&
    status?.realtimeConnected &&
    (status.captureState === "listening" || status.captureState === "suppressed"),
  );

  return {
    status: heartbeatFresh ? "connected" : "disconnected",
    ready,
    readyReason: ready ? null : heartbeatFresh ? "realtime_disconnected" : "heartbeat_stale",
    lastHeartbeatAt: status?.lastSeenAt ?? null,
    muted: status?.muted ?? true,
    realtimeConnected: status?.realtimeConnected ?? false,
    captureState: status?.captureState ?? "idle",
  };
}

function emptyRemoteMicStatuses(): Record<Speaker, RemoteMicRoleStatus> {
  return {
    elder: { status: "disconnected", ready: false, readyReason: "heartbeat_stale" },
    caregiver: { status: "disconnected", ready: false, readyReason: "heartbeat_stale" },
  };
}

function getConnectedRoles(statuses: Record<Speaker, RemoteMicRoleStatus>) {
  return (["elder", "caregiver"] as Speaker[]).filter((role) => statuses[role].ready);
}

function getMissingRoles(statuses: Record<Speaker, RemoteMicRoleStatus>) {
  return (["elder", "caregiver"] as Speaker[]).filter((role) => !statuses[role].ready);
}

function getMissingMicMessage(missingRoles: Speaker[]) {
  if (missingRoles.length === 0) return "";
  if (missingRoles.length === 2) {
    return "本人用マイクと介護者用マイクの接続が必要です。";
  }
  return `${missingRoles[0] === "elder" ? "本人用" : "介護者用"}マイクが未接続です。`;
}

function getMicControlError(prefix: string, roles: Speaker[]) {
  const roleText = roles
    .map((role) => (role === "elder" ? "本人用" : "介護者用"))
    .join("、");
  return `${prefix}。${roleText || "スマートフォン"}マイクの画面を確認してください。`;
}

function getCurrentInstruction(input: {
  step: PracticeStep;
  bothMicsReady: boolean;
  questionLoading: boolean;
  speechPhase: SpeechPhase;
}) {
  if (!input.bothMicsReady) {
    return "スマートフォンマイクを2台とも接続してください。接続後、最初の話題を読み上げます。";
  }
  if (input.speechPhase !== "idle") {
    return "AI音声の読み上げ中です。マイクが一時的にミュートされ、読み上げ後に自動復帰します。";
  }
  if (input.questionLoading) return "AIの質問を生成しています。少しお待ちください。";
  if (input.step === "question") {
    return "AIの質問表示と読み上げを確認したら、「次の話題へ」を押してください。";
  }
  if (input.step === "second-topic") {
    return "2つ目の話題について少し話したら、「練習を終了する」を押してください。";
  }
  return "表示された話題について話し、「AIに質問してもらう」を押してください。";
}

function formatDateTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

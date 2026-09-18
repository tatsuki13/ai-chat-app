"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createLiveTranscriptKey,
  type LiveTranscriptEvent,
  type RemoteMicRealtimeEvent,
  type RemoteMicRole,
} from "../../../lib/remote-mic/control-events";
import {
  ActionButton,
  ConversationLog,
  PromptPanel,
  RemoteMicStatus,
  SessionShell,
  createConversationEntries,
  type LiveTranscriptLike,
  type PromptPanelState,
  type RemoteMicRoleStatusLike,
  type UtteranceLike,
} from "../session-ui";

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
type PracticeStep = "setup" | "talk" | "question" | "completed";
type PracticeSession = {
  id: string;
  condition: string | null;
};
type PracticeTopic = {
  id: string;
  title: string;
  openingPrompt: string;
  fixedQuestion: string;
};
type PracticeUtterance = UtteranceLike & {
  speaker: Speaker;
};
type LiveTranscript = LiveTranscriptLike & {
  role: Speaker;
};
type RemoteMicRoleStatus = RemoteMicRoleStatusLike & {
  lastSeenAt?: string | null;
};
type FixedRemoteMicActiveState = {
  sessionId: string;
  participantCode: string | null;
  mode?: "practice" | "experiment";
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

const PRACTICE_TOPICS: PracticeTopic[] = [
  {
    id: "practice-animals-1",
    title: "操作練習の話題 1",
    openingPrompt:
      "好きな動物や、これまでに飼ったことのある動物について、お二人で自由にお話しください。",
    fixedQuestion: "その動物のどんなところが好きですか？",
  },
  {
    id: "practice-food-2",
    title: "操作練習の話題 2",
    openingPrompt:
      "次の練習に進みます。好きな食べ物や、よく食べる料理について、お二人でお話しください。",
    fixedQuestion: "その食べ物にまつわる思い出はありますか？",
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
  const [statusText, setStatusText] = useState("練習ページを準備しています");
  const [questionLoading, setQuestionLoading] = useState(false);
  const [questionError, setQuestionError] = useState("");
  const [speechPhase, setSpeechPhase] = useState<SpeechPhase>("idle");
  const [spokenTopicIds, setSpokenTopicIds] = useState<Record<string, boolean>>({});
  const [questionShownTopicIds, setQuestionShownTopicIds] = useState<Record<string, boolean>>({});
  const [topicStartUtteranceCounts, setTopicStartUtteranceCounts] = useState<Record<string, number>>({});
  const [cleanupError, setCleanupError] = useState("");

  const sessionRef = useRef<PracticeSession | null>(null);
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
  const bothMicsReady = getMissingRoles(remoteMicStatuses).length === 0;
  const missingRoles = getMissingRoles(remoteMicStatuses);
  const questionShown = Boolean(questionShownTopicIds[currentTopic.id]);
  const topicStarted = Boolean(spokenTopicIds[currentTopic.id]);
  const topicStartUtteranceCount = topicStartUtteranceCounts[currentTopic.id] ?? utterances.length;
  const hasSpokenAfterTopicStart = utterances.length > topicStartUtteranceCount;
  const aiSpeechActive = speechPhase !== "idle";
  const conversationEntries = createConversationEntries(
    utterances,
    Object.values(liveTranscripts),
  );
  const promptPanel = getPracticePromptPanel({
    topic: currentTopic,
    topicStarted,
    questionShown,
    questionLoading,
    questionError,
  });
  const currentInstruction = getCurrentInstruction({
    step,
    bothMicsReady,
    questionLoading,
    speechPhase,
    questionShown,
    topicStarted,
    hasSpokenAfterTopicStart,
    isSecondTopic: topicIndex > 0,
  });
  const micIssue = useMemo(() => getMissingMicMessage(missingRoles), [missingRoles]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    remoteMicStatusesRef.current = remoteMicStatuses;
  }, [remoteMicStatuses]);

  useEffect(() => {
    let cancelled = false;

    async function createPracticeSession() {
      setSetupError("");
      setCleanupError("");
      try {
        const response = await fetch("/api/session/practice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "practice" }),
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
        void cleanupPracticeSession(practiceSession.id).catch((error) => {
          console.warn("[practice cleanup on leave failed]", error);
        });
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

  function handleStartPracticeTopic() {
    const currentSession = sessionRef.current;
    if (!currentSession || !bothMicsReady || speechPhase !== "idle") return;
    if (spokenTopicIds[currentTopic.id]) return;

    setSetupError("");
    setQuestionError("");
    setTopicStartUtteranceCounts((current) => ({
      ...current,
      [currentTopic.id]: utterances.length,
    }));
    setSpokenTopicIds((current) => ({ ...current, [currentTopic.id]: true }));
    setStep("talk");
    setStatusText("話題を読み上げています");
    void playSpokenContent({
      contentType: "topic",
      text: currentTopic.openingPrompt,
      topicId: currentTopic.id,
    }).finally(() => {
      if (sessionRef.current?.id === currentSession.id) {
        setStatusText("表示された話題についてお話しください");
      }
    });
  }

  async function handleGeneratePracticeQuestion() {
    if (questionInFlightRef.current) {
      await questionInFlightRef.current;
      return;
    }

    const run = runFixedPracticeQuestion();
    questionInFlightRef.current = run.finally(() => {
      questionInFlightRef.current = null;
    });
    await questionInFlightRef.current;
  }

  async function runFixedPracticeQuestion() {
    if (
      !sessionRef.current ||
      questionLoading ||
      questionShown ||
      !topicStarted ||
      !hasSpokenAfterTopicStart
    ) {
      return;
    }
    if (!bothMicsReady) {
      setQuestionError(getMissingMicMessage(missingRoles));
      return;
    }

    setQuestionLoading(true);
    setQuestionError("");
    setQuestionShownTopicIds((current) => ({ ...current, [currentTopic.id]: true }));
    setStep("question");
    setStatusText("AIの質問を読み上げています");

    try {
      await playSpokenContent({
        contentType: "question",
        text: currentTopic.fixedQuestion,
        topicId: currentTopic.id,
      });
      setStatusText("AIの質問表示と読み上げを確認してください");
    } catch (error) {
      console.warn("[practice fixed question playback failed]", error);
      setQuestionError("読み上げに失敗しました。質問文は画面で確認できます。");
      setStatusText("練習は続けられます");
    } finally {
      setQuestionLoading(false);
    }
  }

  function handleNextOrFinish() {
    if (topicIndex < PRACTICE_TOPICS.length - 1) {
      const nextIndex = topicIndex + 1;
      const nextTopic = PRACTICE_TOPICS[nextIndex];
      if (!nextTopic || speechPhase !== "idle" || !questionShown) return;

      setTopicIndex(nextIndex);
      setQuestionError("");
      setStep("talk");
      setTopicStartUtteranceCounts((current) => ({
        ...current,
        [nextTopic.id]: utterances.length,
      }));
      setSpokenTopicIds((current) => ({ ...current, [nextTopic.id]: true }));
      setStatusText("次の練習話題を読み上げています");
      void playSpokenContent({
        contentType: "topic",
        text: nextTopic.openingPrompt,
        topicId: nextTopic.id,
      }).finally(() => {
        if (sessionRef.current) {
          setStatusText("新しい話題についてお話しください");
        }
      });
      return;
    }

    if (!questionShown || speechPhase !== "idle") return;
    void handleFinishPractice();
  }

  async function handleFinishPractice() {
    const practiceSession = sessionRef.current;
    setCleanupError("");
    cancelBrowserSpeech();

    if (!practiceSession) {
      clearPracticeState();
      setStep("completed");
      return;
    }

    setStatusText("練習データを片付けています");
    try {
      await cleanupPracticeSession(practiceSession.id);
      clearPracticeState();
      setStep("completed");
      setStatusText("練習は完了です");
    } catch (error) {
      console.warn("[practice cleanup after finish failed]", error);
      setCleanupError("練習の一時データを削除できませんでした。もう一度終了を押してください。");
      setStatusText("片付けエラー");
    }
  }

  function clearPracticeState() {
    setSession(null);
    sessionRef.current = null;
    setUtterances([]);
    setLiveTranscripts({});
    setRemoteMicStatuses(emptyRemoteMicStatuses());
    setSpokenTopicIds({});
    setQuestionShownTopicIds({});
    setTopicStartUtteranceCounts({});
    setSpeechPhase("idle");
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
        setRemoteMicStatuses(
          normalizeRemoteMicStatuses(event.roles as Record<Speaker, RemoteMicRoleStatus>),
        );
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

  if (step === "completed") {
    return (
      <main className="min-h-dvh bg-[#f7f8f4] px-4 py-5 text-stone-950">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col justify-center">
          <div className="rounded-md border border-stone-200 bg-white p-6 shadow-sm">
            <div className="text-[12px] font-black text-emerald-700">操作練習</div>
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
    <SessionShell
      topDetails={
        <details className="group rounded-md border border-stone-200 bg-white shadow-sm" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <div className="text-[11px] font-black text-stone-500">操作練習</div>
              <div className="mt-1 truncate text-[15px] font-black leading-tight text-stone-950">
                本番前の操作確認
              </div>
            </div>
            <span className="grid h-8 w-8 shrink-0 place-items-center text-[16px] font-black leading-none text-stone-800 transition group-open:rotate-180">
              ▼
            </span>
          </summary>
          <div className="whitespace-pre-line border-t border-stone-100 px-4 pb-3 pt-2 text-[13px] font-semibold leading-relaxed text-stone-600">
            {"これから操作の練習を行います。\n画面に表示された話題について、普段どおりお話しください。\n途中で「AIに質問してもらう」と「次の話題へ」を一度ずつ試します。\nこの練習内容は、本番の記録には含まれません。"}
          </div>
        </details>
      }
      header={
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-bold text-stone-500">ACP対話支援</p>
            <h1 className="truncate text-[22px] font-black leading-tight">
              操作練習
            </h1>
            <p className="mt-1 text-[12px] font-bold text-stone-500">
              本番と同じスマートフォンマイクで練習します
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-bold text-emerald-800">
            {statusText}
          </span>
        </header>
      }
      sidePanel={
        <section className="mx-auto flex h-[296px] w-[296px] shrink-0 flex-col rounded-md border border-stone-200 bg-white p-5 shadow-md lg:mx-0 lg:h-[316px] lg:w-[316px]">
          <div className="text-center text-[14px] font-black text-emerald-700">
            現在行う操作
          </div>
          <div className="mt-4 min-h-0 flex-1 rounded-md bg-stone-50 px-3 py-3 text-[14px] font-bold leading-relaxed text-stone-700">
            {currentInstruction}
          </div>
          {micIssue ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-center text-[11px] font-black text-amber-900">
              {micIssue}
            </div>
          ) : null}
        </section>
      }
      promptPanel={
        <PromptPanel
          prompt={promptPanel}
          topicTitle={currentTopic.title}
          topicIndex={topicIndex + 1}
          topicCount={PRACTICE_TOPICS.length}
          aiSpeechActive={aiSpeechActive}
        />
      }
      actionPanel={
        <div className="grid grid-cols-1 gap-2">
          <ActionButton
            label={topicStarted ? "AIに質問してもらう" : "練習を開始する"}
            tone={topicStarted ? "blue" : "emerald"}
            busy={questionLoading}
            disabled={
              !session ||
              !bothMicsReady ||
              questionLoading ||
              (topicStarted && questionShown) ||
              (topicStarted && !hasSpokenAfterTopicStart) ||
              speechPhase !== "idle"
            }
            onClick={() => {
              if (topicStarted) {
                void handleGeneratePracticeQuestion();
                return;
              }
              handleStartPracticeTopic();
            }}
          />
          <ActionButton
            label={topicIndex < PRACTICE_TOPICS.length - 1 ? "次の話題へ" : "練習を終了する"}
            tone={topicIndex < PRACTICE_TOPICS.length - 1 ? "emerald" : "amber"}
            busy={false}
            disabled={!session || !questionShown || speechPhase !== "idle"}
            onClick={handleNextOrFinish}
          />
          <ActionButton
            label="練習を中止する"
            tone="stone"
            busy={false}
            disabled={!session || (speechPhase !== "idle" && speechPhase !== "error")}
            onClick={() => void handleFinishPractice()}
          />
        </div>
      }
      conversationPanel={
        <ConversationLog
          entries={conversationEntries}
          totalCount={utterances.length}
          emptyText="スマートフォンマイクで話すと、ここに発話が表示されます"
          editable={false}
        />
      }
      rightPanel={
        <>
          <RemoteMicStatus statuses={remoteMicStatuses} />
          {(setupError || questionError || cleanupError) ? (
            <section className="rounded-md border border-red-200 bg-red-50 p-3 text-[12px] font-bold leading-relaxed text-red-800">
              {setupError ? <p>{setupError}</p> : null}
              {questionError ? <p>{questionError}</p> : null}
              {cleanupError ? <p>{cleanupError}</p> : null}
            </section>
          ) : null}
        </>
      }
    />
  );
}

function PracticeLoading() {
  return (
    <main className="min-h-dvh bg-[#f7f8f4] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-6xl rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[13px] font-black text-stone-600">
          練習ページを準備しています
        </div>
      </section>
    </main>
  );
}

function getPracticePromptPanel(input: {
  topic: PracticeTopic;
  topicStarted: boolean;
  questionShown: boolean;
  questionLoading: boolean;
  questionError: string;
}): PromptPanelState {
  if (!input.topicStarted) {
    return {
      title: "練習を開始します",
      body: "本人用と介護者用のスマートフォンマイクを接続したら、「練習を開始する」を押してください。話題が表示され、音声で読み上げられます。",
      tone: "status",
    };
  }

  if (input.questionLoading) {
    return {
      title: "AIの質問を準備しています",
      body: "少しお待ちください。",
      tone: "status",
    };
  }

  if (input.questionShown) {
    return {
      title: "AIの質問",
      body: input.topic.fixedQuestion,
      tone: input.questionError ? "error" : "question",
    };
  }

  return {
    title: input.topic.title,
    body: input.topic.openingPrompt,
    tone: "switch",
  };
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
  const response = await fetch(`/api/session/practice?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    keepalive: true,
  });
  if (!response.ok) throw new Error(`practice cleanup failed: ${response.status}`);
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
    lastSeenAt: status?.lastSeenAt ?? null,
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
  questionShown: boolean;
  topicStarted: boolean;
  hasSpokenAfterTopicStart: boolean;
  isSecondTopic: boolean;
}) {
  if (!input.bothMicsReady) {
    return "本人用と介護者用のスマートフォンマイクを接続してください。接続後、最初の話題を読み上げます。";
  }
  if (input.speechPhase !== "idle") {
    return "AI音声の読み上げ中です。マイクは一時的にミュートされ、読み上げ後に自動復帰します。";
  }
  if (!input.topicStarted) {
    return "両方のマイクが接続されました。「練習を開始する」を押して、話題の表示と読み上げを確認してください。";
  }
  if (input.questionLoading) return "AIの質問を表示して読み上げます。少しお待ちください。";
  if (input.questionShown && input.isSecondTopic) {
    return "質問の表示と読み上げを確認したら、「練習を終了する」を押してください。";
  }
  if (input.questionShown) {
    return "質問の表示と読み上げを確認したら、「次の話題へ」を押してください。";
  }
  if (!input.hasSpokenAfterTopicStart) {
    return "話題について短くお話しください。発話が会話ログに表示されたら、AI質問のボタンを押せます。";
  }
  if (input.step === "setup") {
    return "マイク接続が完了したら、表示された話題について普段どおり話してください。";
  }
  return "少し話したら「AIに質問してもらう」を押してください。";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

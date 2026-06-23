"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { DISCUSSION_TOPIC, DISCUSSION_TOPICS } from "../../lib/acp-mvp";

type Speaker = "caregiver" | "elder";
type ButtonType = "next_question" | "switch_topic" | "check_end" | "update_slots";
type PromptTone = "question" | "switch" | "end" | "status" | "error";
type AudioCaptureState = "idle" | "starting" | "recording" | "error";
type AudioLevelMap = Record<Speaker, number>;

type SessionInfo = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  ended_at: string | null;
};

type Utterance = {
  id: string;
  speaker: Speaker | string;
  text: string;
  created_at: string;
};

type PromptPanelState = {
  title: string;
  body: string;
  suggestionId?: string;
  tone: PromptTone;
};

type TranscribeUtteranceResponse = {
  utterance?: Utterance | null;
  transcript?: string;
  skipped?: boolean;
  speaker?: Speaker;
};

type AudioCaptureHandle = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  splitter: ChannelSplitterNode;
  leftDestination: MediaStreamAudioDestinationNode;
  rightDestination: MediaStreamAudioDestinationNode;
  leftAnalyser: AnalyserNode;
  rightAnalyser: AnalyserNode;
  recorders: MediaRecorder[];
  levelFrameId: number | null;
};

const STORAGE_KEY = "acp-hitl-current-session-id";
const MAX_RENDERED_UTTERANCES = 30;
const TOPIC_BASE_SECONDS = 5 * 60;
const TIMER_TICK_MS = 1000;

function createOpeningPrompt(topic = DISCUSSION_TOPICS[0]): PromptPanelState {
  return {
    title: "最初の話題提供",
    body: topic.opening_prompt,
    tone: "question",
  };
}

export default function SessionPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [utteranceTotal, setUtteranceTotal] = useState(0);
  const [speaker, setSpeaker] = useState<Speaker>("elder");
  const [draft, setDraft] = useState("");
  const [busyAction, setBusyAction] = useState<ButtonType | "start" | "id" | null>("start");
  const [promptPanel, setPromptPanel] = useState<PromptPanelState | null>(
    createOpeningPrompt(),
  );
  const [currentTopicIndex, setCurrentTopicIndex] = useState(0);
  const [statusText, setStatusText] = useState("準備中");
  const [isEditingId, setIsEditingId] = useState(false);
  const [idDraft, setIdDraft] = useState("");
  const [idError, setIdError] = useState("");
  const [topicBudgets, setTopicBudgets] = useState(createInitialTopicBudgets);
  const [topicStartedAt, setTopicStartedAt] = useState<number | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [audioCaptureState, setAudioCaptureState] =
    useState<AudioCaptureState>("idle");
  const [audioCaptureError, setAudioCaptureError] = useState("");
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [audioLevels, setAudioLevels] = useState<AudioLevelMap>({
    elder: 0,
    caregiver: 0,
  });
  const [sttEnabled, setSttEnabled] = useState(false);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const topicStartedAtRef = useRef<number | null>(null);
  const sttEnabledRef = useRef(false);
  const audioCaptureRef = useRef<AudioCaptureHandle | null>(null);
  const audioChunkCounterRef = useRef(0);

  const participantCode = session?.participant_code || "未設定";
  const currentTopic = DISCUSSION_TOPICS[currentTopicIndex] ?? DISCUSSION_TOPICS[0];
  const nextTopic = DISCUSSION_TOPICS[currentTopicIndex + 1] ?? null;
  const visibleUtterances = utterances.slice(-MAX_RENDERED_UTTERANCES);
  const hiddenUtteranceCount = Math.max(
    0,
    utteranceTotal - visibleUtterances.length,
  );
  const topicBudgetSeconds =
    topicBudgets[currentTopicIndex] ?? TOPIC_BASE_SECONDS;
  const topicElapsedSeconds =
    topicStartedAt === null ? 0 : getElapsedSeconds(topicStartedAt, timerNow);
  const topicRemainingSeconds = topicBudgetSeconds - topicElapsedSeconds;
  const topicProgress =
    topicBudgetSeconds > 0
      ? Math.min(1, topicElapsedSeconds / topicBudgetSeconds)
      : 1;
  const audioCaptureActive = audioCaptureState === "recording";

  useEffect(() => {
    let ignore = false;

    async function boot() {
      try {
        const savedId = window.localStorage.getItem(STORAGE_KEY);

        if (savedId) {
          try {
            const restored = await fetchSessionDetail(savedId);

            if (!ignore) {
              setSession(restored.session);
              setUtterances(restored.utterances);
              setUtteranceTotal(restored.utterance_count);
              resetTopicTiming();
              setStatusText("保存済み");
              setBusyAction(null);
            }

            return;
          } catch {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }

        const created = await startSession();

        if (!ignore) {
          window.localStorage.setItem(STORAGE_KEY, created.id);
          setSession(created);
          setUtteranceTotal(0);
          resetTopicTiming();
          setStatusText("保存済み");
          setBusyAction(null);
        }
      } catch {
        if (!ignore) {
          setBusyAction(null);
          setStatusText("接続エラー");
          setPromptPanel({
            title: "セッションを開始できません",
            body: "データベース接続または開発サーバーの状態を確認してください。",
            tone: "error",
          });
        }
      }
    }

    boot();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    topicStartedAtRef.current = topicStartedAt;
  }, [topicStartedAt]);

  useEffect(() => {
    sttEnabledRef.current = sttEnabled;

    if (audioCaptureRef.current) {
      setStatusText(sttEnabled ? "音声入力中" : "L/R確認中");
    }
  }, [sttEnabled]);

  useEffect(() => {
    void refreshAudioInputDevices();

    if (!navigator.mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      stopAudioCapture(audioCaptureRef.current);
      audioCaptureRef.current = null;
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = logScrollRef.current;

      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      }

      logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [utteranceTotal]);

  useEffect(() => {
    if (!session || topicStartedAt === null) return;

    const timerId = window.setInterval(() => {
      setTimerNow(Date.now());
    }, TIMER_TICK_MS);

    return () => window.clearInterval(timerId);
  }, [session?.id, topicStartedAt]);

  useEffect(() => {
    if (isEditingId) {
      window.setTimeout(() => {
        idInputRef.current?.focus();
        idInputRef.current?.select();
      }, 0);
    }
  }, [isEditingId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !draft.trim()) return;

    const text = draft.trim();
    startTopicTimerIfNeeded();
    setDraft("");
    setStatusText("保存中");

    try {
      const utterance = await addUtterance(session.id, speaker, text);
      setUtterances((current) =>
        [...current, utterance].slice(-MAX_RENDERED_UTTERANCES),
      );
      setUtteranceTotal((current) => current + 1);
      setStatusText("保存済み");
    } catch {
      setDraft(text);
      setStatusText("保存エラー");
      setPromptPanel({
        title: "発話を保存できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    }
  }

  async function refreshAudioInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");

      setAudioInputDevices(audioInputs);
      setSelectedAudioDeviceId((currentDeviceId) =>
        currentDeviceId &&
        !audioInputs.some((device) => device.deviceId === currentDeviceId)
          ? ""
          : currentDeviceId,
      );
    } catch {
      setAudioInputDevices([]);
    }
  }

  async function handleToggleStereoCapture() {
    if (audioCaptureRef.current) {
      stopStereoCapture();
      return;
    }

    await startStereoCapture();
  }

  async function startStereoCapture() {
    if (!session || audioCaptureState === "starting") return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAudioCaptureState("error");
      setAudioCaptureError("このブラウザはステレオ音声入力に対応していません。");
      setStatusText("音声入力エラー");
      return;
    }

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      setAudioCaptureState("error");
      setAudioCaptureError("このブラウザはWeb Audio APIに対応していません。");
      setStatusText("音声入力エラー");
      return;
    }

    setAudioCaptureState("starting");
    setAudioCaptureError("");
    setStatusText("音声入力準備中");

    let captureHandle: AudioCaptureHandle | null = null;

    try {
      const audioConstraints: MediaTrackConstraints = {
        channelCount: { ideal: 2 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      if (selectedAudioDeviceId) {
        audioConstraints.deviceId = { exact: selectedAudioDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const splitter = context.createChannelSplitter(2);
      const leftDestination = context.createMediaStreamDestination();
      const rightDestination = context.createMediaStreamDestination();
      const leftAnalyser = context.createAnalyser();
      const rightAnalyser = context.createAnalyser();
      const mimeType = getSupportedAudioMimeType();

      leftAnalyser.fftSize = 256;
      rightAnalyser.fftSize = 256;
      source.connect(splitter);
      splitter.connect(leftDestination, 0);
      splitter.connect(rightDestination, 1);
      splitter.connect(leftAnalyser, 0);
      splitter.connect(rightAnalyser, 1);

      const recorders = [
        createChannelRecorder(leftDestination.stream, "elder", mimeType),
        createChannelRecorder(rightDestination.stream, "caregiver", mimeType),
      ];

      captureHandle = {
        stream,
        context,
        source,
        splitter,
        leftDestination,
        rightDestination,
        leftAnalyser,
        rightAnalyser,
        recorders,
        levelFrameId: null,
      };
      audioCaptureRef.current = captureHandle;

      if (context.state === "suspended") {
        await context.resume();
      }

      recorders.forEach((recorder) => recorder.start(4000));
      startAudioLevelMeters(captureHandle);
      void refreshAudioInputDevices();
      setAudioCaptureState("recording");
      setStatusText(sttEnabledRef.current ? "音声入力中" : "L/R確認中");
    } catch (error) {
      stopAudioCapture(captureHandle ?? audioCaptureRef.current);
      audioCaptureRef.current = null;
      setAudioCaptureState("error");
      setAudioCaptureError(getAudioCaptureError(error));
      setStatusText("音声入力エラー");
    }
  }

  function stopStereoCapture() {
    stopAudioCapture(audioCaptureRef.current);
    audioCaptureRef.current = null;
    setAudioCaptureState("idle");
    setAudioCaptureError("");
    setAudioLevels({ elder: 0, caregiver: 0 });
    setStatusText(sessionRef.current ? "保存済み" : "準備中");
  }

  function getAudioAwareSavedStatus() {
    if (!audioCaptureRef.current) return "保存済み";
    return sttEnabledRef.current ? "音声入力中" : "L/R確認中";
  }

  function createChannelRecorder(
    stream: MediaStream,
    channelSpeaker: Speaker,
    mimeType: string,
  ) {
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;

      void handleAudioChunk(event.data, channelSpeaker, mimeType);
    };
    recorder.onerror = () => {
      setAudioCaptureState("error");
      setAudioCaptureError("音声チャンクの生成に失敗しました。");
      setStatusText("音声入力エラー");
    };

    return recorder;
  }

  function startAudioLevelMeters(handle: AudioCaptureHandle) {
    const leftData = new Uint8Array(handle.leftAnalyser.fftSize);
    const rightData = new Uint8Array(handle.rightAnalyser.fftSize);

    const updateLevels = () => {
      handle.leftAnalyser.getByteTimeDomainData(leftData);
      handle.rightAnalyser.getByteTimeDomainData(rightData);
      setAudioLevels({
        elder: readAudioLevel(leftData),
        caregiver: readAudioLevel(rightData),
      });
      handle.levelFrameId = window.requestAnimationFrame(updateLevels);
    };

    updateLevels();
  }

  async function handleAudioChunk(
    blob: Blob,
    chunkSpeaker: Speaker,
    mimeType: string,
  ) {
    const currentSession = sessionRef.current;
    if (!currentSession || blob.size < 512 || !sttEnabledRef.current) return;

    const chunkNumber = audioChunkCounterRef.current + 1;
    audioChunkCounterRef.current = chunkNumber;

    try {
      const data = await sendAudioChunkToStt(
        currentSession.id,
        chunkSpeaker,
        blob,
        mimeType,
        chunkNumber,
      );

      if (!data.utterance) return;

      startTopicTimerIfNeeded();
      setUtterances((current) =>
        [...current, data.utterance as Utterance].slice(
          -MAX_RENDERED_UTTERANCES,
        ),
      );
      setUtteranceTotal((current) => current + 1);
      setStatusText(
        audioCaptureRef.current
          ? sttEnabledRef.current
            ? "音声入力中"
            : "L/R確認中"
          : "保存済み",
      );
    } catch (error) {
      setAudioCaptureState("error");
      setAudioCaptureError(getAudioCaptureError(error));
      setStatusText("音声入力エラー");
    }
  }

  async function handleUpdateUtterance(
    utteranceId: string,
    nextSpeaker: Speaker,
    nextText: string,
  ) {
    const text = nextText.trim();
    if (!text) throw new Error("本文を入力してください。");

    setStatusText("保存中");

    try {
      const updated = await updateUtterance(utteranceId, nextSpeaker, text);
      setUtterances((current) =>
        current.map((utterance) =>
          utterance.id === utteranceId ? updated : utterance,
        ),
      );
      setStatusText(getAudioAwareSavedStatus());
    } catch (error) {
      setStatusText("保存エラー");
      throw error;
    }
  }

  async function handleDeleteUtterance(utteranceId: string) {
    const confirmed = window.confirm("この発話を削除しますか？");
    if (!confirmed) return;

    setStatusText("保存中");

    try {
      await deleteUtterance(utteranceId);
      setUtterances((current) =>
        current.filter((utterance) => utterance.id !== utteranceId),
      );
      setUtteranceTotal((current) => Math.max(0, current - 1));
      setStatusText(getAudioAwareSavedStatus());
    } catch (error) {
      setStatusText("保存エラー");
      throw error;
    }
  }

  async function handleAction(buttonType: ButtonType) {
    if (!session || busyAction) return;

    setBusyAction(buttonType);
    setStatusText("保存中");
    setPromptPanel(getPendingPrompt(buttonType));

    try {
      const triggerEventId = await saveButtonEvent(session.id, buttonType);

      if (buttonType === "next_question") {
        const data = await postJson<NextQuestionResponse>("/api/ai/next-question", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });
        const body = joinPrompt(
          data.suggestion.transition_phrase,
          data.suggestion.question,
        );

        setPromptPanel({
          title: "AIからの質問",
          body,
          suggestionId: data.suggestion.id,
          tone: "question",
        });
      }

      if (buttonType === "switch_topic") {
        const data = await postJson<TopicSwitchResponse>("/api/ai/switch-topic", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
          next_topic: nextTopic?.slot_name,
          next_topic_title: nextTopic?.title,
        });
        if (data.suggestion.should_switch && nextTopic) {
          advanceTopic();
        }

        setPromptPanel({
          title: data.suggestion.should_switch
            ? "次の話題へ"
            : "今の話題でもう少し確認",
          body: data.suggestion.message,
          suggestionId: data.suggestion.id,
          tone: data.suggestion.should_switch ? "switch" : "question",
        });
      }

      if (buttonType === "check_end") {
        const data = await postJson<EndCheckResponse>("/api/ai/check-end", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });

        setPromptPanel({
          title: data.suggestion.can_end ? "全体終了確認" : "全体としてもう少し確認",
          body: data.suggestion.message,
          suggestionId: data.suggestion.id,
          tone: "end",
        });
      }

      if (buttonType === "update_slots") {
        await postJson("/api/ai/update-slots", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });

        setPromptPanel({
          title: "議事録更新",
          body: "議事録を更新しました。",
          tone: "status",
        });
      }

      setStatusText("保存済み");
    } catch {
      setStatusText("保存エラー");
      setPromptPanel({
        title: "AI支援を実行できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleNewSession() {
    if (busyAction) return;

    const confirmed = window.confirm("新しいセッションを開始しますか？");
    if (!confirmed) return;

    stopStereoCapture();
    setBusyAction("start");
    setPromptPanel(createOpeningPrompt());
    setIsEditingId(false);
    setIdError("");
    resetTopicTiming();

    try {
      const created = await startSession();
      window.localStorage.setItem(STORAGE_KEY, created.id);
      setSession(created);
      setUtterances([]);
      setUtteranceTotal(0);
      setDraft("");
      resetTopicTiming();
      setStatusText("保存済み");
    } catch {
      setStatusText("接続エラー");
      setPromptPanel({
        title: "セッションを開始できません",
        body: "DATABASE_URL とデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function startEditingId() {
    if (!session || busyAction) return;

    setIdDraft(session.participant_code || "");
    setIdError("");
    setIsEditingId(true);
  }

  async function saveDisplayId() {
    if (!session || !isEditingId) return;

    const nextId = idDraft.trim();

    if (!nextId) {
      setIdError("参加者IDを入力してください");
      return;
    }

    if (nextId === session.participant_code) {
      setIsEditingId(false);
      return;
    }

    setBusyAction("id");
    setStatusText("保存中");
    setIdError("");

    try {
      const updated = await updateSessionDisplayId(session.id, nextId);
      setSession(updated);
      setIsEditingId(false);
      setStatusText("保存済み");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "通信状態またはデータベース接続を確認してください。";
      setIdError(message);
      setStatusText("保存エラー");
      setPromptPanel({
        title: "参加者IDを保存できません",
        body: message,
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function cancelEditingId() {
    setIsEditingId(false);
    setIdDraft("");
    setIdError("");
  }

  function handleIdKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveDisplayId();
    }

    if (event.key === "Escape") {
      cancelEditingId();
    }
  }

  function resetTopicTiming() {
    const now = Date.now();

    setCurrentTopicIndex(0);
    setTopicBudgets(createInitialTopicBudgets());
    topicStartedAtRef.current = null;
    setTopicStartedAt(null);
    setTimerNow(now);
  }

  function startTopicTimerIfNeeded() {
    if (!sessionRef.current || topicStartedAtRef.current !== null) return;

    const now = Date.now();
    topicStartedAtRef.current = now;
    setTopicStartedAt(now);
    setTimerNow(now);
  }

  function advanceTopic() {
    if (!nextTopic) return;

    const elapsedSeconds =
      topicStartedAt === null ? 0 : getElapsedSeconds(topicStartedAt);
    const now = Date.now();

    setTopicBudgets((current) =>
      distributeRemainingTopicTime(current, currentTopicIndex, elapsedSeconds),
    );
    setCurrentTopicIndex((current) =>
      Math.min(current + 1, DISCUSSION_TOPICS.length - 1),
    );
    topicStartedAtRef.current = null;
    setTopicStartedAt(null);
    setTimerNow(now);
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] text-stone-950">
      <section className="mx-auto w-full max-w-[1120px] px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,860px)_240px]">
          <div className="min-w-0 space-y-3">
            <details className="group rounded-md border border-stone-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0">
                  <div className="text-[11px] font-black text-stone-500">
                    今日の機会
                  </div>
                  <div className="mt-1 truncate text-[15px] font-black leading-tight text-stone-950">
                    {DISCUSSION_TOPIC.title}
                  </div>
                </div>
                <span className="grid h-8 w-8 shrink-0 place-items-center text-[16px] font-black leading-none text-stone-800 transition group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="border-t border-stone-100 px-4 pb-3 pt-2 text-[13px] font-semibold leading-relaxed text-stone-600">
                {DISCUSSION_TOPIC.description}
              </div>
            </details>

            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-stone-500">
                  ACP対話支援
                </p>
                <h1 className="truncate text-[22px] font-black leading-tight">
                  プレACPセッション
                </h1>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-stone-500">
                    参加者ID
                  </span>
                  {isEditingId ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <input
                        ref={idInputRef}
                        value={idDraft}
                        onChange={(event) => setIdDraft(event.target.value)}
                        onKeyDown={handleIdKeyDown}
                        className="h-8 min-w-0 rounded-md border border-emerald-400 bg-white px-2 text-[13px] font-black text-stone-950 outline-none ring-2 ring-emerald-100"
                        disabled={busyAction === "id"}
                      />
                      <button
                        type="button"
                        onClick={() => void saveDisplayId()}
                        disabled={busyAction === "id"}
                        className="h-8 rounded-md bg-emerald-700 px-3 text-[12px] font-black text-white disabled:bg-stone-300"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingId}
                        disabled={busyAction === "id"}
                        className="h-8 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 disabled:text-stone-400"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditingId}
                      disabled={!session || Boolean(busyAction)}
                      className="max-w-[260px] truncate rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[12px] font-black text-stone-700 shadow-sm disabled:text-stone-400"
                    >
                      {participantCode}
                    </button>
                  )}
                </div>
                {idError ? (
                  <p className="mt-1 text-[12px] font-bold text-red-700">
                    {idError}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-bold text-emerald-800">
                  {statusText}
                </span>
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="min-h-8 rounded-md border border-stone-300 bg-white px-3 text-[13px] font-bold text-stone-700 shadow-sm active:scale-[0.99]"
                >
                  新規
                </button>
              </div>
            </header>
          </div>
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,860px)_240px] lg:items-start">
          <PromptPanel
            prompt={promptPanel}
            topicTitle={currentTopic.title}
            topicIndex={currentTopicIndex + 1}
            topicCount={DISCUSSION_TOPICS.length}
          />
          <TopicTimer
            topicIndex={currentTopicIndex + 1}
            topicCount={DISCUSSION_TOPICS.length}
            remainingSeconds={topicRemainingSeconds}
            progress={topicProgress}
          />
        </div>

        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,860px)_240px]">
          <div className="min-w-0 space-y-3">
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-black leading-tight">
                  会話ログ
                </h2>
                <span className="text-[12px] font-bold text-stone-500">
                  {utteranceTotal}件
                </span>
              </div>

              <div
                ref={logScrollRef}
                className="mt-2 h-[640px] overflow-y-auto rounded-md border border-dashed border-stone-300 bg-white px-3 py-3 lg:h-[720px]"
              >
                {busyAction === "start" && utterances.length === 0 ? (
                  <EmptyState text="セッションを準備しています" />
                ) : utterances.length === 0 ? (
                  <EmptyState text="発話を入力するとここに表示されます" />
                ) : (
                  <div className="space-y-2">
                    {hiddenUtteranceCount > 0 ? (
                      <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-center text-[12px] font-bold text-stone-500">
                        以前の発話 {hiddenUtteranceCount} 件
                      </div>
                    ) : null}
                    {visibleUtterances.map((utterance) => (
                      <SpeechBubble
                        key={utterance.id}
                        utterance={utterance}
                        onUpdate={handleUpdateUtterance}
                        onDelete={handleDeleteUtterance}
                      />
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}
              </div>
            </section>

            <form onSubmit={handleSubmit}>
              <div className="mb-2 rounded-md border border-stone-200 bg-white px-3 py-2 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-black text-stone-700">
                      RODE Split入力
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold text-stone-500">
                      TX1=L elder / TX2=R caregiver
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleToggleStereoCapture()}
                    disabled={
                      !session ||
                      busyAction === "start" ||
                      audioCaptureState === "starting"
                    }
                    className={`min-h-9 rounded-md px-3 text-[12px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400 ${
                      audioCaptureActive ? "bg-red-700" : "bg-stone-950"
                    }`}
                  >
                    {audioCaptureActive
                      ? "停止"
                      : audioCaptureState === "starting"
                        ? "開始中"
                        : "音声入力開始"}
                  </button>
                </div>
                {audioCaptureError ? (
                  <p className="mt-2 text-[12px] font-bold text-red-700">
                    {audioCaptureError}
                  </p>
                ) : null}
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={selectedAudioDeviceId}
                    onChange={(event) =>
                      setSelectedAudioDeviceId(event.target.value)
                    }
                    disabled={audioCaptureActive}
                    className="min-h-9 rounded-md border border-stone-300 bg-white px-2 text-[12px] font-bold text-stone-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    <option value="">既定のマイク</option>
                    {audioInputDevices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `音声入力 ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void refreshAudioInputDevices()}
                    disabled={audioCaptureActive}
                    className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 shadow-sm active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    更新
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <AudioLevelMeter
                    label="elder / L"
                    level={audioLevels.elder}
                    tone="elder"
                  />
                  <AudioLevelMeter
                    label="caregiver / R"
                    level={audioLevels.caregiver}
                    tone="caregiver"
                  />
                </div>
                <label className="mt-2 flex min-h-9 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 text-[12px] font-black text-stone-700">
                  <input
                    type="checkbox"
                    checked={sttEnabled}
                    onChange={(event) => setSttEnabled(event.target.checked)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  文字起こしして保存
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SpeakerButton
                  active={speaker === "elder"}
                  label="本人"
                  onClick={() => setSpeaker("elder")}
                />
                <SpeakerButton
                  active={speaker === "caregiver"}
                  label="介護者"
                  onClick={() => setSpeaker("caregiver")}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => {
                    const nextDraft = event.target.value;

                    if (nextDraft.trim()) {
                      startTopicTimerIfNeeded();
                    }

                    setDraft(nextDraft);
                  }}
                  rows={2}
                  placeholder="発話を入力"
                  className="min-h-20 flex-1 resize-none rounded-md border border-stone-300 bg-white px-3 py-3 text-[15px] leading-relaxed outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                  disabled={!session || busyAction === "start"}
                />
                <button
                  type="submit"
                  disabled={!session || !draft.trim() || busyAction === "start"}
                  className="min-h-20 w-24 rounded-md bg-stone-950 px-3 text-[14px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400"
                >
                  追加
                </button>
              </div>
            </form>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ActionButton
                label="質問する"
                tone="emerald"
                busy={busyAction === "next_question"}
                disabled={!session || Boolean(busyAction)}
                onClick={() => handleAction("next_question")}
              />
              <ActionButton
                label="次の話題へ"
                tone="blue"
                busy={busyAction === "switch_topic"}
                disabled={!session || Boolean(busyAction)}
                onClick={() => handleAction("switch_topic")}
              />
              <ActionButton
                label="全体終了確認"
                tone="amber"
                busy={busyAction === "check_end"}
                disabled={!session || Boolean(busyAction)}
                onClick={() => handleAction("check_end")}
              />
              <ActionButton
                label="議事録更新"
                tone="stone"
                busy={busyAction === "update_slots"}
                disabled={!session || Boolean(busyAction)}
                onClick={() => handleAction("update_slots")}
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function PromptPanel(props: {
  prompt: PromptPanelState | null;
  topicTitle: string;
  topicIndex: number;
  topicCount: number;
}) {
  if (!props.prompt) {
    return (
      <div className="flex min-h-[180px] flex-col rounded-md border border-dashed border-stone-300 bg-white px-4 py-4 lg:h-[200px]">
        <div className="text-[12px] font-black text-stone-500">AIからの質問</div>
        <p className="mt-2 text-[17px] font-black leading-relaxed text-stone-500">
          下の「質問する」または「次の話題へ」を押すと、ここに介護者が読み上げられる文が表示されます。
        </p>
      </div>
    );
  }

  const toneClass =
    props.prompt.tone === "error"
      ? "border-red-300 bg-red-50"
      : props.prompt.tone === "end"
        ? "border-amber-300 bg-amber-50"
        : props.prompt.tone === "switch"
          ? "border-sky-300 bg-sky-50"
          : props.prompt.tone === "status"
            ? "border-stone-300 bg-white"
            : "border-emerald-600 bg-emerald-50";

  return (
    <div className={`flex min-h-[180px] flex-col overflow-hidden rounded-md border px-4 py-4 lg:h-[200px] ${toneClass}`}>
      <div className="space-y-1.5">
        <div className="w-fit rounded-full border border-emerald-100 bg-emerald-100 px-3 py-1 text-[12px] font-black text-emerald-800">
          話題 {props.topicIndex}/{props.topicCount}: {props.topicTitle}
        </div>
        <div className="text-[13px] font-black text-stone-700">
          {props.prompt.title}
        </div>
      </div>
      <p className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[22px] font-black leading-relaxed text-stone-950">
        {props.prompt.body}
      </p>
    </div>
  );
}

function TopicTimer(props: {
  topicIndex: number;
  topicCount: number;
  remainingSeconds: number;
  progress: number;
}) {
  const isOvertime = props.remainingSeconds < 0;
  const timerColor = isOvertime ? "#b45309" : "#047857";
  const progressDegrees = Math.round(props.progress * 360);
  const formattedTime = formatTimerSeconds(Math.abs(props.remainingSeconds));

  return (
    <div className="mx-auto flex aspect-square h-52 w-52 shrink-0 flex-col rounded-md border border-stone-200 bg-white p-4 shadow-md lg:mx-0 lg:h-[200px] lg:w-[200px]">
      <div className="text-center text-[14px] font-black text-emerald-700">
        残り時間
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
        <div
          className="grid aspect-square h-full max-h-[136px] place-items-center rounded-full"
          style={{
            background: `conic-gradient(${timerColor} ${progressDegrees}deg, #d6d3d1 0deg)`,
          }}
        >
          <div className="grid h-[74%] w-[74%] place-items-center rounded-full bg-white text-center">
            <div>
              <div className="text-[11px] font-black leading-none text-stone-500">
                {props.topicIndex}/{props.topicCount}
              </div>
              <div
                className={`mt-2 text-[32px] font-black leading-none ${
                  isOvertime ? "text-amber-700" : "text-emerald-800"
                }`}
              >
                {isOvertime ? `+${formattedTime}` : formattedTime}
              </div>
              <div className="mt-2 text-[11px] font-black leading-none text-stone-500">
                {isOvertime ? "超過" : "残り"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getPendingPrompt(buttonType: ButtonType): PromptPanelState {
  if (buttonType === "next_question") {
    return {
      title: "AIからの質問",
      body: "質問を生成しています。",
      tone: "status",
    };
  }

  if (buttonType === "switch_topic") {
    return {
      title: "次の話題へ",
      body: "今の話題を終えてよいか確認し、必要なら追加質問を生成しています。",
      tone: "status",
    };
  }

  if (buttonType === "check_end") {
    return {
      title: "全体終了確認",
      body: "今日の対話を終えてよいか確認しています。",
      tone: "status",
    };
  }

  return {
    title: "議事録更新",
    body: "会話ログから議事録を更新しています。",
    tone: "status",
  };
}

function EmptyState(props: { text: string }) {
  return (
    <div className="flex min-h-full items-center justify-center rounded-md bg-white px-4 text-center text-[13px] font-bold text-stone-500">
      {props.text}
    </div>
  );
}

function SpeakerButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-10 rounded-md border px-3 text-[13px] font-black active:scale-[0.99] ${
        props.active
          ? "border-emerald-700 bg-emerald-700 text-white"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {props.label}
    </button>
  );
}

function AudioLevelMeter(props: {
  label: string;
  level: number;
  tone: Speaker;
}) {
  const percentage = Math.round(Math.min(1, Math.max(0, props.level)) * 100);
  const barClass =
    props.tone === "caregiver" ? "bg-sky-600" : "bg-emerald-700";

  return (
    <div className="rounded-md border border-stone-200 bg-white px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-black text-stone-700">
          {props.label}
        </span>
        <span className="text-[10px] font-black tabular-nums text-stone-500">
          {percentage}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ${barClass}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function SpeechBubble(props: {
  utterance: Utterance;
  onUpdate: (utteranceId: string, speaker: Speaker, text: string) => Promise<void>;
  onDelete: (utteranceId: string) => Promise<void>;
}) {
  const normalizedSpeaker = normalizeSpeaker(props.utterance.speaker);
  const isCaregiver = normalizedSpeaker === "caregiver";
  const [isEditing, setIsEditing] = useState(false);
  const [editSpeaker, setEditSpeaker] = useState<Speaker>(normalizedSpeaker);
  const [editText, setEditText] = useState(props.utterance.text);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (isEditing) return;

    setEditSpeaker(normalizeSpeaker(props.utterance.speaker));
    setEditText(props.utterance.text);
    setErrorText("");
  }, [
    isEditing,
    props.utterance.id,
    props.utterance.speaker,
    props.utterance.text,
  ]);

  async function saveEdit() {
    setIsSaving(true);
    setErrorText("");

    try {
      await props.onUpdate(props.utterance.id, editSpeaker, editText);
      setIsEditing(false);
    } catch (error) {
      setErrorText(
        error instanceof Error && error.message
          ? error.message
          : "発話を更新できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEdit() {
    setIsSaving(true);
    setErrorText("");

    try {
      await props.onDelete(props.utterance.id);
      setIsEditing(false);
    } catch (error) {
      setErrorText(
        error instanceof Error && error.message
          ? error.message
          : "発話を削除できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing) {
    return (
      <div className={`flex ${isCaregiver ? "justify-end" : "justify-start"}`}>
        <article className="max-w-[92%] rounded-md border border-emerald-300 bg-white px-3 py-2 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <select
              value={editSpeaker}
              onChange={(event) => setEditSpeaker(event.target.value as Speaker)}
              disabled={isSaving}
              className="min-h-9 rounded-md border border-stone-300 bg-white px-2 text-[12px] font-black text-stone-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            >
              <option value="elder">elder / 本人</option>
              <option value="caregiver">caregiver / 介護者</option>
            </select>
            <textarea
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              disabled={isSaving}
              rows={3}
              className="min-h-20 resize-y rounded-md border border-stone-300 bg-white px-2 py-2 text-[13px] font-bold leading-relaxed text-stone-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            />
          </div>
          {errorText ? (
            <p className="mt-2 text-[12px] font-bold text-red-700">
              {errorText}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditSpeaker(normalizeSpeaker(props.utterance.speaker));
                setEditText(props.utterance.text);
                setIsEditing(false);
              }}
              disabled={isSaving}
              className="min-h-8 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 disabled:text-stone-400"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void deleteEdit()}
              disabled={isSaving}
              className="min-h-8 rounded-md border border-red-200 bg-red-50 px-3 text-[12px] font-black text-red-700 disabled:text-stone-400"
            >
              削除
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={isSaving || !editText.trim()}
              className="min-h-8 rounded-md bg-emerald-700 px-3 text-[12px] font-black text-white disabled:bg-stone-300"
            >
              保存
            </button>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className={`flex ${isCaregiver ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isCaregiver
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-stone-200 bg-[#fffdf7] text-stone-950"
        }`}
      >
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <div
            className={`text-[10px] font-black ${
              isCaregiver ? "text-sky-100" : "text-emerald-700"
            }`}
          >
            {isCaregiver ? "caregiver / 介護者" : "elder / 本人"}
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
              isCaregiver
                ? "bg-sky-100 text-sky-800"
                : "bg-stone-100 text-stone-600"
            }`}
          >
            編集
          </button>
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {props.utterance.text}
        </p>
        <time
          className={`mt-1 block text-[10px] font-bold ${
            isCaregiver ? "text-sky-100" : "text-stone-400"
          }`}
        >
          {formatDateTime(props.utterance.created_at)}
        </time>
      </article>
    </div>
  );
}

function ActionButton(props: {
  label: string;
  tone: "emerald" | "blue" | "amber" | "stone";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const toneClass =
    props.tone === "emerald"
      ? "border-sky-700 bg-sky-700 text-white"
      : props.tone === "blue"
        ? "border-orange-500 bg-orange-500 text-white"
        : props.tone === "amber"
          ? "border-pink-200 bg-pink-100 text-pink-900"
          : "border-stone-500 bg-stone-500 text-white";

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-12 rounded-md border px-2 text-[13px] font-black leading-tight shadow-sm active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 ${toneClass}`}
    >
      {props.busy ? "処理中" : props.label}
    </button>
  );
}

async function startSession(): Promise<SessionInfo> {
  const data = await postJson<{ session: SessionInfo }>("/api/session/start", {
    condition: "mvp",
  });

  return data.session;
}

async function fetchSessionDetail(sessionId: string): Promise<{
  session: SessionInfo;
  utterance_count: number;
  utterances: Utterance[];
}> {
  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorText =
      errorBody && typeof errorBody.error === "string"
        ? errorBody.error
        : `Failed to restore session: ${response.status}`;

    throw new Error(errorText);
  }

  return response.json();
}

async function addUtterance(
  sessionId: string,
  speaker: Speaker,
  text: string,
): Promise<Utterance> {
  const data = await postJson<{ utterance: Utterance }>("/api/utterance", {
    session_id: sessionId,
    speaker,
    text,
  });

  return data.utterance;
}

async function updateUtterance(
  utteranceId: string,
  speaker: Speaker,
  text: string,
): Promise<Utterance> {
  const data = await patchJson<{ utterance: Utterance }>(
    `/api/utterance/${encodeURIComponent(utteranceId)}`,
    {
      speaker,
      text,
    },
  );

  return data.utterance;
}

async function deleteUtterance(utteranceId: string) {
  const response = await fetch(
    `/api/utterance/${encodeURIComponent(utteranceId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorText =
      errorBody && typeof errorBody.error === "string"
        ? errorBody.error
        : "発話を削除できませんでした。";

    throw new Error(toUserFacingError(errorText));
  }
}

async function sendAudioChunkToStt(
  sessionId: string,
  speaker: Speaker,
  blob: Blob,
  mimeType: string,
  chunkNumber: number,
): Promise<TranscribeUtteranceResponse> {
  const formData = new FormData();
  const extension = getAudioFileExtension(mimeType);

  formData.append("session_id", sessionId);
  formData.append("speaker", speaker);
  formData.append(
    "audio",
    blob,
    `${speaker}-${Date.now()}-${chunkNumber}.${extension}`,
  );

  const response = await fetch("/api/transcribe-utterance", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorText =
      errorBody && typeof errorBody.error === "string"
        ? errorBody.error
        : "音声認識に失敗しました。";

    throw new Error(toUserFacingError(errorText));
  }

  return response.json() as Promise<TranscribeUtteranceResponse>;
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getAudioFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function readAudioLevel(data: Uint8Array) {
  if (data.length === 0) return 0;

  let total = 0;

  for (const value of data) {
    const centered = (value - 128) / 128;
    total += centered * centered;
  }

  return Math.min(1, Math.sqrt(total / data.length) * 3);
}

function stopAudioCapture(handle: AudioCaptureHandle | null) {
  if (!handle) return;

  if (handle.levelFrameId !== null) {
    window.cancelAnimationFrame(handle.levelFrameId);
    handle.levelFrameId = null;
  }

  for (const recorder of handle.recorders) {
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Recorder may already be stopping after a device disconnect.
      }
    }
  }

  for (const track of handle.stream.getTracks()) {
    track.stop();
  }

  for (const node of [
    handle.source,
    handle.splitter,
    handle.leftDestination,
    handle.rightDestination,
    handle.leftAnalyser,
    handle.rightAnalyser,
  ]) {
    try {
      node.disconnect();
    } catch {
      // Some browsers throw if a node was already disconnected.
    }
  }

  void handle.context.close().catch(() => {});
}

function normalizeSpeaker(value: string): Speaker {
  return value === "caregiver" ? "caregiver" : "elder";
}

function getAudioCaptureError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "マイク使用が許可されていません。ブラウザの権限を確認してください。";
    }

    if (error.name === "NotFoundError") {
      return "音声入力デバイスが見つかりません。RODE Wireless PROの接続を確認してください。";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "音声入力の処理に失敗しました。";
}

async function updateSessionDisplayId(
  sessionId: string,
  participantCode: string,
): Promise<SessionInfo> {
  const data = await patchJson<{ session: SessionInfo }>(
    `/api/session/${encodeURIComponent(sessionId)}`,
    {
      participant_code: participantCode,
    },
  );

  return data.session;
}

async function saveButtonEvent(sessionId: string, buttonType: ButtonType) {
  const data = await postJson<{
    button_event: {
      id: string;
    };
  }>("/api/button-event", {
    session_id: sessionId,
    button_type: buttonType,
  });

  return data.button_event.id;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, "POST", body);
}

async function patchJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, "PATCH", body);
}

async function requestJson<T = unknown>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorText =
      errorBody && typeof errorBody.error === "string"
        ? errorBody.error
        : `Request failed: ${url}`;

    throw new Error(toUserFacingError(errorText));
  }

  return response.json() as Promise<T>;
}

function toUserFacingError(error: string) {
  if (error === "participant_code already exists") {
    return "この参加者IDはすでに使われています。";
  }

  if (error === "participant_code cannot be empty") {
    return "参加者IDを入力してください。";
  }

  if (error === "OPENAI_API_KEY is required for audio transcription") {
    return "音声認識にはOPENAI_API_KEYが必要です。";
  }

  if (error === "Failed to transcribe utterance") {
    return "音声認識に失敗しました。";
  }

  if (error === "speaker and text are required") {
    return "話者と本文を入力してください。";
  }

  if (error === "Failed to update utterance") {
    return "発話を更新できませんでした。";
  }

  if (error === "Failed to delete utterance") {
    return "発話を削除できませんでした。";
  }

  if (error === "Utterance not found") {
    return "発話が見つかりませんでした。";
  }

  return error;
}

function joinPrompt(transition: string, question: string) {
  if (!transition) return question;
  return `${transition}${question}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createInitialTopicBudgets() {
  return DISCUSSION_TOPICS.map(() => TOPIC_BASE_SECONDS);
}

function getElapsedSeconds(startedAt: number, now = Date.now()) {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function distributeRemainingTopicTime(
  budgets: number[],
  completedTopicIndex: number,
  elapsedSeconds: number,
) {
  const currentBudget = budgets[completedTopicIndex] ?? TOPIC_BASE_SECONDS;
  const remainingSeconds = Math.max(0, currentBudget - elapsedSeconds);
  const firstRemainingIndex = completedTopicIndex + 1;
  const remainingTopicCount = Math.max(
    0,
    DISCUSSION_TOPICS.length - firstRemainingIndex,
  );

  if (remainingSeconds === 0 || remainingTopicCount === 0) return budgets;

  const secondsPerTopic = Math.floor(remainingSeconds / remainingTopicCount);
  const extraSeconds = remainingSeconds % remainingTopicCount;

  return budgets.map((budget, index) => {
    if (index < firstRemainingIndex) return budget;

    const remainderBonus = index - firstRemainingIndex < extraSeconds ? 1 : 0;
    return budget + secondsPerTopic + remainderBonus;
  });
}

function formatTimerSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type NextQuestionResponse = {
  suggestion: {
    id: string;
    question: string;
    transition_phrase: string;
  };
};

type TopicSwitchResponse = {
  suggestion: {
    id: string;
    message: string;
    should_switch: boolean;
    next_topic: string;
  };
};

type EndCheckResponse = {
  suggestion: {
    id: string;
    can_end: boolean;
    message: string;
  };
};

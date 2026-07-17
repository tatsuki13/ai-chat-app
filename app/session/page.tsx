"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  buildSlotControlDebugState,
  DISCUSSION_TOPIC,
  DISCUSSION_TOPICS,
  type SlotControlDebugState,
} from "../../lib/acp-mvp";
import {
  createSingleMicInputService,
  loadAudioInputs,
  type SingleMicAudioChunk,
  type SingleMicInputLevel,
  type SingleMicInputService,
  type StereoSpeaker,
} from "./audio-input-service";
import {
  detectSpeakerFromLipActivity,
  summarizeLipActivity,
  toStoredConversationSpeaker,
  type SpeakerDetectionResult,
} from "./active-speaker-detector";
import {
  createLipActivityService,
  type LipActivityFrame,
} from "./lip-activity-service";
import {
  createSessionClock,
  DEFAULT_PARTICIPANT_LAYOUT,
  monotonicToSessionOffsetMs,
  startSharedMediaStream,
  stopMediaStream,
  type ParticipantLayout,
  type SessionClock,
} from "./media-session-service";
import {
  createSessionRecordingService,
  type RecordingMetadata,
} from "./session-recording-service";
import {
  createVoiceActivityDetector,
  type VoiceActivitySegment,
} from "./voice-activity-detector";

type Speaker = "caregiver" | "elder";
type SpeakerWithUnknown = Speaker | "unknown";
type ButtonType = "next_question" | "switch_topic" | "check_end" | "update_slots";
type PromptTone = "question" | "switch" | "end" | "status" | "error";

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

type SlotState = {
  slot_name: string;
  status:
    | "unanswered"
    | "partial"
    | "answered"
    | "no_preference"
    | "not_considered"
    | "cannot_verbalize"
    | "prefer_not_to_answer"
    | "not_asked"
    | "empty"
    | "filled";
  summary: string;
  evidence_utterance: string;
  updated_at?: string;
};

type ProposalReason =
  | "base_time_elapsed"
  | "max_time_elapsed"
  | "core_slots_completed"
  | "no_more_to_add"
  | "not_considered"
  | "prefer_not_to_answer";

type TopicTransitionProposal = {
  reason: ProposalReason;
  suggestedAt: number;
  topicIndex: number;
};

type SessionCompletionState =
  | "active"
  | "completing"
  | "generating_minutes"
  | "completed"
  | "failed";

type PromptPanelState = {
  title: string;
  body: string;
  tone: PromptTone;
};

type TranscribeUtteranceResponse = {
  utterance?: Utterance | null;
  transcript?: string;
  skipped?: boolean;
  speaker?: Speaker;
};

type FinalMinutesResponse = {
  session: SessionInfo;
  slot_states: SlotState[];
  final_minutes: {
    id: string;
    markdown: string;
    json: unknown;
    created_at: string;
  };
};

const STORAGE_KEY = "acp-hitl-current-session-id";
const MAX_RENDERED_UTTERANCES = 30;
const BASE_TOPIC_DURATION_MS = 5 * 60 * 1000;
const MAX_EXTENSION_DURATION_MS = 2 * 60 * 1000;
const MAX_TOPIC_DURATION_MS = BASE_TOPIC_DURATION_MS + MAX_EXTENSION_DURATION_MS;
const PROPOSAL_COOLDOWN_MS = 100 * 1000;
const EXTENSION_STEP_MS = 2 * 60 * 1000;
const TIMER_TICK_MS = 1000;
const PROMPT_STATUS_RESTORE_DELAY_MS = 2000;
const AUDIO_TRANSCRIPTION_ENABLED =
  process.env.NEXT_PUBLIC_AUDIO_TRANSCRIPTION !== "false";

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
  const [topicPausedMs, setTopicPausedMs] = useState(0);
  const [topicExtensionMs, setTopicExtensionMs] = useState(0);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [transitionProposal, setTransitionProposal] =
    useState<TopicTransitionProposal | null>(null);
  const [proposalCooldownUntil, setProposalCooldownUntil] = useState(0);
  const [completionState, setCompletionState] =
    useState<SessionCompletionState>("active");
  const [finalMinutes, setFinalMinutes] = useState<{
    id: string;
    markdown: string;
    created_at: string;
  } | null>(null);
  const [completionError, setCompletionError] = useState("");
  const [sttEnabled] = useState(AUDIO_TRANSCRIPTION_ENABLED);
  const [audioInputRunning, setAudioInputRunning] = useState(false);
  const [audioInputError, setAudioInputError] = useState("");
  const [audioInputLevels, setAudioInputLevels] = useState({ A: 0, B: 0 });
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState("");
  const [audioInputLoading, setAudioInputLoading] = useState(false);
  const [pushToTalkActive, setPushToTalkActive] = useState(false);
  const [mediaSessionRunning, setMediaSessionRunning] = useState(false);
  const [mediaSessionError, setMediaSessionError] = useState("");
  const [participantLayout, setParticipantLayout] = useState<ParticipantLayout>(
    DEFAULT_PARTICIPANT_LAYOUT,
  );
  const [autoVoiceDetectionEnabled, setAutoVoiceDetectionEnabled] = useState(false);
  const [lipActivityFrame, setLipActivityFrame] = useState<LipActivityFrame | null>(null);
  const [speakerDetection, setSpeakerDetection] =
    useState<SpeakerDetectionResult | null>(null);
  const [recordingMetadata, setRecordingMetadata] =
    useState<RecordingMetadata | null>(null);
  const [developerSlotStates, setDeveloperSlotStates] = useState<SlotState[]>([]);
  const [developerSlotControl, setDeveloperSlotControl] =
    useState<SlotControlDebugState | null>(null);
  const [developerSlotLoading, setDeveloperSlotLoading] = useState(false);
  const [developerSlotError, setDeveloperSlotError] = useState("");
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);
  const promptPanelRef = useRef<PromptPanelState | null>(null);
  const restorablePromptPanelRef = useRef<PromptPanelState | null>(
    createOpeningPrompt(),
  );
  const promptRestoreTimeoutRef = useRef<number | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const speakerRef = useRef<Speaker>("elder");
  const pushToTalkPressedRef = useRef(false);
  const pushToTalkStartingRef = useRef(false);
  const pushToTalkActiveRef = useRef(false);
  const topicStartedAtRef = useRef<number | null>(null);
  const timerPausedStartedAtRef = useRef<number | null>(null);
  const timerRunningRef = useRef(false);
  const sttEnabledRef = useRef(AUDIO_TRANSCRIPTION_ENABLED);
  const voiceInputServiceRef = useRef<SingleMicInputService | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const sharedMediaStreamRef = useRef<MediaStream | null>(null);
  const sessionClockRef = useRef<SessionClock | null>(null);
  const lipActivityServiceRef = useRef<ReturnType<typeof createLipActivityService> | null>(null);
  const lipActivityFramesRef = useRef<LipActivityFrame[]>([]);
  const speakerDetectionRef = useRef<SpeakerDetectionResult | null>(null);
  const participantLayoutRef = useRef<ParticipantLayout>(DEFAULT_PARTICIPANT_LAYOUT);
  const voiceActivityDetectorRef = useRef<ReturnType<typeof createVoiceActivityDetector> | null>(null);
  const recordingServiceRef = useRef<ReturnType<typeof createSessionRecordingService> | null>(null);

  const participantCode = session?.participant_code || "未設定";
  const currentTopic = DISCUSSION_TOPICS[currentTopicIndex] ?? DISCUSSION_TOPICS[0];
  const nextTopic = DISCUSSION_TOPICS[currentTopicIndex + 1] ?? null;
  const visibleUtterances = utterances.slice(-MAX_RENDERED_UTTERANCES);
  const hiddenUtteranceCount = Math.max(
    0,
    utteranceTotal - visibleUtterances.length,
  );
  const isLastTopic = currentTopicIndex >= DISCUSSION_TOPICS.length - 1;
  const topicBudgetMs =
    Math.min(
      MAX_TOPIC_DURATION_MS,
      (topicBudgets[currentTopicIndex] ?? BASE_TOPIC_DURATION_MS) +
        topicExtensionMs,
    );
  const topicElapsedMs =
    topicStartedAt === null
      ? 0
      : Math.max(0, timerNow - topicStartedAt - topicPausedMs);
  const topicRemainingSeconds = Math.ceil((topicBudgetMs - topicElapsedMs) / 1000);
  const baseTimeElapsed = topicElapsedMs >= BASE_TOPIC_DURATION_MS;
  const maxTimeElapsed = topicElapsedMs >= MAX_TOPIC_DURATION_MS;
  const topicProgress =
    topicBudgetMs > 0
      ? Math.min(1, topicElapsedMs / topicBudgetMs)
      : 1;
  const isConversationTimerRunning =
    Boolean(session) &&
    topicStartedAt !== null &&
    completionState === "active" &&
    !busyAction &&
    !transitionProposal;

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
    promptPanelRef.current = promptPanel;

    if (isRestorablePrompt(promptPanel)) {
      restorablePromptPanelRef.current = promptPanel;
    }
  }, [promptPanel]);

  useEffect(() => {
    return () => {
      clearPromptRestoreTimeout();
    };
  }, []);

  useEffect(() => {
    if (!session?.id) {
      setDeveloperSlotStates([]);
      setDeveloperSlotControl(null);
      return;
    }

    void refreshDeveloperSlotStates(session.id);
  }, [session?.id, currentTopic.slot_name]);

  useEffect(() => {
    speakerRef.current = normalizeSpeaker(speaker);
    setAudioInputLevels({ A: 0, B: 0 });
  }, [speaker]);

  useEffect(() => {
    topicStartedAtRef.current = topicStartedAt;
  }, [topicStartedAt]);

  useEffect(() => {
    sttEnabledRef.current = sttEnabled;
  }, [sttEnabled]);

  useEffect(() => {
    participantLayoutRef.current = participantLayout;
  }, [participantLayout]);

  useEffect(() => {
    void refreshAudioInputDevices();
  }, []);

  useEffect(() => {
    const service = createSingleMicInputService();
    const unsubscribeChunk = service.onChunk((chunk) => {
      void handleVoiceAudioChunk(chunk);
    });
    const unsubscribeLevel = service.onLevel((level) => {
      updateVoiceInputLevel(level);
    });

    voiceInputServiceRef.current = service;
    recordingServiceRef.current = createSessionRecordingService();
    voiceActivityDetectorRef.current = createVoiceActivityDetector({
      onSpeechStart: (segmentStartedAtMs) => {
        handleVoiceActivityStart(segmentStartedAtMs);
      },
      onSpeechEnd: (segment) => {
        handleVoiceActivityEnd(segment);
      },
    });

    return () => {
      unsubscribeChunk();
      unsubscribeLevel();
      service.stopVoiceInput();
      lipActivityServiceRef.current?.stop();
      void recordingServiceRef.current?.stop();
      stopMediaStream(sharedMediaStreamRef.current);
      voiceInputServiceRef.current = null;
      recordingServiceRef.current = null;
      voiceActivityDetectorRef.current = null;
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
    const now = Date.now();

    if (!topicStartedAt || !session) {
      timerRunningRef.current = false;
      timerPausedStartedAtRef.current = null;
      return;
    }

    if (isConversationTimerRunning) {
      if (!timerRunningRef.current && timerPausedStartedAtRef.current !== null) {
        const pausedForMs = now - timerPausedStartedAtRef.current;
        setTopicPausedMs((current) => current + Math.max(0, pausedForMs));
        timerPausedStartedAtRef.current = null;
      }

      timerRunningRef.current = true;
      setTimerNow(now);
      return;
    }

    if (timerRunningRef.current || timerPausedStartedAtRef.current === null) {
      timerPausedStartedAtRef.current = now;
      setTimerNow(now);
    }

    timerRunningRef.current = false;
  }, [isConversationTimerRunning, session, topicStartedAt]);

  useEffect(() => {
    if (!isConversationTimerRunning) return;

    const timerId = window.setInterval(() => {
      setTimerNow(Date.now());
    }, TIMER_TICK_MS);

    return () => window.clearInterval(timerId);
  }, [isConversationTimerRunning]);

  useEffect(() => {
    if (!session || topicStartedAt === null) return;
    if (completionState !== "active") return;
    if (busyAction || pushToTalkActive || transitionProposal) return;
    if (timerNow < proposalCooldownUntil) return;

    const reason = getTransitionProposalReason({
      baseTimeElapsed,
      maxTimeElapsed,
      currentTopicSlot: developerSlotStates.find(
        (slot) => slot.slot_name === currentTopic.slot_name,
      ),
      utterances,
    });

    if (!reason) return;

    setTransitionProposal({
      reason,
      suggestedAt: Date.now(),
      topicIndex: currentTopicIndex,
    });
  }, [
    baseTimeElapsed,
    busyAction,
    completionState,
    currentTopic.slot_name,
    currentTopicIndex,
    developerSlotStates,
    maxTimeElapsed,
    proposalCooldownUntil,
    pushToTalkActive,
    session,
    timerNow,
    topicStartedAt,
    transitionProposal,
    utterances,
  ]);

  useEffect(() => {
    if (isEditingId) {
      window.setTimeout(() => {
        idInputRef.current?.focus();
        idInputRef.current?.select();
      }, 0);
    }
  }, [isEditingId]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      if (shouldIgnorePushToTalkShortcut(event.target)) return;

      event.preventDefault();
      pushToTalkPressedRef.current = true;
      void beginPushToTalk();
    }

    function handleKeyUp(event: globalThis.KeyboardEvent) {
      if (event.code !== "Space") return;
      if (
        !pushToTalkPressedRef.current &&
        shouldIgnorePushToTalkShortcut(event.target)
      ) {
        return;
      }

      event.preventDefault();
      endPushToTalk();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [session?.id, busyAction, selectedAudioDeviceId]);

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
    setAudioInputLoading(true);
    setAudioInputError("");

    try {
      const devices = await loadAudioInputs();

      setAudioInputDevices(devices);
      setSelectedAudioDeviceId((current) => current || devices[0]?.deviceId || "");
    } catch (error) {
      console.warn("Failed to load audio inputs", error);
      setAudioInputError("音声入力デバイスを確認してください。");
    } finally {
      setAudioInputLoading(false);
    }
  }

  async function handleAudioDeviceChange(deviceId: string) {
    setSelectedAudioDeviceId(deviceId);

    if (!audioInputRunning) return;

    await stopMediaSession();
    stopVoiceAudioInput();
    await startVoiceAudioInput(deviceId);
  }

  async function startVoiceAudioInput(deviceId = selectedAudioDeviceId) {
    if (!voiceInputServiceRef.current) return;

    setAudioInputError("");

    try {
      await voiceInputServiceRef.current.startVoiceInput({
        deviceId,
        stream: sharedMediaStreamRef.current ?? undefined,
      });
      setAudioInputRunning(true);
    } catch (error) {
      console.warn("Voice audio input failed", error);
      setAudioInputRunning(false);
      setAudioInputError("音声入力を確認してください。");
    }
  }

  async function startMediaSession() {
    if (!sessionRef.current || mediaSessionRunning) return;

    setMediaSessionError("");

    try {
      const stream = await startSharedMediaStream();
      const clock = createSessionClock();

      sharedMediaStreamRef.current = stream;
      sessionClockRef.current = clock;
      lipActivityFramesRef.current = [];

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        await videoPreviewRef.current.play().catch(() => {});
      }

      if (videoPreviewRef.current) {
        const service = createLipActivityService(videoPreviewRef.current, clock);
        lipActivityServiceRef.current = service;
        service.onFrame((frame) => {
          lipActivityFramesRef.current = [...lipActivityFramesRef.current, frame].slice(-900);
          setLipActivityFrame(frame);
        });
        service.start();
      }

      await voiceInputServiceRef.current?.startVoiceInput({ stream });
      setAudioInputRunning(Boolean(voiceInputServiceRef.current?.isRunning()));

      const metadata = await recordingServiceRef.current?.start(
        sessionRef.current.id,
        stream.clone(),
      );
      setRecordingMetadata(metadata ?? null);
      setMediaSessionRunning(true);
      setAutoVoiceDetectionEnabled(true);
      startTopicTimerIfNeeded();
    } catch (error) {
      console.warn("Media session failed", error);
      setMediaSessionRunning(false);
      setAutoVoiceDetectionEnabled(false);
      setMediaSessionError("Camera/microphone session could not be started.");
      void stopMediaSession();
    }
  }

  async function stopMediaSession() {
    setAutoVoiceDetectionEnabled(false);
    voiceActivityDetectorRef.current?.forceEnd(getCurrentSessionOffsetMs());
    endPushToTalk();
    voiceInputServiceRef.current?.stopVoiceInput();
    setAudioInputRunning(false);
    lipActivityServiceRef.current?.stop();
    lipActivityServiceRef.current = null;
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    const metadata = await recordingServiceRef.current?.stop();
    setRecordingMetadata(metadata ?? recordingMetadata);
    stopMediaStream(sharedMediaStreamRef.current);
    sharedMediaStreamRef.current = null;
    setMediaSessionRunning(false);
    setAudioInputLevels({ A: 0, B: 0 });
  }

  async function beginPushToTalk() {
    if (!sessionRef.current || busyAction === "start") return;
    if (!voiceInputServiceRef.current || pushToTalkStartingRef.current) return;
    if (pushToTalkActiveRef.current) return;

    pushToTalkStartingRef.current = true;

    try {
      if (!voiceInputServiceRef.current.isRunning()) {
        await startVoiceAudioInput();
      }

      if (!voiceInputServiceRef.current.isRunning()) return;
      if (!pushToTalkPressedRef.current) return;

      const activeSpeaker = toAudioSpeaker(speakerRef.current);
      startTopicTimerIfNeeded();
      voiceInputServiceRef.current.startCapture(activeSpeaker);
      pushToTalkActiveRef.current = true;
      setPushToTalkActive(true);
    } finally {
      pushToTalkStartingRef.current = false;
    }
  }

  function endPushToTalk() {
    pushToTalkPressedRef.current = false;
    voiceInputServiceRef.current?.stopCapture();
    pushToTalkActiveRef.current = false;
    setPushToTalkActive(false);
    setAudioInputLevels({ A: 0, B: 0 });
  }

  function stopVoiceAudioInput() {
    endPushToTalk();
    voiceInputServiceRef.current?.stopVoiceInput();
    setAudioInputRunning(false);
    setAudioInputLevels({ A: 0, B: 0 });
  }

  function updateVoiceInputLevel(level: SingleMicInputLevel) {
    const normalizedLevel = Math.min(1, Math.max(level.rms * 8, level.peak));
    const activeSpeaker = pushToTalkActiveRef.current
      ? toAudioSpeaker(speakerRef.current)
      : toAudioSpeaker(resolveDetectedSpeakerFallback());

    setAudioInputLevels({
      A: activeSpeaker === "A" ? normalizedLevel : 0,
      B: activeSpeaker === "B" ? normalizedLevel : 0,
    });

    if (autoVoiceDetectionEnabled && !pushToTalkActiveRef.current) {
      voiceActivityDetectorRef.current?.update(
        normalizedLevel,
        getCurrentSessionOffsetMs(level.at),
      );
    }
  }

  function handleVoiceActivityStart(segmentStartedAtMs: number) {
    if (!voiceInputServiceRef.current || pushToTalkActiveRef.current) return;

    const detection = detectSpeakerForSegment(segmentStartedAtMs, segmentStartedAtMs);
    const storedSpeaker = toStoredConversationSpeaker(detection.detectedSpeaker);
    const captureSpeaker = toAudioSpeaker(
      storedSpeaker === "unknown" ? speakerRef.current : storedSpeaker,
    );

    speakerDetectionRef.current = detection;
    setSpeakerDetection(detection);
    startTopicTimerIfNeeded();
    voiceInputServiceRef.current.startCapture(captureSpeaker);
  }

  function handleVoiceActivityEnd(segment: VoiceActivitySegment) {
    if (!voiceInputServiceRef.current || pushToTalkActiveRef.current) return;

    const detection = detectSpeakerForSegment(segment.startedAtMs, segment.endedAtMs);
    speakerDetectionRef.current = detection;
    setSpeakerDetection(detection);
    voiceInputServiceRef.current.stopCapture();
  }

  function detectSpeakerForSegment(startedAtMs: number, endedAtMs: number) {
    const summary = summarizeLipActivity(
      lipActivityFramesRef.current,
      startedAtMs,
      Math.max(endedAtMs, startedAtMs + 1),
    );

    return detectSpeakerFromLipActivity(summary, participantLayoutRef.current);
  }

  function resolveDetectedSpeakerFallback(): Speaker {
    return resolveStoredSpeaker(
      toStoredConversationSpeaker(
        speakerDetectionRef.current?.detectedSpeaker ?? "unknown",
      ),
      speakerRef.current,
    );
  }

  function getCurrentSessionOffsetMs(atEpochMs?: number) {
    const clock = sessionClockRef.current;
    if (!clock) return Date.now();
    if (typeof atEpochMs === "number") {
      return Math.max(0, atEpochMs - clock.sessionStartedAtEpochMs);
    }

    return monotonicToSessionOffsetMs(clock);
  }

  async function handleVoiceAudioChunk(chunk: SingleMicAudioChunk) {
    const currentSession = sessionRef.current;
    if (!currentSession || chunk.blob.size < 512 || !sttEnabledRef.current) return;

    try {
      const data = await sendAudioChunkToStt(
        currentSession.id,
        chunk.speaker,
        chunk.blob,
        chunk.mimeType,
        chunk.sequence,
        chunk.startedAt,
        chunk.endedAt,
      );

      if (!data.utterance) return;

      startTopicTimerIfNeeded();
      setUtterances((current) =>
        [...current, data.utterance as Utterance]
          .sort(compareUtterancesByTime)
          .slice(-MAX_RENDERED_UTTERANCES),
      );
      setUtteranceTotal((current) => current + 1);
      setStatusText("保存済み");
    } catch (error) {
      console.warn("Voice audio transcription failed", error);
      setAudioInputError("音声入力を確認してください。");
    }
  }

  function getAudioAwareSavedStatus() {
    return "保存済み";
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

  function clearPromptRestoreTimeout() {
    if (promptRestoreTimeoutRef.current === null) return;

    window.clearTimeout(promptRestoreTimeoutRef.current);
    promptRestoreTimeoutRef.current = null;
  }

  function schedulePromptRestore(
    visiblePrompt: PromptPanelState,
    restorePrompt: PromptPanelState | null,
  ) {
    clearPromptRestoreTimeout();
    if (!restorePrompt) return;

    promptRestoreTimeoutRef.current = window.setTimeout(() => {
      promptRestoreTimeoutRef.current = null;

      if (promptPanelRef.current !== visiblePrompt) return;

      setPromptPanel(restorePrompt);
    }, PROMPT_STATUS_RESTORE_DELAY_MS);
  }

  async function handleAction(buttonType: ButtonType) {
    if (!session || busyAction) return;

    clearPromptRestoreTimeout();
    const promptToRestore =
      isRestorablePrompt(promptPanel)
        ? promptPanel
        : restorablePromptPanelRef.current;

    setBusyAction(buttonType);
    setStatusText("保存中");
    setPromptPanel(getPendingPrompt(buttonType));

    try {
      if (buttonType !== "update_slots") {
        await postJson("/api/ai/update-slots", {
          session_id: session.id,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });
      }

      if (buttonType === "next_question") {
        const data = await postJson<NextQuestionResponse>("/api/ai/next-question", {
          session_id: session.id,
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
          tone: "question",
        });
      }

      if (buttonType === "switch_topic") {
        const data = await postJson<TopicSwitchResponse>("/api/ai/switch-topic", {
          session_id: session.id,
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
          tone: data.suggestion.should_switch ? "switch" : "question",
        });
      }

      if (buttonType === "check_end") {
        const data = await postJson<EndCheckResponse>("/api/ai/check-end", {
          session_id: session.id,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });

        if (!data.suggestion.can_end) {
          const questionData = await postJson<NextQuestionResponse>(
            "/api/ai/next-question",
            {
              session_id: session.id,
              current_topic: currentTopic.slot_name,
              current_topic_title: currentTopic.title,
            },
          );
          const body = joinPrompt(
            questionData.suggestion.transition_phrase,
            questionData.suggestion.question,
          );

          setPromptPanel({
            title: "全体としてもう少し確認",
            body,
            tone: "question",
          });
        } else {
          setPromptPanel({
            title: "全体終了確認",
            body: data.suggestion.message,
            tone: "end",
          });
        }
      }

      if (buttonType === "update_slots") {
        await postJson("/api/ai/update-slots", {
          session_id: session.id,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });

        const updatedPrompt = {
          title: "議事録更新",
          body: "議事録を更新しました。",
          tone: "status",
        } satisfies PromptPanelState;

        setPromptPanel(updatedPrompt);
        schedulePromptRestore(updatedPrompt, promptToRestore);
      }

      await refreshDeveloperSlotStates(session.id);
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

    stopVoiceAudioInput();
    setBusyAction("start");
    setPromptPanel(createOpeningPrompt());
    setIsEditingId(false);
    setIdError("");
    setDeveloperSlotStates([]);
    setDeveloperSlotControl(null);
    setDeveloperSlotError("");
    setDeveloperSlotLoading(false);
    resetTopicTiming();

    try {
      const created = await startSession();
      window.localStorage.setItem(STORAGE_KEY, created.id);
      sessionRef.current = created;
      setSession(created);
      setUtterances([]);
      setUtteranceTotal(0);
      setDraft("");
      setDeveloperSlotStates([]);
      setDeveloperSlotControl(null);
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

  async function refreshDeveloperSlotStates(
    sessionId: string,
    options: { semantic?: boolean } = {},
  ) {
    setDeveloperSlotLoading(true);
    setDeveloperSlotError("");

    try {
      const detail = await fetchAdminSessionDetail(
        sessionId,
        currentTopic.slot_name,
        options.semantic === true,
      );
      setDeveloperSlotStates(detail.slot_states);
      setDeveloperSlotControl(detail.slot_control ?? null);
    } catch {
      setDeveloperSlotError("slot states unavailable");
      setDeveloperSlotControl(null);
    } finally {
      setDeveloperSlotLoading(false);
    }
  }

  async function acceptTransitionProposal() {
    if (!session || busyAction || completionState !== "active") return;

    setTransitionProposal(null);

    if (isLastTopic) {
      await completeSession();
      return;
    }

    setBusyAction("switch_topic");
    setStatusText("保存中");

    try {
      await postJson("/api/ai/update-slots", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      const data = await postJson<TopicSwitchResponse>("/api/ai/switch-topic", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
        next_topic: nextTopic?.slot_name,
        next_topic_title: nextTopic?.title,
        force_switch: true,
      });

      advanceTopic();
      setPromptPanel({
        title: "次の話題へ",
        body: data.suggestion.message,
        tone: "switch",
      });
      await refreshDeveloperSlotStates(session.id);
      setStatusText("保存済み");
    } catch {
      setStatusText("保存エラー");
      setPromptPanel({
        title: "話題転換を実行できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function extendCurrentTopic() {
    setTopicExtensionMs((current) =>
      Math.min(MAX_EXTENSION_DURATION_MS, current + EXTENSION_STEP_MS),
    );
    setTransitionProposal(null);
    setProposalCooldownUntil(Date.now() + PROPOSAL_COOLDOWN_MS);
  }

  function dismissTransitionProposal() {
    setTransitionProposal(null);
    setProposalCooldownUntil(Date.now() + PROPOSAL_COOLDOWN_MS);
  }

  async function completeSession() {
    if (!session || completionState === "generating_minutes") return;

    stopVoiceAudioInput();
    setCompletionState("generating_minutes");
    setBusyAction("update_slots");
    setCompletionError("");
    setStatusText("議事録生成中");

    try {
      await postJson("/api/ai/update-slots", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      const data = await postJson<FinalMinutesResponse>("/api/ai/final-minutes", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });

      setSession(data.session);
      setFinalMinutes(data.final_minutes);
      setCompletionState("completed");
      setTopicStartedAt(null);
      topicStartedAtRef.current = null;
      setStatusText("完了");
      await refreshDeveloperSlotStates(session.id);
    } catch {
      setCompletionState("failed");
      setCompletionError("議事録生成に失敗しました。同じデータから再試行できます。");
      setStatusText("議事録生成エラー");
    } finally {
      setBusyAction(null);
    }
  }

  function resetTopicTiming() {
    const now = Date.now();

    setCurrentTopicIndex(0);
    setTopicBudgets(createInitialTopicBudgets());
    topicStartedAtRef.current = null;
    timerPausedStartedAtRef.current = null;
    timerRunningRef.current = false;
    setTopicPausedMs(0);
    setTopicExtensionMs(0);
    setTransitionProposal(null);
    setProposalCooldownUntil(0);
    setCompletionState("active");
    setCompletionError("");
    setFinalMinutes(null);
    setTopicStartedAt(null);
    setTimerNow(now);
  }

  function startTopicTimerIfNeeded() {
    if (!sessionRef.current || topicStartedAtRef.current !== null) return;

    const now = Date.now();
    topicStartedAtRef.current = now;
    timerPausedStartedAtRef.current = null;
    timerRunningRef.current = true;
    setTopicPausedMs(0);
    setTopicStartedAt(now);
    setTimerNow(now);
  }

  function advanceTopic() {
    if (!nextTopic) return;

    const now = Date.now();

    setCurrentTopicIndex((current) =>
      Math.min(current + 1, DISCUSSION_TOPICS.length - 1),
    );
    topicStartedAtRef.current = now;
    timerPausedStartedAtRef.current = null;
    timerRunningRef.current = true;
    setTopicPausedMs(0);
    setTopicStartedAt(now);
    setTopicExtensionMs(0);
    setTransitionProposal(null);
    setProposalCooldownUntil(0);
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
                  disabled={Boolean(busyAction)}
                  className="min-h-8 rounded-md border border-stone-300 bg-white px-3 text-[13px] font-bold text-stone-700 shadow-sm active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
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

        {transitionProposal ? (
          <div className="mt-3">
            <TopicTransitionProposalCard
              isLastTopic={isLastTopic}
              maxTimeElapsed={maxTimeElapsed}
              reason={transitionProposal.reason}
              extended={topicExtensionMs > 0}
              disabled={Boolean(busyAction) || completionState !== "active"}
              onAccept={() => void acceptTransitionProposal()}
              onExtend={extendCurrentTopic}
              onDismiss={dismissTransitionProposal}
            />
          </div>
        ) : null}

        {completionState === "completed" || completionState === "failed" ? (
          <div className="mt-3">
            <SessionCompletionPanel
              state={completionState}
              finalMinutes={finalMinutes}
              error={completionError}
              onRetry={() => void completeSession()}
            />
          </div>
        ) : null}

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

            <section className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[14px] font-black leading-tight">
                    Camera / visual speaker detection
                  </h2>
                  <p className="mt-0.5 text-[11px] font-bold text-stone-500">
                    Single mic audio is segmented by voice activity. Speaker labels are inferred from left/right lip activity.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (mediaSessionRunning) {
                      void stopMediaSession();
                    } else {
                      void startMediaSession();
                    }
                  }}
                  disabled={!session || busyAction === "start"}
                  className="min-h-9 rounded-md bg-stone-950 px-3 text-[12px] font-black text-white disabled:bg-stone-200 disabled:text-stone-400"
                >
                  {mediaSessionRunning ? "Stop camera" : "Start camera"}
                </button>
              </div>
              {mediaSessionError ? (
                <p className="mt-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700">
                  {mediaSessionError}
                </p>
              ) : null}
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
                <div className="relative overflow-hidden rounded-md border border-stone-200 bg-stone-950">
                  <video
                    ref={videoPreviewRef}
                    muted
                    playsInline
                    className="aspect-video w-full scale-x-[-1] bg-stone-950 object-cover"
                  />
                  <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-white/70" />
                  <div className="absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] font-black text-white">
                    L: {speakerLabel(participantLayout.leftSpeaker)}
                  </div>
                  <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-[11px] font-black text-white">
                    R: {speakerLabel(participantLayout.rightSpeaker)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setParticipantLayout({
                          leftSpeaker: "elder",
                          rightSpeaker: "caregiver",
                        })
                      }
                      disabled={mediaSessionRunning}
                      className={`min-h-10 rounded-md border px-2 text-[11px] font-black ${
                        participantLayout.leftSpeaker === "elder"
                          ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                          : "border-stone-200 bg-white text-stone-600"
                      } disabled:opacity-60`}
                    >
                      L elder / R caregiver
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setParticipantLayout({
                          leftSpeaker: "caregiver",
                          rightSpeaker: "elder",
                        })
                      }
                      disabled={mediaSessionRunning}
                      className={`min-h-10 rounded-md border px-2 text-[11px] font-black ${
                        participantLayout.leftSpeaker === "caregiver"
                          ? "border-sky-700 bg-sky-50 text-sky-900"
                          : "border-stone-200 bg-white text-stone-600"
                      } disabled:opacity-60`}
                    >
                      L caregiver / R elder
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoVoiceDetectionEnabled((current) => !current)}
                    disabled={!mediaSessionRunning}
                    className={`min-h-9 w-full rounded-md border px-2 text-[12px] font-black ${
                      autoVoiceDetectionEnabled
                        ? "border-emerald-700 bg-emerald-700 text-white"
                        : "border-stone-300 bg-white text-stone-700"
                    } disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400`}
                  >
                    {autoVoiceDetectionEnabled ? "Auto VAD on" : "Auto VAD off"}
                  </button>
                  <LipMeter
                    label="Left lip"
                    value={lipActivityFrame?.leftSpeakingLikelihood ?? 0}
                    visible={lipActivityFrame?.leftFaceVisible ?? false}
                  />
                  <LipMeter
                    label="Right lip"
                    value={lipActivityFrame?.rightSpeakingLikelihood ?? 0}
                    visible={lipActivityFrame?.rightFaceVisible ?? false}
                  />
                  <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-bold text-stone-600">
                    Detected: {speakerDetection ? speakerLabel(toStoredConversationSpeaker(speakerDetection.detectedSpeaker)) : "-"}
                    {speakerDetection ? ` / ${Math.round(speakerDetection.confidence * 100)}% / ${speakerDetection.detectionReason}` : ""}
                  </div>
                  <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-bold text-stone-600">
                    Recording: {recordingMetadata?.status ?? "idle"}
                    {recordingMetadata ? ` / chunks ${recordingMetadata.chunkCount}` : ""}
                  </div>
                </div>
              </div>
            </section>

            <form onSubmit={handleSubmit}>
              {audioInputError ? (
                <p className="mb-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700">
                  {audioInputError}
                </p>
              ) : null}
              <div className="mb-2">
                <select
                  value={selectedAudioDeviceId}
                  onChange={(event) => {
                    void handleAudioDeviceChange(event.target.value);
                  }}
                  disabled={audioInputLoading}
                  className="min-h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-[12px] font-bold text-stone-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100 disabled:text-stone-400"
                >
                  <option value="">既定のマイク</option>
                  {audioInputDevices.map((device, index) => (
                    <option key={`${device.deviceId}-${index}`} value={device.deviceId}>
                      {device.label || `音声入力 ${index + 1}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SpeakerButton
                  active={speaker === "elder"}
                  label="本人"
                  level={audioInputLevels.A}
                  onClick={() => setSpeaker("elder")}
                />
                <SpeakerButton
                  active={speaker === "caregiver"}
                  label="介護者"
                  level={audioInputLevels.B}
                  onClick={() => setSpeaker("caregiver")}
                />
              </div>
              <p className="mt-1 text-[11px] font-bold text-stone-500">
                {pushToTalkActive
                  ? "録音中です。Spaceを離すと自動で追加されます。"
                  : "Spaceを押している間だけ、選択中の話者として録音します。手入力欄ではSpaceは通常入力・変換に使えます。"}
              </p>
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

          </div>

          <div className="space-y-3">
            <DeveloperDialogueTopics
              slotStates={developerSlotStates}
              slotControl={developerSlotControl}
              currentTopic={currentTopic.slot_name}
              loading={developerSlotLoading}
              error={developerSlotError}
              onRefresh={() => {
                void handleAction("update_slots");
              }}
            />

            <div className="grid grid-cols-2 gap-2">
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

function DeveloperDialogueTopics(props: {
  slotStates: SlotState[];
  slotControl: SlotControlDebugState | null;
  currentTopic: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const slotControl =
    props.slotControl ??
    buildSlotControlDebugState({
      slots: props.slotStates,
      currentTopic: props.currentTopic,
    });
  const filledCount = props.slotStates.filter(
    (slot) => isTerminalSlotStatus(slot.status),
  ).length;
  const summaryText = props.loading
    ? "Loading"
    : props.slotStates.length
      ? `${filledCount}/${props.slotStates.length} filled`
      : "No slots";

  return (
    <aside className="rounded-md border border-stone-300 bg-white shadow-sm">
      <details>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 marker:hidden">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.08em] text-stone-500">
              Dev Tool
            </div>
            <h2 className="mt-1 text-[14px] font-black leading-tight text-stone-950">
              Topic Slots
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-stone-500">{summaryText}</span>
            <span className="rounded-md border border-stone-300 bg-stone-50 px-2 py-1 text-[11px] font-black text-stone-700">
              Open
            </span>
          </div>
        </summary>

        <div className="border-t border-stone-200 px-3 pb-3 pt-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={props.onRefresh}
              className="min-h-8 rounded-md border border-stone-300 bg-stone-50 px-2 text-[11px] font-black text-stone-700 active:scale-[0.99]"
            >
              Update slots
            </button>
          </div>

          {props.error ? (
        <p className="mt-2 rounded-md border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] font-bold text-red-700">
          {props.error}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {slotControl.mainSlots.map((mainSlot) => (
          <details
            key={mainSlot.topicId}
            open={mainSlot.isCurrentTopic}
            className={`rounded-md border px-2 py-2 ${
              mainSlot.isCurrentTopic
                ? "border-emerald-200 bg-emerald-50"
                : "border-stone-200 bg-stone-50"
            }`}
          >
            <summary className="cursor-pointer text-[12px] font-black leading-snug text-stone-900">
              {mainSlot.isCurrentTopic ? "▼ " : "▶ "}
              {mainSlot.label}
              <span className="ml-1 text-[10px] font-bold text-stone-500">
                {slotStatusLabel(mainSlot.status)}
              </span>
            </summary>
            <div className="mt-2 space-y-1.5">
              {mainSlot.subSlots.map((subSlot) => (
                <div
                  key={`${mainSlot.topicId}-${subSlot.id}`}
                  className="rounded-md bg-white px-2 py-1.5 text-[11px] leading-snug text-stone-700"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-black text-stone-900">{subSlot.label}</span>
                    <StatusPill status={subSlot.status} />
                    {subSlot.inDeferredQueue ? <MiniPill text="保留" tone="amber" /> : null}
                    {subSlot.canAskAgain ? <MiniPill text="再質問可" tone="stone" /> : null}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <details className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2 py-2">
        <summary className="cursor-pointer text-[11px] font-black text-stone-700">
          制御確認
        </summary>
        <div className="mt-2 space-y-1 text-[10px] font-bold leading-relaxed text-stone-600">
          <div>現在テーマID: {slotControl.currentTopicId}</div>
          <div>参照メインスロット: {slotControl.currentMainSlot}</div>
          <div>
            参照サブスロット:{" "}
            {slotControl.referencedSubSlots.length
              ? slotControl.referencedSubSlots.join(" / ")
              : "-"}
          </div>
          <div>全スロット参照: {slotControl.allSlotReferenceUsed ? "あり" : "なし"}</div>
          <div>保留キュー: {slotControl.deferredSlotQueue.length}件</div>
          <div>終了前確認対象: {slotControl.beforeSessionEndTargets.length}件</div>
          <div>{slotControl.selectionReason}</div>
        </div>
      </details>
        </div>
      </details>
    </aside>
  );
}

function StatusPill(props: { status: string }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-black ${slotStatusClassName(
        props.status,
      )}`}
    >
      {slotStatusLabel(props.status)}
    </span>
  );
}

function MiniPill(props: { text: string; tone: "amber" | "stone" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${
        props.tone === "amber"
          ? "bg-amber-100 text-amber-800"
          : "bg-stone-100 text-stone-700"
      }`}
    >
      {props.text}
    </span>
  );
}

function slotStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unanswered: "未回答",
    partially_answered: "部分回答",
    partial: "部分回答",
    answered: "回答済み",
    filled: "回答済み",
    not_applicable: "該当なし",
    no_preference: "該当なし",
    declined: "辞退",
    prefer_not_to_answer: "辞退",
    unable_to_verbalize: "言語化困難",
    cannot_verbalize: "言語化困難",
    not_considered: "未検討",
    needs_follow_up: "要確認",
    deferred: "保留",
  };

  return labels[status] ?? status;
}

function slotStatusClassName(status: string) {
  if (status === "answered" || status === "filled") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (status === "partially_answered" || status === "partial" || status === "needs_follow_up") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (
    status === "not_applicable" ||
    status === "no_preference" ||
    status === "declined" ||
    status === "prefer_not_to_answer"
  ) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  if (status === "unable_to_verbalize" || status === "cannot_verbalize") {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }

  return "border-stone-200 bg-stone-100 text-stone-700";
}

function TopicTransitionProposalCard(props: {
  isLastTopic: boolean;
  maxTimeElapsed: boolean;
  reason: ProposalReason;
  extended: boolean;
  disabled: boolean;
  onAccept: () => void;
  onExtend: () => void;
  onDismiss: () => void;
}) {
  const reasonLabel = proposalReasonLabel(props.reason);

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black text-amber-800">
            AIからの提案
          </div>
          <p className="mt-1 text-[15px] font-black leading-relaxed text-stone-950">
            {props.isLastTopic
              ? "すべてのテーマについてお話ししました。今回の対話を終了して、議事録を作成しますか？"
              : "このテーマについて、ある程度お話しできたようです。次の話題をAIから提示しますか？"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-stone-600">
            <span className="rounded-full bg-white px-2 py-0.5">
              {reasonLabel}
            </span>
            {props.extended ? (
              <span className="rounded-full bg-white px-2 py-0.5">延長中</span>
            ) : null}
            {props.maxTimeElapsed ? (
              <span className="rounded-full bg-white px-2 py-0.5">
                最大時間到達
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={props.onAccept}
            disabled={props.disabled}
            className="min-h-9 rounded-md bg-stone-950 px-3 text-[12px] font-black text-white disabled:bg-stone-300"
          >
            {props.isLastTopic
              ? "対話を終了して議事録を作成する"
              : "AIに次の話題を提示してもらう"}
          </button>
          <button
            type="button"
            onClick={props.onExtend}
            disabled={props.disabled}
            className="min-h-9 rounded-md border border-amber-300 bg-white px-3 text-[12px] font-black text-amber-900 disabled:text-stone-400"
          >
            もう少し話す
          </button>
          <button
            type="button"
            onClick={props.onDismiss}
            disabled={props.disabled}
            className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 disabled:text-stone-400"
          >
            閉じる
          </button>
        </div>
      </div>
    </section>
  );
}

function SessionCompletionPanel(props: {
  state: SessionCompletionState;
  finalMinutes: { id: string; markdown: string; created_at: string } | null;
  error: string;
  onRetry: () => void;
}) {
  const [pdfFileName, setPdfFileName] = useState(() =>
    createDefaultPdfFileName(),
  );

  if (props.state === "failed") {
    return (
      <section className="rounded-md border border-red-200 bg-red-50 px-4 py-3">
        <div className="text-[13px] font-black text-red-800">議事録生成エラー</div>
        <p className="mt-1 text-[13px] font-bold text-red-700">{props.error}</p>
        <button
          type="button"
          onClick={props.onRetry}
          className="mt-2 min-h-9 rounded-md bg-red-700 px-3 text-[12px] font-black text-white"
        >
          議事録を再生成
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="text-[13px] font-black text-emerald-800">対話完了</div>
      <p className="mt-1 text-[13px] font-bold text-emerald-900">
        議事録を作成して保存しました。
      </p>
      {props.finalMinutes ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="block">
              <span className="text-[11px] font-black text-emerald-800">
                PDFファイル名
              </span>
              <input
                value={pdfFileName}
                onChange={(event) => setPdfFileName(event.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-emerald-200 bg-white px-3 text-[13px] font-bold text-stone-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                placeholder="ACP議事録"
              />
            </label>
            <button
              type="button"
              onClick={() =>
                void downloadFinalMinutesPdf(props.finalMinutes, pdfFileName)
              }
              className="min-h-9 self-end rounded-md bg-emerald-700 px-3 text-[12px] font-black text-white active:scale-[0.99]"
            >
              PDFとして保存
            </button>
          </div>
          <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-emerald-100 bg-white px-3 py-2 text-[12px] font-semibold text-stone-700">
            {props.finalMinutes.markdown}
          </div>
        </>
      ) : null}
    </section>
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

function isRestorablePrompt(
  prompt: PromptPanelState | null,
): prompt is PromptPanelState {
  return (
    prompt?.tone === "question" ||
    prompt?.tone === "switch" ||
    prompt?.tone === "end"
  );
}

function EmptyState(props: { text: string }) {
  return (
    <div className="flex min-h-full items-center justify-center rounded-md bg-white px-4 text-center text-[13px] font-bold text-stone-500">
      {props.text}
    </div>
  );
}

function LipMeter(props: { label: string; value: number; visible: boolean }) {
  const width = `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] font-black text-stone-600">
        <span>{props.label}</span>
        <span>{props.visible ? width : "not visible"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className={`h-full ${props.visible ? "bg-emerald-600" : "bg-stone-300"}`}
          style={{ width: props.visible ? width : "4%" }}
        />
      </div>
    </div>
  );
}

function SpeakerButton(props: {
  active: boolean;
  label: string;
  level: number;
  onClick: () => void;
}) {
  const levelPercent = Math.round(Math.min(1, props.level) * 100);

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-12 rounded-md border px-3 py-2 text-[13px] font-black active:scale-[0.99] ${
        props.active
          ? "border-emerald-700 bg-emerald-700 text-white"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      <span>{props.label}</span>
      <span
        className={`mt-1 block h-1.5 overflow-hidden rounded-full ${
          props.active ? "bg-white/25" : "bg-stone-200"
        }`}
      >
        <span
          className={`block h-full rounded-full transition-[width] ${
            props.active ? "bg-white" : "bg-emerald-600"
          }`}
          style={{ width: `${levelPercent}%` }}
        />
      </span>
    </button>
  );
}

function SpeechBubble(props: {
  utterance: Utterance;
  onUpdate: (utteranceId: string, speaker: Speaker, text: string) => Promise<void>;
  onDelete: (utteranceId: string) => Promise<void>;
}) {
  const normalizedSpeaker = normalizeSpeaker(props.utterance.speaker);
  const isSpeakerB = normalizedSpeaker === "caregiver";
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
      <div className={`flex ${isSpeakerB ? "justify-end" : "justify-start"}`}>
        <article className="max-w-[92%] rounded-md border border-emerald-300 bg-white px-3 py-2 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <select
              value={editSpeaker}
              onChange={(event) => setEditSpeaker(event.target.value as Speaker)}
              disabled={isSaving}
              className="min-h-9 rounded-md border border-stone-300 bg-white px-2 text-[12px] font-black text-stone-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            >
              <option value="elder">本人</option>
              <option value="caregiver">介護者</option>
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
    <div className={`flex ${isSpeakerB ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isSpeakerB
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-stone-200 bg-[#fffdf7] text-stone-950"
        }`}
      >
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <div
            className={`text-[10px] font-black ${
              isSpeakerB ? "text-sky-100" : "text-emerald-700"
            }`}
          >
            {isSpeakerB ? "介護者" : "本人"}
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
              isSpeakerB
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
            isSpeakerB ? "text-sky-100" : "text-stone-400"
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

async function fetchAdminSessionDetail(
  sessionId: string,
  currentTopic?: string,
  semantic = false,
): Promise<{
  slot_states: SlotState[];
  slot_control?: SlotControlDebugState;
}> {
  const params = new URLSearchParams();
  if (currentTopic) params.set("current_topic", currentTopic);
  if (semantic) params.set("semantic", "1");
  const response = await fetch(
    `/api/admin/session/${encodeURIComponent(sessionId)}${
      params.size ? `?${params.toString()}` : ""
    }`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load developer slot states: ${response.status}`);
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
  speaker: StereoSpeaker,
  blob: Blob,
  mimeType: string,
  chunkNumber: number,
  startedAt?: number,
  endedAt?: number,
): Promise<TranscribeUtteranceResponse> {
  const formData = new FormData();
  const extension = getAudioFileExtension(mimeType);

  formData.append("session_id", sessionId);
  formData.append("speaker", normalizeSpeaker(speaker));
  formData.append(
    "audio",
    blob,
    `${speaker}-${Date.now()}-${chunkNumber}.${extension}`,
  );
  if (startedAt) formData.append("started_at", String(startedAt));
  if (endedAt) formData.append("ended_at", String(endedAt));

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

function getAudioFileExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function normalizeSpeaker(value: string): Speaker {
  return value === "B" || value === "caregiver" ? "caregiver" : "elder";
}

function speakerLabel(value: SpeakerWithUnknown) {
  if (value === "elder") return "本人";
  if (value === "caregiver") return "介護者";
  return "unknown";
}

function resolveStoredSpeaker(value: SpeakerWithUnknown, fallback: Speaker): Speaker {
  return value === "unknown" ? fallback : value;
}

function toAudioSpeaker(speaker: Speaker): StereoSpeaker {
  return speaker === "caregiver" ? "B" : "A";
}

function shouldIgnorePushToTalkShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();

  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "button"
  );
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

function compareUtterancesByTime(left: Utterance, right: Utterance) {
  return (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );
}

function getTransitionProposalReason(input: {
  baseTimeElapsed: boolean;
  maxTimeElapsed: boolean;
  currentTopicSlot?: SlotState;
  utterances: Utterance[];
}): ProposalReason | null {
  if (input.maxTimeElapsed) return "max_time_elapsed";
  if (input.baseTimeElapsed && isTerminalSlotStatus(input.currentTopicSlot?.status)) {
    return "core_slots_completed";
  }

  const latestText = input.utterances.at(-1)?.text ?? "";
  if (hasPreferNotToAnswer(latestText)) return "prefer_not_to_answer";
  if (hasNoMoreToAdd(latestText)) return "no_more_to_add";
  if (hasNotConsidered(latestText)) return "not_considered";
  if (input.baseTimeElapsed) return "base_time_elapsed";

  return null;
}

function isTerminalSlotStatus(status: unknown) {
  return (
    status === "answered" ||
    status === "filled" ||
    status === "no_preference" ||
    status === "not_considered" ||
    status === "cannot_verbalize" ||
    status === "prefer_not_to_answer"
  );
}

function hasNoMoreToAdd(text: string) {
  return /特にない|もうない|ほかにはない|他にはない|大丈夫/.test(text);
}

function hasNotConsidered(text: string) {
  return /分からない|わからない|考えたことがない|まだ決めていない|言葉にできない/.test(
    text,
  );
}

function hasPreferNotToAnswer(text: string) {
  return /話したくない|答えたくない|言いたくない/.test(text);
}

function proposalReasonLabel(reason: ProposalReason) {
  const labels: Record<ProposalReason, string> = {
    base_time_elapsed: "基準時間経過",
    max_time_elapsed: "最大時間到達",
    core_slots_completed: "コア項目確認済み",
    no_more_to_add: "追加なし",
    not_considered: "保留回答",
    prefer_not_to_answer: "回答回避",
  };

  return labels[reason];
}

function createDefaultPdfFileName() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `ACP議事録-${year}-${month}-${day}`;
}

async function downloadFinalMinutesPdf(
  finalMinutes: { markdown: string; created_at: string } | null,
  rawFileName: string,
) {
  if (!finalMinutes) return;

  const fileName = sanitizePdfFileName(rawFileName || createDefaultPdfFileName());
  const pdfBlob = await createCanvasPdfBlob(
    `${fileName}\nPDF作成日時: ${formatDateTime(finalMinutes.created_at)}\n\n${finalMinutes.markdown}`,
  );
  if (pdfBlob.size === 0) return;

  const objectUrl = URL.createObjectURL(pdfBlob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${fileName}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
}

async function createCanvasPdfBlob(markdown: string) {
  const pages = renderMinutesToPageImages(markdown);
  const objects: Array<Array<string | ArrayBuffer>> = [];
  const addObject = (...body: Array<string | ArrayBuffer>) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = addObject("");
  const pageIds: number[] = [];

  pages.forEach((image) => {
    const imageId = addObject(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.byteLength} >>\nstream\n`,
      image.bytes,
      "\nendstream",
    );
    const content = `q\n595 0 0 842 0 0 cm\n/Im1 Do\nQ`;
    const contentId = addObject(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });

  objects[pagesId - 1] = [
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
  ];

  const parts: Array<string | ArrayBuffer> = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(partsByteLength(parts));
    parts.push(`${index + 1} 0 obj\n`, ...body, "\nendobj\n");
  });
  const xrefOffset = partsByteLength(parts);
  parts.push(`xref\n0 ${objects.length + 1}\n`);
  parts.push("0000000000 65535 f \n");
  offsets.slice(1).forEach((offset) => {
    parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(parts, { type: "application/pdf" });
}

function renderMinutesToPageImages(markdown: string) {
  const pageWidth = 1240;
  const pageHeight = 1754;
  const margin = 92;
  const lineHeight = 34;
  const lines = markdown
    .replace(/^#{1,3}\s+/gm, "")
    .split(/\r?\n/)
    .flatMap((line) => wrapByCanvasWidth(line.trim() || " ", pageWidth - margin * 2))
    .slice(0, 520);
  const linesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(lines.length / linesPerPage)) },
    (_, index) => lines.slice(index * linesPerPage, (index + 1) * linesPerPage),
  );

  return chunks.map((pageLines) => {
    const canvas = document.createElement("canvas");
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return { bytes: new ArrayBuffer(0), width: pageWidth, height: pageHeight };
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pageWidth, pageHeight);
    context.fillStyle = "#1c1917";
    context.font = '24px "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';
    context.textBaseline = "top";
    pageLines.forEach((line, index) => {
      context.fillText(line, margin, margin + index * lineHeight);
    });

    return {
      bytes: dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92)),
      width: pageWidth,
      height: pageHeight,
    };
  });
}

function wrapByCanvasWidth(line: string, maxWidth: number) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return [line];
  context.font = '24px "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif';

  const wrapped: string[] = [];
  let current = "";
  for (const char of line) {
    const next = `${current}${char}`;
    if (current && context.measureText(next).width > maxWidth) {
      wrapped.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  wrapped.push(current || " ");
  return wrapped;
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = window.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function partsByteLength(parts: Array<string | ArrayBuffer>) {
  return parts.reduce(
    (total, part) => total + (typeof part === "string" ? byteLength(part) : part.byteLength),
    0,
  );
}

function sanitizePdfFileName(value: string) {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || createDefaultPdfFileName();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createInitialTopicBudgets() {
  return DISCUSSION_TOPICS.map(() => BASE_TOPIC_DURATION_MS);
}

function getElapsedSeconds(startedAt: number, now = Date.now()) {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatTimerSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type NextQuestionResponse = {
  suggestion: {
    question: string;
    transition_phrase: string;
  };
};

type TopicSwitchResponse = {
  suggestion: {
    message: string;
    should_switch: boolean;
    next_topic: string;
  };
};

type EndCheckResponse = {
  suggestion: {
    can_end: boolean;
    message: string;
  };
};

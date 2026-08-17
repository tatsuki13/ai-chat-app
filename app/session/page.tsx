"use client";

import {
  FormEvent,
  KeyboardEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  buildSlotControlDebugState,
  DISCUSSION_TOPIC,
  DISCUSSION_TOPICS,
  type SlotControlDebugState,
} from "../../lib/acp-mvp";
import {
  createRemoteStreamInputService,
  createSingleMicInputService,
  loadAudioInputs,
  type RemoteStreamInputService,
  type SingleMicAudioChunk,
  type SingleMicInputLevel,
  type SingleMicInputService,
  type StereoSpeaker,
} from "./audio-input-service";

type Speaker = "caregiver" | "elder";
type SpeakerRole = Speaker;
type SpeakerWithUnknown = Speaker | "unknown";
type ButtonType = "next_question" | "switch_topic" | "check_end" | "update_slots";
type PromptTone = "question" | "switch" | "end" | "status" | "error";
type TopicTimerStartSource = "text" | "local_voice" | "remote_voice";
type ConversationAction =
  | { type: "generate_question"; reason: string }
  | { type: "switch_topic"; reason: string }
  | { type: "continue_same_question"; reason: string }
  | { type: "complete_session"; reason: string };

type RemoteMicConnectionStatus =
  | "not-issued"
  | "waiting"
  | "connected"
  | "disconnected"
  | "expired"
  | "revoked";
type RemoteMicRoleStatus = {
  status: RemoteMicConnectionStatus;
  expiresAt?: string;
  usedAt?: string | null;
  revokedAt?: string | null;
  lastHeartbeatAt?: string | null;
  disconnectedAt?: string | null;
  muted?: boolean;
  transmitting?: boolean;
};
type RemoteMicStatusResponse = {
  now: string;
  roles: Record<SpeakerRole, RemoteMicRoleStatus>;
};
type FixedRemoteMicActiveResponse = {
  active: {
    sessionId: string;
    participantCode: string | null;
    endedAt: string | null;
    dialogueStartedAt: string | null;
    roles: Record<
      SpeakerRole,
      {
        connectedAt: number | null;
        lastSeenAt: number | null;
        muted: boolean;
        transmitting: boolean;
      }
    >;
  };
};
type RemoteMicWebRtcOffer = {
  peerId: string;
  role: SpeakerRole;
  offer: RTCSessionDescriptionInit;
};
type RemoteMicPeerHandle = {
  peerConnection: RTCPeerConnection;
  role: SpeakerRole;
};
type RemoteStreamInputSetup = {
  service: RemoteStreamInputService;
  unsubscribeChunk: () => void;
  unsubscribeLevel: () => void;
};

type SessionInfo = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  dialogue_started_at: string | null;
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
  | "prefer_not_to_answer"
  | "ready_to_end";

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

type UpdateSlotsResponse = {
  slot_states: SlotState[];
  sub_slot_states: unknown[];
  slot_control?: SlotControlDebugState;
  slot_classification_debug?: unknown;
};

type SessionLookupResponse = {
  session: (SessionInfo & {
    utterance_count: number;
    has_final_minutes: boolean;
  }) | null;
};

const STORAGE_KEY = "acp-hitl-pending-auto-session-id";
const MAX_RENDERED_UTTERANCES = 30;
const BASE_TOPIC_DURATION_MS = 5 * 60 * 1000;
const DECISION_RATIO = 0.6;
const PROPOSAL_COOLDOWN_MS = 100 * 1000;
const TIMER_TICK_MS = 1000;
const PROMPT_STATUS_RESTORE_DELAY_MS = 2000;
const REMOTE_MIC_STATUS_POLL_MS = 10_000;
const REMOTE_MIC_SESSION_SYNC_MS = 5_000;
const AUDIO_TRANSCRIPTION_ENABLED =
  process.env.NEXT_PUBLIC_AUDIO_TRANSCRIPTION !== "false";

function createOpeningPrompt(
  topic: (typeof DISCUSSION_TOPICS)[number] = DISCUSSION_TOPICS[0],
): PromptPanelState {
  return {
    title: "最初の話題提供",
    body: topic.opening_prompt,
    tone: "question",
  };
}

function createTopicTransitionPrompt(
  topic: (typeof DISCUSSION_TOPICS)[number],
): PromptPanelState {
  return {
    title: "次の話題へ",
    body: topic.opening_prompt,
    tone: "switch",
  };
}

export default function SessionPage() {
  return (
    <Suspense fallback={<SessionPageLoading />}>
      <SessionPageClient />
    </Suspense>
  );
}

function SessionPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSessionId = searchParams.get("sessionId")?.trim() ?? "";
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
  const [topicTimerSource, setTopicTimerSource] =
    useState<TopicTimerStartSource | null>(null);
  const [topicPausedMs, setTopicPausedMs] = useState(0);
  const [decisionPromptShownByTopic, setDecisionPromptShownByTopic] = useState<
    boolean[]
  >(() => DISCUSSION_TOPICS.map(() => false));
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [transitionProposal, setTransitionProposal] =
    useState<TopicTransitionProposal | null>(null);
  const [proposalCooldownUntil, setProposalCooldownUntil] = useState(0);
  const [completionState, setCompletionState] =
    useState<SessionCompletionState>("active");
  const [finalMinutes, setFinalMinutes] = useState<{
    id: string;
    markdown: string;
    json: unknown;
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
  const [remoteMicStatuses, setRemoteMicStatuses] = useState<
    Record<SpeakerRole, RemoteMicRoleStatus>
  >({
    caregiver: { status: "not-issued" },
    elder: { status: "not-issued" },
  });
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
  const remoteStreamInputServiceRef = useRef<RemoteStreamInputService | null>(null);
  const remoteStreamInputSetupRef = useRef<RemoteStreamInputSetup | null>(null);
  const remoteMicPeerHandlesRef = useRef<Map<string, RemoteMicPeerHandle>>(
    new Map(),
  );

  const participantCode = session?.participant_code || "未設定";
  const currentTopic = DISCUSSION_TOPICS[currentTopicIndex] ?? DISCUSSION_TOPICS[0];
  const nextTopic = DISCUSSION_TOPICS[currentTopicIndex + 1] ?? null;
  const visibleUtterances = utterances.slice(-MAX_RENDERED_UTTERANCES);
  const hiddenUtteranceCount = Math.max(
    0,
    utteranceTotal - visibleUtterances.length,
  );
  const isLastTopic = currentTopicIndex >= DISCUSSION_TOPICS.length - 1;
  const topicBudgetMs = topicBudgets[currentTopicIndex] ?? BASE_TOPIC_DURATION_MS;
  const topicElapsedMs =
    topicStartedAt === null
      ? 0
      : Math.max(0, timerNow - topicStartedAt - topicPausedMs);
  const topicRemainingSeconds = Math.ceil((topicBudgetMs - topicElapsedMs) / 1000);
  const decisionAtMs = calculateTopicDecisionAtMs(topicBudgetMs);
  const decisionTimeElapsed = topicElapsedMs >= decisionAtMs;
  const maxTimeElapsed = topicElapsedMs >= topicBudgetMs;
  const carryToNextTopicMs = calculateDistributedCarryPerTopicMs(
    currentTopicIndex,
    topicBudgetMs,
    topicElapsedMs,
  );
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
  const remoteMicrophoneConnected =
    remoteMicStatuses.elder.status === "connected" ||
    remoteMicStatuses.caregiver.status === "connected";

  useEffect(() => {
    let ignore = false;

    async function boot() {
      try {
        const pendingAutoSessionId = window.localStorage.getItem(STORAGE_KEY);

        if (requestedSessionId) {
          try {
            await discardUnusedSession(pendingAutoSessionId);
            const restored = await fetchSessionDetail(requestedSessionId);

            if (!ignore) {
              window.localStorage.removeItem(STORAGE_KEY);
              setSession(restored.session);
              setUtterances(restored.utterances);
              setUtteranceTotal(restored.utterance_count);
              resetTopicTiming();
              applyDialogueStartedAt(restored.session.dialogue_started_at);
              setStatusText("保存済み");
              setBusyAction(null);
            }

            return;
          } catch {
            throw new Error("Failed to restore session");
          }
        }

        await discardUnusedSession(pendingAutoSessionId);
        const created = await startSession();

        if (!ignore) {
          window.localStorage.setItem(STORAGE_KEY, created.id);
          sessionRef.current = created;
          setSession(created);
          setUtterances([]);
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
  }, [requestedSessionId, router]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session?.id || session.ended_at) return;

    const timerId = window.setInterval(() => {
      void fetchSessionDetail(session.id)
        .then((detail) => {
          setSession(detail.session);
          setUtterances((current) =>
            mergeUtterances(current, detail.utterances).slice(
              -MAX_RENDERED_UTTERANCES,
            ),
          );
          setUtteranceTotal(detail.utterance_count);
          applyDialogueStartedAt(detail.session.dialogue_started_at);
        })
        .catch(() => {});
    }, REMOTE_MIC_SESSION_SYNC_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [session?.id, session?.ended_at]);

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
    void refreshAudioInputDevices();
  }, []);

  useEffect(() => {
    if (!session?.id || session.ended_at) {
      setRemoteMicStatuses({
        caregiver: { status: "not-issued" },
        elder: { status: "not-issued" },
      });
      return;
    }

    let ignore = false;

    async function refresh() {
      try {
        const status = await activateFixedRemoteMics(session.id);
        if (!ignore) {
          setRemoteMicStatuses(status.roles);
          applyDialogueStartedAt(status.dialogueStartedAt);
        }
      } catch {
        if (!ignore) {
          setRemoteMicStatuses({
            caregiver: { status: "disconnected" },
            elder: { status: "disconnected" },
          });
        }
      }
    }

    void refresh();
    const timerId = window.setInterval(() => {
      void refresh();
    }, REMOTE_MIC_STATUS_POLL_MS);

    return () => {
      ignore = true;
      window.clearInterval(timerId);
    };
  }, [session?.id, session?.ended_at]);

  useEffect(() => {
    if (!remoteMicrophoneConnected) return;

    stopVoiceAudioInput();
  }, [remoteMicrophoneConnected]);

  useEffect(() => {
    stopRemoteMicWebRtc();
  }, []);

  useEffect(() => {
    const service = createSingleMicInputService();
    const unsubscribeChunk = service.onChunk((chunk) => {
      void handleVoiceAudioChunk(chunk, "local_voice");
    });
    const unsubscribeLevel = service.onLevel((level) => {
      updateVoiceInputLevel(level);
    });

    voiceInputServiceRef.current = service;

    return () => {
      unsubscribeChunk();
      unsubscribeLevel();
      service.stopVoiceInput();
      voiceInputServiceRef.current = null;
    };
  }, []);

  useEffect(() => {
    ensureRemoteStreamInputService();

    return () => {
      remoteStreamInputSetupRef.current?.unsubscribeChunk();
      remoteStreamInputSetupRef.current?.unsubscribeLevel();
      remoteStreamInputSetupRef.current?.service.stopAllRemoteInputs();
      remoteStreamInputSetupRef.current = null;
      remoteStreamInputServiceRef.current = null;
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
    if (!session || currentTopicIndex !== 0 || topicStartedAt === null) return;
    if (completionState !== "active" || busyAction || transitionProposal) return;
    if (topicElapsedMs < topicBudgetMs) return;

    void forceAdvanceFromFirstTopic();
  }, [
    busyAction,
    completionState,
    currentTopicIndex,
    session,
    topicBudgetMs,
    topicElapsedMs,
    topicStartedAt,
    transitionProposal,
  ]);

  useEffect(() => {
    if (!session || topicStartedAt === null) return;
    if (completionState !== "active") return;
    if (busyAction || pushToTalkActive || transitionProposal) return;
    if (timerNow < proposalCooldownUntil) return;
    if (decisionPromptShownByTopic[currentTopicIndex]) return;

    const reason = getTransitionProposalReason({
      decisionTimeElapsed,
      maxTimeElapsed,
      isFirstTopic: currentTopicIndex === 0,
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
    setDecisionPromptShownByTopic((current) =>
      current.map((shown, index) =>
        index === currentTopicIndex ? true : shown,
      ),
    );
  }, [
    busyAction,
    completionState,
    currentTopic.slot_name,
    currentTopicIndex,
    decisionPromptShownByTopic,
    decisionTimeElapsed,
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
    setDraft("");
    setStatusText("保存中");

    try {
      const utterance = await addUtterance(session.id, speaker, text);
      setUtterances((current) =>
        [...current, utterance].slice(-MAX_RENDERED_UTTERANCES),
      );
      setUtteranceTotal((current) => current + 1);
      markSessionUsed(session.id);
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

    stopVoiceAudioInput();
    await startVoiceAudioInput(deviceId);
  }

  async function startVoiceAudioInput(deviceId = selectedAudioDeviceId) {
    if (!voiceInputServiceRef.current) return;

    setAudioInputError("");

    try {
      await voiceInputServiceRef.current.startVoiceInput({
        deviceId,
      });
      setAudioInputRunning(true);
    } catch (error) {
      console.warn("Voice audio input failed", error);
      setAudioInputRunning(false);
      setAudioInputError("音声入力を確認してください。");
    }
  }

  async function beginPushToTalk() {
    if (!sessionRef.current || busyAction === "start") return;
    if (remoteMicrophoneConnected) return;
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
      voiceInputServiceRef.current.startCapture(activeSpeaker);
      markTopicInteractionStarted("local_voice");
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

  function ensureRemoteStreamInputService() {
    if (remoteStreamInputSetupRef.current) {
      return remoteStreamInputSetupRef.current.service;
    }

    const service = createRemoteStreamInputService();
    const unsubscribeChunk = service.onChunk((chunk) => {
      console.info("[remote-mic pc chunk]", {
        speaker: chunk.speaker,
        size: chunk.blob.size,
        mimeType: chunk.mimeType,
        sequence: chunk.sequence,
        durationMs: chunk.endedAt - chunk.startedAt,
      });
      void handleVoiceAudioChunk(chunk, "remote_voice");
    });
    const unsubscribeLevel = service.onLevel((level) => {
      const normalizedLevel = Math.min(1, Math.max(level.rms * 8, level.peak));

      setAudioInputLevels((current) => ({
        ...current,
        [level.speaker]: normalizedLevel,
      }));
    });

    remoteStreamInputSetupRef.current = {
      service,
      unsubscribeChunk,
      unsubscribeLevel,
    };
    remoteStreamInputServiceRef.current = service;

    return service;
  }

  async function acceptRemoteMicWebRtcOffer(
    sessionId: string,
    offer: RemoteMicWebRtcOffer,
  ) {
    const peerConnection = new RTCPeerConnection();
    const speaker = toAudioSpeaker(offer.role);
    remoteMicPeerHandlesRef.current.set(offer.peerId, {
      peerConnection,
      role: offer.role,
    });

    peerConnection.ontrack = (event) => {
      let remoteInputStarted = false;
      const startRemoteInputFromTrack = () => {
        if (remoteInputStarted || event.track.readyState !== "live") return;

        remoteInputStarted = true;
        const stream = new MediaStream([event.track]);
        const remoteService = ensureRemoteStreamInputService();

        console.info("[remote-mic pc remote input attach]", {
          peerId: offer.peerId,
          role: offer.role,
          speaker,
          readyState: event.track.readyState,
          muted: event.track.muted,
        });

        void remoteService
          .startRemoteInput(speaker, stream)
          .then(() => {
            setAudioInputError("");
            setStatusText("スマートフォン音声入力中");
          })
          .catch((error) => {
            console.error("[remote-mic pc remote input failed]", {
              peerId: offer.peerId,
              role: offer.role,
              name: error instanceof Error ? error.name : "UnknownError",
              message: error instanceof Error ? error.message : String(error),
            });
            setAudioInputError("スマートフォン音声入力を開始できませんでした。");
          });
      };

      console.info("[remote-mic pc track received]", {
        peerId: offer.peerId,
        role: offer.role,
        kind: event.track.kind,
        readyState: event.track.readyState,
        muted: event.track.muted,
        streamCount: event.streams.length,
      });

      event.track.onunmute = () => {
        console.info("[remote-mic pc track unmuted]", {
          peerId: offer.peerId,
          role: offer.role,
          readyState: event.track.readyState,
        });
        startRemoteInputFromTrack();
      };
      event.track.onmute = () => {
        console.warn("[remote-mic pc track muted]", {
          peerId: offer.peerId,
          role: offer.role,
        });
      };
      event.track.onended = () => {
        console.warn("[remote-mic pc track ended]", {
          peerId: offer.peerId,
          role: offer.role,
        });
      };

      if (!event.track.muted) {
        startRemoteInputFromTrack();
      }
    };
    peerConnection.onconnectionstatechange = () => {
      console.info("[remote-mic pc connection state]", {
        peerId: offer.peerId,
        role: offer.role,
        connectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        iceGatheringState: peerConnection.iceGatheringState,
        signalingState: peerConnection.signalingState,
      });

      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed" ||
        peerConnection.connectionState === "disconnected"
      ) {
        remoteStreamInputServiceRef.current?.stopRemoteInput(speaker);
        remoteMicPeerHandlesRef.current.delete(offer.peerId);
      }
    };
    peerConnection.oniceconnectionstatechange = () => {
      console.info("[remote-mic pc ice state]", {
        peerId: offer.peerId,
        role: offer.role,
        iceConnectionState: peerConnection.iceConnectionState,
      });
    };
    peerConnection.onicecandidateerror = (event) => {
      console.warn("[remote-mic pc ice candidate error]", {
        peerId: offer.peerId,
        role: offer.role,
        errorCode: event.errorCode,
        errorText: event.errorText,
      });
    };

    await peerConnection.setRemoteDescription(offer.offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGatheringComplete(peerConnection);
    await postRemoteMicWebRtcAnswer(
      sessionId,
      offer.peerId,
      peerConnection.localDescription,
    );
  }

  function stopRemoteMicWebRtc() {
    for (const handle of remoteMicPeerHandlesRef.current.values()) {
      handle.peerConnection.close();
    }
    remoteMicPeerHandlesRef.current.clear();
    remoteStreamInputServiceRef.current?.stopAllRemoteInputs();
  }

  function updateVoiceInputLevel(level: SingleMicInputLevel) {
    const normalizedLevel = Math.min(1, Math.max(level.rms * 8, level.peak));
    const activeSpeaker = toAudioSpeaker(speakerRef.current);

    setAudioInputLevels({
      A: activeSpeaker === "A" ? normalizedLevel : 0,
      B: activeSpeaker === "B" ? normalizedLevel : 0,
    });
  }

  async function handleVoiceAudioChunk(
    chunk: SingleMicAudioChunk,
    source: Extract<TopicTimerStartSource, "local_voice" | "remote_voice">,
  ) {
    const currentSession = sessionRef.current;
    console.info("[remote-mic pc stt eligibility]", {
      hasSession: Boolean(currentSession),
      blobSize: chunk.blob.size,
      sttEnabled: sttEnabledRef.current,
      speaker: chunk.speaker,
    });

    if (!currentSession || chunk.blob.size < 512 || !sttEnabledRef.current) {
      console.warn("[remote-mic pc chunk skipped before stt]", {
        hasSession: Boolean(currentSession),
        blobSize: chunk.blob.size,
        sttEnabled: sttEnabledRef.current,
        speaker: chunk.speaker,
      });
      return;
    }

    try {
      setStatusText("スマートフォン音声を文字起こし中");
      console.info("[remote-mic pc stt request]", {
        speaker: chunk.speaker,
        blobSize: chunk.blob.size,
        mimeType: chunk.blob.type || chunk.mimeType,
        sequence: chunk.sequence,
      });
      const data = await sendAudioChunkToStt(
        currentSession.id,
        chunk.speaker,
        chunk.blob,
        chunk.mimeType,
        chunk.sequence,
        chunk.startedAt,
        chunk.endedAt,
      );

      console.info("[remote-mic pc stt result]", {
        speaker: chunk.speaker,
        skipped: Boolean(data.skipped),
        hasUtterance: Boolean(data.utterance),
        transcriptLength: data.transcript?.length ?? data.utterance?.text.length ?? 0,
      });

      if (!data.utterance) {
        setStatusText(data.skipped ? "音声区間をスキップ" : "発話なし");
        return;
      }

      markTopicInteractionStarted(source);
      setUtterances((current) =>
        [...current, data.utterance as Utterance]
          .sort(compareUtterancesByTime)
          .slice(-MAX_RENDERED_UTTERANCES),
      );
      setUtteranceTotal((current) => current + 1);
      markSessionUsed(currentSession.id);
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
      const updateResult = await postJson<UpdateSlotsResponse>("/api/ai/update-slots", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      setDeveloperSlotStates(updateResult.slot_states);
      if (updateResult.slot_control) {
        setDeveloperSlotControl(updateResult.slot_control);
      }

      if (buttonType === "next_question") {
        const action = decideConversationAction({
          intent: "advance_topic",
          currentTopicIndex,
          slotControl: updateResult.slot_control ?? developerSlotControl,
        });

        if (action.type === "complete_session") {
          showEndConfirmation(action.reason);
          return;
        }

        if (nextTopic) {
          advanceTopic();
          setPromptPanel(createTopicTransitionPrompt(nextTopic));
          return;
        }

        showEndConfirmation("最後のテーマまで提示済みです。");
        return;
      }

      if (buttonType === "switch_topic") {
        const action = decideConversationAction({
          intent: "generate_question",
          currentTopicIndex,
          slotControl: updateResult.slot_control ?? developerSlotControl,
        });

        if (action.type === "complete_session") {
          showEndConfirmation(action.reason);
          return;
        }

        if (action.type === "switch_topic" && nextTopic) {
          advanceTopic();
          setPromptPanel(createTopicTransitionPrompt(nextTopic));
          return;
        }

        const data = await postJson<NextQuestionResponse>("/api/ai/next-question", {
          session_id: session.id,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
        });
        setPromptPanel(createQuestionPromptPanel(data.suggestion, "AIからの質問"));
      }

      if (buttonType === "check_end") {
        const action = decideConversationAction({
          intent: "check_end",
          currentTopicIndex,
          slotControl: updateResult.slot_control ?? developerSlotControl,
        });

        if (action.type === "complete_session") {
          showEndConfirmation(action.reason);
          return;
        }

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
          setPromptPanel(createQuestionPromptPanel(
            questionData.suggestion,
            "全体としてもう少し確認",
          ));
        } else {
          showEndConfirmation(data.suggestion.reason || data.suggestion.message);
          return;
        }
      }

      if (buttonType === "update_slots") {
        const action = decideConversationAction({
          intent: "minutes",
          currentTopicIndex,
          slotControl: updateResult.slot_control ?? developerSlotControl,
        });

        if (action.type === "complete_session") {
          showEndConfirmation(action.reason);
          return;
        }

        const data = await postJson<FinalMinutesResponse>("/api/ai/final-minutes", {
          session_id: session.id,
          current_topic: currentTopic.slot_name,
          current_topic_title: currentTopic.title,
          finalize: false,
        });
        setSession(data.session);
        setFinalMinutes(data.final_minutes);

        const updatedPrompt = {
          title: "議事録生成",
          body: "現時点の議事録を生成して保存しました。",
          tone: "status",
        } satisfies PromptPanelState;

        setPromptPanel(updatedPrompt);
        schedulePromptRestore(updatedPrompt, promptToRestore);
      }

      if (!updateResult.slot_control) {
        await refreshDeveloperSlotStates(session.id);
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

    const confirmed = window.confirm("新しいセッションを開始しますか？未使用の自動作成IDは破棄されます。");
    if (!confirmed) return;

    stopVoiceAudioInput();
    setBusyAction("start");
    setStatusText("準備中");
    setPromptPanel(createOpeningPrompt());

    try {
      await discardUnusedSession(sessionRef.current?.id);
      const created = await startSession();
      window.localStorage.setItem(STORAGE_KEY, created.id);
      sessionRef.current = created;
      setSession(created);
      setUtterances([]);
      setUtteranceTotal(0);
      setDraft("");
      setDeveloperSlotStates([]);
      setDeveloperSlotControl(null);
      setDeveloperSlotError("");
      resetTopicTiming();
      setCompletionState("active");
      setFinalMinutes(null);
      setCompletionError("");
      setStatusText("保存済み");
      router.replace("/session");
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

    if (isRecallParticipantCode(nextId)) {
      await restoreSessionFromRecallCode(nextId);
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
      const displayMessage = message;
      setIdError(displayMessage);
      setStatusText("保存エラー");
      setPromptPanel({
        title: "参加者IDを保存できません",
        body: displayMessage,
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

  async function restoreSessionFromRecallCode(recallCode: string) {
    const sourceParticipantCode = recallCode.slice("tatsu_".length).trim();
    if (!sourceParticipantCode) {
      setIdError("tatsu_ の後ろに、呼び出したい以前のIDを入れてください。");
      return;
    }

    const confirmed = window.confirm(
      `${sourceParticipantCode} の過去ログを呼び出しますか？現在の自動作成セッションが未使用なら破棄します。`,
    );
    if (!confirmed) return;

    setBusyAction("id");
    setStatusText("過去ログ呼び出し中");
    setIdError("");

    try {
      const existing = await lookupSessionByParticipantCode(sourceParticipantCode);
      if (!existing) {
        throw new Error("source session not found");
      }

      await discardUnusedSession(session?.id);
      const restored = await fetchSessionDetail(existing.id);
      window.localStorage.removeItem(STORAGE_KEY);
      sessionRef.current = restored.session;
      setSession(restored.session);
      setUtterances(restored.utterances);
      setUtteranceTotal(restored.utterance_count);
      setDeveloperSlotStates([]);
      setDeveloperSlotControl(null);
      setDraft("");
      setIsEditingId(false);
      setIdDraft("");
      resetTopicTiming();
      applyDialogueStartedAt(restored.session.dialogue_started_at);
      setPromptPanel({
        title: "過去ログを呼び出しました",
        body: `${sourceParticipantCode} のログ ${restored.utterance_count} 件を開きました。`,
        tone: "status",
      });
      setStatusText("保存済み");
      router.replace(`/session?sessionId=${encodeURIComponent(restored.session.id)}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "";
      const message =
        errorMessage === "source session not found" ||
        errorMessage.includes("source session")
          ? "指定したIDの過去ログが見つかりませんでした。"
          : "過去ログを呼び出せませんでした。";
      const displayMessage = normalizeRecallErrorMessage(errorMessage || message);
      setIdError(displayMessage);
      setStatusText("保存エラー");
      setPromptPanel({
        title: "過去ログを呼び出せません",
        body: displayMessage,
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function isRecallParticipantCode(value: string) {
    return /^tatsu_.+/.test(value);
  }

  function normalizeRecallErrorMessage(errorMessage: string) {
    if (
      errorMessage === "source session not found" ||
      errorMessage.includes("source session")
    ) {
      return "指定したIDの過去ログが見つかりませんでした。tatsu_ の後ろには、既に存在するIDを入れてください。";
    }

    return errorMessage || "過去ログを呼び出せませんでした。";
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

    const proposalReason = transitionProposal?.reason;
    setTransitionProposal(null);

    if (isLastTopic) {
      if (proposalReason === "ready_to_end") {
        await completeSession();
      } else {
        await handleAction("check_end");
      }
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

  async function generateQuestionFromTransitionProposal() {
    if (!session || busyAction || completionState !== "active") return;

    const shouldForceQuestion = transitionProposal?.reason === "ready_to_end";
    setTransitionProposal(null);
    if (!shouldForceQuestion) {
      await handleAction("switch_topic");
      return;
    }

    setBusyAction("switch_topic");
    setStatusText("質問生成中");
    setPromptPanel(getPendingPrompt("switch_topic"));

    try {
      await postJson<UpdateSlotsResponse>("/api/ai/update-slots", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      const data = await postJson<NextQuestionResponse>("/api/ai/next-question", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      setPromptPanel({
        ...createQuestionPromptPanel(data.suggestion, "AIからの質問"),
      });
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

  function dismissTransitionProposal() {
    setTransitionProposal(null);
    setProposalCooldownUntil(Date.now() + PROPOSAL_COOLDOWN_MS);
  }

  function showEndConfirmation(reason: string) {
    setTransitionProposal({
      reason: "ready_to_end",
      suggestedAt: Date.now(),
      topicIndex: currentTopicIndex,
    });
    setPromptPanel({
      title: "全体終了確認",
      body: reason || "今日の話し合いを終了できる状態です。",
      tone: "end",
    });
    setStatusText("終了確認");
  }

  async function forceAdvanceFromFirstTopic() {
    if (!session || busyAction || !nextTopic) return;

    setTransitionProposal(null);
    setBusyAction("switch_topic");
    setStatusText("話題切替中");

    try {
      await postJson("/api/ai/update-slots", {
        session_id: session.id,
        current_topic: currentTopic.slot_name,
        current_topic_title: currentTopic.title,
      });
      advanceTopic();
      setPromptPanel(createTopicTransitionPrompt(nextTopic));
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
        finalize: true,
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
    setTopicTimerSource(null);
    setDecisionPromptShownByTopic(DISCUSSION_TOPICS.map(() => false));
    setTransitionProposal(null);
    setProposalCooldownUntil(0);
    setCompletionState("active");
    setCompletionError("");
    setFinalMinutes(null);
    setTopicStartedAt(null);
    setTimerNow(now);
  }

  function applyDialogueStartedAt(value: string | null) {
    if (!value) return;
  }

  function markTopicInteractionStarted(source: TopicTimerStartSource) {
    if (!sessionRef.current || topicStartedAtRef.current !== null) return;

    const now = Date.now();
    topicStartedAtRef.current = now;
    timerPausedStartedAtRef.current = null;
    timerRunningRef.current = true;
    setTopicPausedMs(0);
    setTopicTimerSource(source);
    setTopicStartedAt(now);
    setTimerNow(now);
  }

  function advanceTopic() {
    if (!nextTopic) return;

    setCurrentTopicIndex((current) =>
      Math.min(current + 1, DISCUSSION_TOPICS.length - 1),
    );
    setTopicBudgets((current) =>
      calculateDistributedTopicBudgets(
        current,
        currentTopicIndex,
        topicBudgetMs,
        topicElapsedMs,
      ),
    );
    topicStartedAtRef.current = null;
    timerPausedStartedAtRef.current = null;
    timerRunningRef.current = false;
    setTopicPausedMs(0);
    setTopicStartedAt(null);
    setTopicTimerSource(null);
    setTransitionProposal(null);
    setProposalCooldownUntil(0);
    setTimerNow(Date.now());
  }

  if (completionState === "completed" || completionState === "failed") {
    return (
      <main className="min-h-dvh bg-[#f7f8f4] px-4 py-6 text-stone-950">
        <section className="mx-auto w-full max-w-3xl">
          <SessionCompletionPanel
            state={completionState}
            finalMinutes={finalMinutes}
            error={completionError}
            participantCode={participantCode}
            sessionId={session?.id ?? ""}
            onRetry={() => void completeSession()}
          />
        </section>
      </main>
    );
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
              disabled={Boolean(busyAction) || completionState !== "active"}
              onAccept={() => void acceptTransitionProposal()}
              onGenerateQuestion={() => void generateQuestionFromTransitionProposal()}
              onDismiss={dismissTransitionProposal}
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

            <form onSubmit={handleSubmit}>
              {audioInputError ? (
                <p className="mb-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] font-bold text-red-700">
                  {audioInputError}
                </p>
              ) : null}
              {remoteMicrophoneConnected ? (
                <p className="mb-2 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-bold text-emerald-800">
                  スマートフォンマイク接続中です。PCローカルマイクは停止しています。
                </p>
              ) : null}
              <div className="mb-2">
                <select
                  value={selectedAudioDeviceId}
                  onChange={(event) => {
                    void handleAudioDeviceChange(event.target.value);
                  }}
                  disabled={audioInputLoading || remoteMicrophoneConnected}
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
                {remoteMicrophoneConnected
                  ? "本人用・介護者用スマートフォンの音声を自動で文字起こしします。"
                  : pushToTalkActive
                  ? "録音中です。Spaceを離すと自動で追加されます。"
                  : "Spaceを押している間だけ、選択中の話者として録音します。手入力欄ではSpaceは通常入力・変換に使えます。"}
              </p>
              <div className="mt-2 flex gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => {
                    const nextDraft = event.target.value;

                    if (!draft && nextDraft.trim()) {
                      markTopicInteractionStarted("text");
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
            <RemoteMicrophonePanel
              sessionId={session?.id ?? ""}
              statuses={remoteMicStatuses}
            />

            <DeveloperDialogueTopics
              slotStates={developerSlotStates}
              slotControl={developerSlotControl}
              currentTopic={currentTopic.slot_name}
              timerDebug={{
                started: topicStartedAt !== null,
                source: topicTimerSource,
                budgetMs: topicBudgetMs,
                elapsedMs: topicElapsedMs,
                decisionAtMs,
                carryToNextTopicMs,
              }}
              loading={developerSlotLoading}
              error={developerSlotError}
              onRefresh={() => {
                void handleAction("update_slots");
              }}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ActionButton
                label="次の話題へ"
                tone="emerald"
                busy={busyAction === "next_question"}
                disabled={!session || Boolean(busyAction)}
                onClick={() => handleAction("next_question")}
              />
              <ActionButton
                label="質問生成"
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
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SessionPageLoading() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-6xl rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[13px] font-black text-stone-600">
          セッションを準備しています
        </div>
      </section>
    </main>
  );
}

function RemoteMicrophonePanel(props: {
  sessionId: string;
  statuses: Record<SpeakerRole, RemoteMicRoleStatus>;
}) {
  return (
    <aside className="rounded-md border border-stone-300 bg-white p-3 shadow-sm">
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.08em] text-stone-500">
          Fixed Mic
        </div>
        <h2 className="mt-0.5 text-[14px] font-black leading-tight">
          スマートフォンマイク
        </h2>
      </div>

      <div className="mt-3 space-y-3">
        <RemoteMicrophoneStatus
          label="介護者マイク"
          role="caregiver"
          roleStatus={props.statuses.caregiver}
        />
        <RemoteMicrophoneStatus
          label="本人マイク"
          role="elder"
          roleStatus={props.statuses.elder}
        />
      </div>
    </aside>
  );
}

function RemoteMicrophoneStatus(props: {
  label: string;
  role: SpeakerRole;
  roleStatus: RemoteMicRoleStatus;
}) {
  const connected = props.roleStatus.status === "connected";
  const waiting = props.roleStatus.status === "waiting";
  const status = remoteMicStatusLabel(props.roleStatus.status);

  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-black text-stone-900">
          {props.label}
        </div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            connected
              ? "bg-emerald-100 text-emerald-900"
              : waiting
                ? "bg-amber-100 text-amber-900"
                : "bg-stone-200 text-stone-600"
          }`}
        >
          {status}
        </div>
      </div>
      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-stone-500">
          <span>{props.roleStatus.transmitting ? "送信中" : "ミュート"}</span>
          <span>{props.roleStatus.lastHeartbeatAt ? formatDateTime(props.roleStatus.lastHeartbeatAt) : "-"}</span>
        </div>
      </div>
    </div>
  );
}

function remoteMicStatusLabel(status: RemoteMicConnectionStatus) {
  switch (status) {
    case "waiting":
      return "QR待機中";
    case "connected":
      return "接続済み";
    case "disconnected":
      return "切断";
    case "expired":
      return "期限切れ";
    case "revoked":
      return "解除済み";
    case "not-issued":
    default:
      return "未発行";
  }
}

async function fetchRemoteMicStatus(sessionId: string) {
  const params = new URLSearchParams({ sessionId });
  const response = await fetch(`/api/remote-mic/status?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Remote microphone status failed: ${response.status}`);
  }

  return (await response.json()) as RemoteMicStatusResponse;
}

async function activateFixedRemoteMics(sessionId: string) {
  const response = await fetch("/api/remote-mic/fixed/active", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error(`Fixed remote microphone activation failed: ${response.status}`);
  }

  const data = (await response.json()) as FixedRemoteMicActiveResponse;
  const now = Date.now();

  return {
    dialogueStartedAt: data.active.dialogueStartedAt,
    roles: {
      elder: toFixedRemoteMicStatus(data.active.roles.elder, now),
      caregiver: toFixedRemoteMicStatus(data.active.roles.caregiver, now),
    },
  };
}

function toFixedRemoteMicStatus(
  roleState: FixedRemoteMicActiveResponse["active"]["roles"][SpeakerRole],
  now: number,
): RemoteMicRoleStatus {
  const connected =
    roleState.lastSeenAt !== null && now - roleState.lastSeenAt <= 45_000;

  return {
    status: connected ? "connected" : "disconnected",
    lastHeartbeatAt: roleState.lastSeenAt
      ? new Date(roleState.lastSeenAt).toISOString()
      : null,
    muted: roleState.muted,
    transmitting: roleState.transmitting,
  };
}

async function fetchRemoteMicWebRtcOffers(sessionId: string) {
  const params = new URLSearchParams({ sessionId });
  const response = await fetch(
    `/api/remote-mic/webrtc/offers?${params.toString()}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    throw new Error(`Remote microphone WebRTC offers failed: ${response.status}`);
  }

  const data = (await response.json()) as { offers: RemoteMicWebRtcOffer[] };

  return data.offers;
}

async function postRemoteMicWebRtcAnswer(
  sessionId: string,
  peerId: string,
  answer: RTCSessionDescriptionInit | null,
) {
  const response = await fetch("/api/remote-mic/webrtc/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, peerId, answer }),
  });

  if (!response.ok) {
    throw new Error(`Remote microphone WebRTC answer failed: ${response.status}`);
  }
}

function LevelBar(props: { value: number; tone: "emerald" | "sky" }) {
  const width = `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div
        className={`h-full ${props.tone === "sky" ? "bg-sky-600" : "bg-emerald-600"}`}
        style={{ width }}
      />
    </div>
  );
}

function DeveloperDialogueTopics(props: {
  slotStates: SlotState[];
  slotControl: SlotControlDebugState | null;
  currentTopic: string;
  timerDebug: {
    started: boolean;
    source: TopicTimerStartSource | null;
    budgetMs: number;
    elapsedMs: number;
    decisionAtMs: number;
    carryToNextTopicMs: number;
  };
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
          <div>Timer: {props.timerDebug.started ? "started" : "not started"}</div>
          <div>Timer source: {props.timerDebug.source ?? "-"}</div>
          <div>Current budget: {formatTimerSeconds(Math.floor(props.timerDebug.budgetMs / 1000))}</div>
          <div>Elapsed: {formatTimerSeconds(Math.floor(props.timerDebug.elapsedMs / 1000))}</div>
          <div>Decision threshold: {formatTimerSeconds(Math.floor(props.timerDebug.decisionAtMs / 1000))}</div>
          <div>Carry to next topic: {formatTimerSeconds(Math.floor(props.timerDebug.carryToNextTopicMs / 1000))}</div>
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
          <div>
            LLM classification source: {slotControl.classificationDebug?.source ?? "-"}
          </div>
          <div>
            LLM succeeded: {slotControl.classificationDebug?.llmSucceeded ? "true" : "false"}
          </div>
          <div>Candidate count: {slotControl.classificationDebug?.candidateCount ?? slotControl.classificationDebug?.llmCandidateCount ?? "-"}</div>
          <div>Accepted count: {slotControl.classificationDebug?.acceptedCount ?? "-"}</div>
          <div>Rejected count: {slotControl.classificationDebug?.rejectedCount ?? "-"}</div>
          <div>
            Rejected reasons:{" "}
            {slotControl.classificationDebug?.rejectionReasons
              ? JSON.stringify(slotControl.classificationDebug.rejectionReasons)
              : "-"}
          </div>
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
  disabled: boolean;
  onAccept: () => void;
  onGenerateQuestion: () => void;
  onDismiss: () => void;
}) {
  const reasonLabel = proposalReasonLabel(props.reason);
  const isReadyToEnd = props.reason === "ready_to_end";

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-black text-amber-800">
            AIからの提案
          </div>
          <p className="mt-1 text-[15px] font-black leading-relaxed text-stone-950">
            {isReadyToEnd
              ? "話し合いを終了しますか、それとも話し合いを続けますか？"
              : props.isLastTopic
              ? "このテーマの話を続けますか、それとも全体終了確認へ進みますか？"
              : "このテーマの話を続けますか、それとも次の話題へ移りますか？"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-stone-600">
            <span className="rounded-full bg-white px-2 py-0.5">
              {reasonLabel}
            </span>
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
            {isReadyToEnd
              ? "話し合いを終了する"
              : props.isLastTopic
              ? "全体終了確認へ進む"
              : "次の話題へ進む"}
          </button>
          <button
            type="button"
            onClick={props.onGenerateQuestion}
            disabled={props.disabled}
            className="min-h-9 rounded-md border border-amber-300 bg-white px-3 text-[12px] font-black text-amber-900 disabled:text-stone-400"
          >
            {isReadyToEnd ? "質問を生成して続ける" : "質問を生成して、このテーマを続ける"}
          </button>
          <button
            type="button"
            onClick={props.onDismiss}
            disabled={props.disabled}
            className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 disabled:text-stone-400"
          >
            {isReadyToEnd ? "話し合いを続ける" : "今の質問のまま、このテーマを続ける"}
          </button>
        </div>
      </div>
    </section>
  );
}

function SessionCompletionPanel(props: {
  state: SessionCompletionState;
  finalMinutes: { id: string; markdown: string; json?: unknown; created_at: string } | null;
  error: string;
  participantCode: string;
  sessionId: string;
  onRetry: () => void;
}) {
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
    <section className="rounded-md border border-emerald-200 bg-white px-5 py-5 shadow-sm">
      <div className="text-[20px] font-black text-stone-950">話し合いが終了しました</div>
      <p className="mt-2 text-[14px] font-bold leading-relaxed text-stone-700">
        今回の話し合いから議事録を作成しました。議事録では、本人の考えだけでなく、背景・理由・迷い・条件・根拠となった発言を確認できます。
      </p>
      <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] font-bold text-stone-700">
        参加者ID: <span className="font-black text-stone-950">{props.participantCode}</span>
      </div>
      {props.finalMinutes ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`/minutes?sessionId=${encodeURIComponent(props.sessionId)}`}
            className="rounded-md bg-emerald-700 px-4 py-2 text-[13px] font-black text-white"
          >
            議事録を確認する
          </a>
          <button
            type="button"
            onClick={() => window.location.assign("/session")}
            className="rounded-md border border-stone-300 bg-white px-4 py-2 text-[13px] font-black text-stone-700"
          >
            新しい対話を開始する
          </button>
        </div>
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
          下の「質問生成」を押すと、ここに介護者が読み上げられる文が表示されます。「次の話題へ」では次テーマの話題提供に移ります。
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
      title: "次の話題へ",
      body: "現在のテーマを保存し、次の話題へ移動しています。",
      tone: "status",
    };
  }

  if (buttonType === "switch_topic") {
    return {
      title: "質問生成",
      body: "今聞く価値のある質問を生成しています。",
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
    title: "議事録生成",
    body: "会話ログから議事録を生成しています。",
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
  speaker: StereoSpeaker | Speaker,
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

  const data = (await response.json()) as TranscribeUtteranceResponse;

  console.info("[remote-mic pc stt response]", {
    status: response.status,
    ok: response.ok,
    skipped: Boolean(data.skipped),
    hasUtterance: Boolean(data.utterance),
    speaker: data.speaker,
  });

  return data;
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

function toAudioSpeaker(speaker: Speaker): StereoSpeaker {
  return speaker === "caregiver" ? "B" : "A";
}

function waitForIceGatheringComplete(peerConnection: RTCPeerConnection) {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timeoutId = window.setTimeout(resolve, 3000);

    peerConnection.addEventListener("icegatheringstatechange", () => {
      if (peerConnection.iceGatheringState !== "complete") return;

      window.clearTimeout(timeoutId);
      resolve();
    });
  });
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

async function startSession(): Promise<SessionInfo> {
  const data = await postJson<{ session: SessionInfo }>("/api/session/start", {
    condition: "mvp",
  });

  return data.session;
}

async function lookupSessionByParticipantCode(
  participantCode: string,
): Promise<SessionLookupResponse["session"]> {
  const response = await fetch(
    `/api/session/lookup?participant_code=${encodeURIComponent(participantCode)}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errorText =
      errorBody && typeof errorBody.error === "string"
        ? errorBody.error
        : "Failed to lookup session";

    throw new Error(toUserFacingError(errorText));
  }

  const data = (await response.json()) as SessionLookupResponse;

  return data.session;
}

async function discardUnusedSession(sessionId?: string | null) {
  if (!sessionId) return false;
  if (window.localStorage.getItem(STORAGE_KEY) !== sessionId) return false;

  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });

  if (!response.ok) return false;

  const data = (await response.json().catch(() => null)) as
    | { discarded?: boolean }
    | null;

  return data?.discarded === true;
}

function markSessionUsed(sessionId: string) {
  if (window.localStorage.getItem(STORAGE_KEY) === sessionId) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
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
      "Content-Type": "application/json; charset=utf-8",
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

function createQuestionPromptPanel(
  suggestion: NextQuestionResponse["suggestion"],
  title: string,
): PromptPanelState {
  const body = joinPrompt(suggestion.transition_phrase, suggestion.question);

  if (suggestion.no_relevant_followup || !body) {
    return {
      title: "追加質問なし",
      body: "今の話題では、直近のお話から自然につながる追加質問は見つかりませんでした。必要であれば「次の話題へ」で進めます。",
      tone: "status",
    };
  }

  return {
    title,
    body,
    tone: "question",
  };
}

function joinPrompt(transition: string, question: string | null) {
  if (!question) return "";
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

function mergeUtterances(current: Utterance[], incoming: Utterance[]) {
  const byId = new Map<string, Utterance>();

  for (const utterance of current) {
    byId.set(utterance.id, utterance);
  }
  for (const utterance of incoming) {
    byId.set(utterance.id, utterance);
  }

  return Array.from(byId.values()).sort(compareUtterancesByTime);
}

function getTransitionProposalReason(input: {
  decisionTimeElapsed: boolean;
  maxTimeElapsed: boolean;
  isFirstTopic: boolean;
  currentTopicSlot?: SlotState;
  utterances: Utterance[];
}): ProposalReason | null {
  if (input.isFirstTopic && input.maxTimeElapsed) return "max_time_elapsed";
  if (input.decisionTimeElapsed && isTerminalSlotStatus(input.currentTopicSlot?.status)) {
    return "core_slots_completed";
  }

  const latestText = input.utterances.at(-1)?.text ?? "";
  if (hasPreferNotToAnswer(latestText)) return "prefer_not_to_answer";
  if (hasNoMoreToAdd(latestText)) return "no_more_to_add";
  if (hasNotConsidered(latestText)) return "not_considered";
  if (input.decisionTimeElapsed) return "base_time_elapsed";

  return null;
}

function decideConversationAction(input: {
  intent: "advance_topic" | "generate_question" | "check_end" | "minutes";
  currentTopicIndex: number;
  slotControl: SlotControlDebugState | null;
}): ConversationAction {
  const allTopicsPresented = input.currentTopicIndex >= DISCUSSION_TOPICS.length - 1;
  const currentTopic = DISCUSSION_TOPICS[input.currentTopicIndex] ?? DISCUSSION_TOPICS[0];
  const currentMainSlot = input.slotControl?.mainSlots.find(
    (slot) => slot.topicId === currentTopic.id,
  );
  const currentCoreNeedsQuestion = (currentMainSlot?.subSlots ?? []).some(
    (slot) =>
      slot.priority === "core" &&
      slot.canAskAgain &&
      (slot.status === "unanswered" ||
        slot.status === "partially_answered" ||
        slot.status === "needs_follow_up" ||
        slot.status === "deferred"),
  );
  const anyCoreNeedsQuestion = input.slotControl?.mainSlots.some((mainSlot) =>
    mainSlot.subSlots.some(
      (slot) =>
        slot.priority === "core" &&
        slot.canAskAgain &&
        (slot.status === "unanswered" ||
          slot.status === "partially_answered" ||
          slot.status === "needs_follow_up" ||
          slot.status === "deferred"),
    ),
  ) ?? false;

  if (allTopicsPresented && !anyCoreNeedsQuestion) {
    return { type: "complete_session", reason: "6テーマ提示済みで重要なcore不足がありません。" };
  }

  if (input.intent === "check_end" || input.intent === "minutes") {
    return anyCoreNeedsQuestion
      ? { type: "generate_question", reason: "終了前に確認すべきcore項目があります。" }
      : { type: "complete_session", reason: "終了可能です。" };
  }

  if (input.intent === "advance_topic") {
    return allTopicsPresented
      ? { type: "complete_session", reason: "最後のテーマまで提示済みのため終了確認へ進みます。" }
      : { type: "switch_topic", reason: "次のテーマへ進みます。" };
  }

  if (input.intent === "generate_question") {
    return currentCoreNeedsQuestion
      ? { type: "generate_question", reason: "現在テーマに確認すべきcore項目があります。" }
      : { type: "generate_question", reason: "現在テーマをもう少し深める質問を生成します。" };
  }

  return { type: "generate_question", reason: "終了前に不足確認を行います。" };
}

function calculateTopicCarryMs(topicBudgetMs: number, topicElapsedMs: number) {
  return Math.max(0, topicBudgetMs - topicElapsedMs);
}

function calculateDistributedTopicBudgets(
  currentBudgets: number[],
  currentTopicIndex: number,
  topicBudgetMs: number,
  topicElapsedMs: number,
) {
  const remainingTopicCount = getRemainingTopicCount(currentTopicIndex);
  if (remainingTopicCount === 0) return currentBudgets;

  const carryPerTopicMs = calculateDistributedCarryPerTopicMs(
    currentTopicIndex,
    topicBudgetMs,
    topicElapsedMs,
  );

  return currentBudgets.map((budget, index) =>
    index > currentTopicIndex ? budget + carryPerTopicMs : budget,
  );
}

function calculateDistributedCarryPerTopicMs(
  currentTopicIndex: number,
  topicBudgetMs: number,
  topicElapsedMs: number,
) {
  const remainingTopicCount = getRemainingTopicCount(currentTopicIndex);
  if (remainingTopicCount === 0) return 0;

  return Math.floor(
    calculateTopicCarryMs(topicBudgetMs, topicElapsedMs) / remainingTopicCount,
  );
}

function getRemainingTopicCount(currentTopicIndex: number) {
  return Math.max(0, DISCUSSION_TOPICS.length - currentTopicIndex - 1);
}

function calculateTopicDecisionAtMs(topicBudgetMs: number) {
  return Math.floor(topicBudgetMs * DECISION_RATIO);
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
    ready_to_end: "終了可能",
  };

  return labels[reason];
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
    question: string | null;
    transition_phrase: string;
    no_relevant_followup?: boolean;
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
    reason?: string;
  };
};

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RemoteMicControlEvent,
  RemoteMicRealtimeEvent,
} from "../../lib/remote-mic/control-events";

type RemoteMicRole = "elder" | "caregiver";
type MicState = "idle" | "requesting" | "streaming";
type MicPhase =
  | "disconnected"
  | "connecting"
  | "listening"
  | "suppressing"
  | "suppressed"
  | "resuming"
  | "reconnecting"
  | "error"
  | "stopped";
type ReconnectReason =
  | "peer_failed"
  | "peer_closed"
  | "peer_disconnected_timeout"
  | "data_channel_closed"
  | "data_channel_error"
  | "track_ended"
  | "ai_speech_restore_failed";
type RemoteMicSession = {
  sessionId: string;
  role: RemoteMicRole;
  participantCode: string | null;
  dialogueStartedAt: string | null;
};
type AiSpeechEvent = RemoteMicControlEvent | {
  type?: "ai_speech_snapshot";
  sessionId?: string;
  playbackId?: string | null;
  activePlaybackId?: string | null;
  revision?: number;
  active?: boolean;
  sessionEnded?: boolean;
  releaseAfter?: string | null;
};
type RealtimeEvent = {
  type?: string;
  event_id?: string;
  item_id?: string;
  item?: { id?: string };
  delta?: string;
  transcript?: string;
};
type PendingFinalTranscript = {
  streamId: string;
  transcriptId: string;
  captureEpoch: number;
  text: string;
  startedAt?: string;
  endedAt?: string;
  finalizedAt?: string;
  firstPartialAt?: string;
  blockedAtCapture: boolean;
  aiPlaybackIdAtCapture?: string | null;
  saveAttempts: number;
};

const CLIENT_VERSION = "remote-mic-client-2026-09-04-openai-realtime";
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 15_000;
const AI_SPEECH_RELEASE_DELAY_MS = 500;
const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45_000;
const PARTIAL_BROADCAST_INTERVAL_MS = 75;
const FINAL_SAVE_RETRY_MS = 2000;
const FINAL_SAVE_TIMEOUT_MS = 5_000;
const MAX_FINAL_SAVE_RETRY_COUNT = 5;
const PEER_DISCONNECTED_GRACE_MS = 3_000;
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

export default function RemoteMicClient(props: {
  initialRole?: RemoteMicRole | null;
}) {
  const [remoteMic, setRemoteMic] = useState<RemoteMicSession | null>(null);
  const [fixedRole, setFixedRole] = useState<RemoteMicRole | null>(null);
  const [micState, setMicState] = useState<MicState>("idle");
  const [secureContext, setSecureContext] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const [webrtcSupported, setWebrtcSupported] = useState(false);
  const [permissionLabel, setPermissionLabel] = useState("未確認");
  const [serverLabel, setServerLabel] = useState("確認中");
  const [connectionLabel, setConnectionLabel] = useState("未接続");
  const [micPhase, setMicPhase] = useState<MicPhase>("disconnected");
  const [aiSpeechLabel, setAiSpeechLabel] = useState("通常受付");
  const [openUrlLabel, setOpenUrlLabel] = useState("確認中");
  const [browserLabel, setBrowserLabel] = useState("確認中");
  const [httpsUrl, setHttpsUrl] = useState("");
  const [helpText, setHelpText] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const levelStopRef = useRef<(() => void) | null>(null);
  const recordingActiveRef = useRef(false);
  const startInFlightRef = useRef(false);
  const remoteMicRef = useRef<RemoteMicSession | null>(null);
  const fixedRoleRef = useRef<RemoteMicRole | null>(null);
  const micStateRef = useRef<MicState>("idle");
  const streamIdRef = useRef("");
  const captureEpochRef = useRef(0);
  const realtimeModelRef = useRef("");
  const partialTextByTranscriptRef = useRef<Map<string, string>>(new Map());
  const speechStartedAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const firstDeltaAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const lastTranscriptActivityAtByTranscriptRef = useRef<Map<string, number>>(
    new Map(),
  );
  const streamIdByTranscriptRef = useRef<Map<string, string>>(new Map());
  const captureEpochByTranscriptRef = useRef<Map<string, number>>(new Map());
  const blockedAtCaptureByTranscriptRef = useRef<Map<string, boolean>>(new Map());
  const aiPlaybackIdAtCaptureByTranscriptRef = useRef<
    Map<string, string | null>
  >(new Map());
  const revisionByTranscriptRef = useRef<Map<string, number>>(new Map());
  const lastBroadcastByTranscriptRef = useRef<
    Map<string, { revision: number; text: string }>
  >(new Map());
  const partialBroadcastTimersRef = useRef<Map<string, number>>(new Map());
  const pendingFinalByTranscriptRef = useRef<Map<string, PendingFinalTranscript>>(
    new Map(),
  );
  const aiSpeechReleaseTimerRef = useRef<number | null>(null);
  const aiSpeechSafetyTimerRef = useRef<number | null>(null);
  const resumeAfterAiSpeechRef = useRef(false);
  const captureBlockedRef = useRef(false);
  const manuallyStoppedRef = useRef(false);
  const fullyStoppedRef = useRef(false);
  const sessionEndedRef = useRef(false);
  const reconnectInFlightRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const peerDisconnectedTimerRef = useRef<number | null>(null);
  const connectionGenerationRef = useRef(0);
  const micPhaseRef = useRef<MicPhase>("disconnected");
  const aiSpeechStateRef = useRef({
    active: false,
    playbackId: null as string | null,
    revision: 0,
    releaseUntil: 0,
  });

  const roleLabel = useMemo(() => {
    if (remoteMic?.role === "elder") return "本人用マイク";
    if (remoteMic?.role === "caregiver") return "介護者用マイク";
    return "スマートフォンマイク";
  }, [remoteMic?.role]);
  const canStart = Boolean(remoteMic) && micState === "idle";

  useEffect(() => {
    remoteMicRef.current = remoteMic;
  }, [remoteMic]);

  useEffect(() => {
    fixedRoleRef.current = fixedRole;
  }, [fixedRole]);

  useEffect(() => {
    micStateRef.current = micState;
  }, [micState]);

  useEffect(() => {
    micPhaseRef.current = micPhase;
  }, [micPhase]);

  useEffect(() => {
    const nextSecureContext = window.isSecureContext;
    const nextMediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);
    const nextWebrtcSupported = typeof RTCPeerConnection !== "undefined";

    setSecureContext(nextSecureContext);
    setMediaSupported(nextMediaSupported);
    setWebrtcSupported(nextWebrtcSupported);
    setOpenUrlLabel(`${window.location.protocol}//${window.location.host}`);
    setBrowserLabel(getBrowserLabel(navigator.userAgent));
    console.info("[remote-mic client]", { version: CLIENT_VERSION });

    const maybeHttpsUrl = getHttpsUrl(window.location.href);
    setHttpsUrl(maybeHttpsUrl);
    if (!isHttpsTsNetUrl(window.location.href)) {
      setHelpText(getInsecureContextHelp());
      if (maybeHttpsUrl) {
        window.setTimeout(() => window.location.replace(maybeHttpsUrl), 800);
      }
    } else if (!nextMediaSupported || !nextWebrtcSupported) {
      setHelpText(
        "このブラウザではRealtime音声入力を利用できません。ChromeまたはSafariで固定マイクURLを開いてください。",
      );
    }

    const role = getFixedRemoteMicRole(props.initialRole ?? null);
    setFixedRole(role);
    void loadActiveSession(role);

    return () => {
      void stop(false);
    };
  }, [props.initialRole]);

  useEffect(() => {
    if (!fixedRole || micState === "streaming") return;

    const timerId = window.setInterval(() => {
      void loadActiveSession(fixedRole, { quiet: true });
    }, 3000);

    return () => window.clearInterval(timerId);
  }, [fixedRole, micState]);

  useEffect(() => {
    if (!remoteMic?.sessionId) return;

    const source = new EventSource(
      `/api/ai/speech-state/stream?sessionId=${encodeURIComponent(remoteMic.sessionId)}`,
    );
    source.onmessage = (event) => {
      try {
        handleAiSpeechEvent(JSON.parse(event.data) as AiSpeechEvent);
      } catch {}
    };
    source.onerror = () => {
      setAiSpeechLabel("AI音声状態を再接続中");
      setServerLabel("制御通信再接続中");
    };

    return () => {
      source.close();
    };
  }, [remoteMic?.sessionId]);

  useEffect(() => {
    if (!remoteMic || micState !== "streaming") return;

    const timerId = window.setInterval(() => {
      if (!fixedRole) return;

      void fetchCurrentSession(fixedRole)
        .then((data) => {
          if (
            !data.active ||
            data.active.sessionId !== remoteMic.sessionId ||
            data.active.participantCode !== remoteMic.participantCode ||
            data.active.endedAt
          ) {
            sessionEndedRef.current = true;
            fullyStoppedRef.current = true;
            void stop(false);
            setRemoteMic(null);
            setServerLabel("PC待機中");
            return;
          }

          setRemoteMic((current) =>
            current
              ? {
                  ...current,
                  dialogueStartedAt: data.active?.dialogueStartedAt ?? null,
                }
              : current,
          );
        })
        .catch(() => {
          setServerLabel("通信が不安定です");
        });
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [fixedRole, remoteMic, micState]);

  function handleAiSpeechEvent(event: AiSpeechEvent) {
    if (!remoteMicRef.current?.sessionId || event.sessionId !== remoteMicRef.current.sessionId) {
      return;
    }

    const revision =
      "revision" in event && typeof event.revision === "number"
        ? event.revision
        : 0;
    if (revision < aiSpeechStateRef.current.revision) return;

    if (event.type === "ai_speech_snapshot") {
      applyAiSpeechSnapshot(event, revision);
      return;
    }

    if (event.type === "transcript.flush_request") {
      void flushPendingFinalTranscriptsForRequest(event.requestId);
      return;
    }

    if (event.type === "speech.prepare" && event.playbackId) {
      pauseCaptureForAiSpeech(event.playbackId, revision);
      return;
    }

    if (
      (event.type === "speech.ended" || event.type === "speech.cancelled") &&
      event.playbackId === aiSpeechStateRef.current.playbackId
    ) {
      const releaseUntil = event.releaseAfter
        ? new Date(event.releaseAfter).getTime()
        : Date.now() + AI_SPEECH_RELEASE_DELAY_MS;
      releaseCaptureAfterAiSpeech(revision, releaseUntil);
    }
  }

  function applyAiSpeechSnapshot(
    event: Extract<AiSpeechEvent, { type?: "ai_speech_snapshot" }>,
    revision: number,
  ) {
    sessionEndedRef.current = Boolean(event.sessionEnded);
    if (event.sessionEnded) {
      fullyStoppedRef.current = true;
      void stop(false);
      return;
    }

    const releaseUntil = event.releaseAfter
      ? new Date(event.releaseAfter).getTime()
      : 0;
    const shouldSuppress =
      event.active === true ||
      (Number.isFinite(releaseUntil) && Date.now() <= releaseUntil);

    aiSpeechStateRef.current = {
      active: Boolean(event.active),
      playbackId: event.playbackId ?? event.activePlaybackId ?? null,
      revision,
      releaseUntil: releaseUntil || 0,
    };

    if (shouldSuppress) {
      captureBlockedRef.current = true;
      muteLocalAudioTracks();
      setMicPhaseValue("suppressed");
      setAiSpeechLabel("AI音声中のため一時ミュート");
    }
  }

  function setMicPhaseValue(nextPhase: MicPhase) {
    micPhaseRef.current = nextPhase;
    setMicPhase(nextPhase);
  }

  function clearReconnectTimers() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (peerDisconnectedTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectedTimerRef.current);
      peerDisconnectedTimerRef.current = null;
    }
  }

  function pauseCaptureForAiSpeech(playbackId: string, revision: number) {
    if (
      aiSpeechStateRef.current.active &&
      aiSpeechStateRef.current.playbackId &&
      aiSpeechStateRef.current.playbackId !== playbackId &&
      revision <= aiSpeechStateRef.current.revision
    ) {
      return;
    }

    resumeAfterAiSpeechRef.current = recordingActiveRef.current || startInFlightRef.current;
    captureEpochRef.current += 1;
    captureBlockedRef.current = true;
    setMicPhaseValue("suppressing");
    aiSpeechStateRef.current = {
      active: true,
      playbackId,
      revision,
      releaseUntil: 0,
    };
    setAiSpeechLabel("AI音声中のため一時ミュート");
    muteLocalAudioTracks();
    void publishMicControlAck("mic.suppressed", playbackId, revision, areAudioTracksSuppressed());
    void setFixedMicMuted(true).catch(() => undefined);
    setMicPhaseValue("suppressed");

    if (aiSpeechSafetyTimerRef.current !== null) {
      window.clearTimeout(aiSpeechSafetyTimerRef.current);
    }
    aiSpeechSafetyTimerRef.current = window.setTimeout(() => {
      releaseCaptureAfterAiSpeech(revision + 1, Date.now());
    }, AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS);
  }

  function releaseCaptureAfterAiSpeech(revision: number, releaseUntil: number) {
    if (aiSpeechReleaseTimerRef.current !== null) {
      window.clearTimeout(aiSpeechReleaseTimerRef.current);
    }
    if (aiSpeechSafetyTimerRef.current !== null) {
      window.clearTimeout(aiSpeechSafetyTimerRef.current);
      aiSpeechSafetyTimerRef.current = null;
    }

    const delayMs = Math.max(0, releaseUntil - Date.now());
    aiSpeechStateRef.current = {
      ...aiSpeechStateRef.current,
      active: true,
      revision,
      releaseUntil,
    };
    aiSpeechReleaseTimerRef.current = window.setTimeout(() => {
      aiSpeechReleaseTimerRef.current = null;
      const playbackId = aiSpeechStateRef.current.playbackId;
      aiSpeechStateRef.current = {
        active: false,
        playbackId: null,
        revision,
        releaseUntil: 0,
      };
      setAiSpeechLabel("通常受付");
      setMicPhaseValue("resuming");

      const shouldResume =
        resumeAfterAiSpeechRef.current &&
        !manuallyStoppedRef.current &&
        Boolean(remoteMicRef.current);
      resumeAfterAiSpeechRef.current = false;

      if (!shouldResume) {
        captureBlockedRef.current = false;
        setMicPhaseValue(fullyStoppedRef.current ? "stopped" : "disconnected");
        return;
      }

      if (restoreLocalAudioCapture()) {
        captureEpochRef.current += 1;
        captureBlockedRef.current = false;
        setMicPhaseValue("listening");
        setServerLabel("文字起こし中");
        if (playbackId) {
          void publishMicControlAck("mic.resumed", playbackId, revision, true);
        }
        void setFixedMicMuted(false).catch(() => undefined);
        return;
      }

      captureBlockedRef.current = false;
      if (playbackId) {
        void publishMicControlAck("mic.resumed", playbackId, revision, false);
      }
      void reconnectRealtime("ai_speech_restore_failed");
    }, delayMs);
  }

  function isAiSpeechBlockingCapture() {
    const state = aiSpeechStateRef.current;
    return captureBlockedRef.current || state.active || Date.now() <= state.releaseUntil;
  }

  function muteLocalAudioTracks() {
    for (const track of streamRef.current?.getAudioTracks() ?? []) {
      track.enabled = false;
    }
  }

  function areAudioTracksSuppressed() {
    const audioTracks = streamRef.current?.getAudioTracks() ?? [];

    return (
      audioTracks.length > 0 &&
      audioTracks.every(
        (track) => track.readyState === "live" && track.enabled === false,
      )
    );
  }

  function restoreLocalAudioCapture() {
    const stream = streamRef.current;
    const audioTracks = stream?.getAudioTracks() ?? [];
    const peerConnection = peerConnectionRef.current;
    const dataChannel = dataChannelRef.current;

    if (!stream || audioTracks.length === 0) return false;
    if (audioTracks.some((track) => track.readyState !== "live")) return false;
    if (
      !peerConnection ||
      peerConnection.connectionState === "failed" ||
      peerConnection.connectionState === "closed"
    ) {
      return false;
    }
    if (!dataChannel || dataChannel.readyState === "closed") return false;

    for (const track of audioTracks) {
      track.enabled = true;
    }

    return true;
  }

  async function reconnectRealtime(reason: ReconnectReason) {
    if (!shouldAttemptReconnect()) return;
    if (reconnectInFlightRef.current) return;

    const targetRemoteMic = remoteMicRef.current;
    if (!targetRemoteMic) return;

    reconnectInFlightRef.current = true;
    const attempt = reconnectAttemptRef.current + 1;
    reconnectAttemptRef.current = attempt;
    const previousStreamId = streamIdRef.current;

    if (attempt > RECONNECT_BACKOFF_MS.length) {
      reconnectInFlightRef.current = false;
      setMicPhaseValue("error");
      setConnectionLabel("手動確認が必要です");
      setError("Realtime接続を復旧できませんでした。スマートフォンの通信状態を確認してください。");
      void publishRemoteMicRealtimeEvent({
        type: "mic.reconnect_failed",
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        attempts: attempt - 1,
        reason,
      }).catch(() => undefined);
      return;
    }

    setMicPhaseValue("reconnecting");
    setConnectionLabel(`再接続中 (${attempt}/5)`);
    void publishRemoteMicRealtimeEvent({
      type: "mic.reconnecting",
      sessionId: targetRemoteMic.sessionId,
      role: targetRemoteMic.role,
      previousStreamId,
      attempt,
      reason,
    }).catch(() => undefined);
    discardLiveTranscripts("connection_lost");
    clearTranscriptState();

    const delayMs = getReconnectDelayMs(attempt);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void runReconnect(targetRemoteMic, reason);
    }, delayMs);
  }

  async function runReconnect(targetRemoteMic: RemoteMicSession, reason: ReconnectReason) {
    try {
      connectionGenerationRef.current += 1;
      closeRealtimeTransport(false);
      await openRealtimeConnection(targetRemoteMic, {
        reconnecting: true,
        reuseLiveStream: true,
      });
      const phase = await applyLatestAiSpeechSnapshotAfterReconnect();
      recordingActiveRef.current = true;
      reconnectAttemptRef.current = 0;
      setMicState("streaming");
      setConnectionLabel("接続済み");
      setServerLabel(phase === "suppressed" ? "AI音声中のため一時ミュート" : "文字起こし中");
      void publishRemoteMicRealtimeEvent({
        type: "mic.reconnected",
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        streamId: streamIdRef.current,
        micPhase: phase,
      }).catch(() => undefined);
    } catch (error) {
      console.warn("[remote-mic reconnect failed]", {
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        reason,
        attempt: reconnectAttemptRef.current,
        error,
      });
      reconnectInFlightRef.current = false;
      if (isPermissionError(error)) {
        setPermissionLabel("拒否");
        setMicPhaseValue("error");
        setConnectionLabel("権限確認が必要です");
        setError(error instanceof Error ? error.message : "マイク権限を確認してください。");
        void publishRemoteMicRealtimeEvent({
          type: "mic.reconnect_failed",
          sessionId: targetRemoteMic.sessionId,
          role: targetRemoteMic.role,
          attempts: reconnectAttemptRef.current,
          reason,
        }).catch(() => undefined);
        return;
      }
      void reconnectRealtime(reason);
      return;
    }

    reconnectInFlightRef.current = false;
  }

  function handlePeerConnectionStateChange(state: RTCPeerConnectionState) {
    if (state === "connected") {
      if (peerDisconnectedTimerRef.current !== null) {
        window.clearTimeout(peerDisconnectedTimerRef.current);
        peerDisconnectedTimerRef.current = null;
      }
      setConnectionLabel("接続済み");
      return;
    }

    if (state === "failed") {
      void reconnectRealtime("peer_failed");
      return;
    }

    if (state === "closed") {
      if (!fullyStoppedRef.current && !sessionEndedRef.current) {
        void reconnectRealtime("peer_closed");
      }
      return;
    }

    if (state === "disconnected") {
      setConnectionLabel("通信確認中");
      if (peerDisconnectedTimerRef.current !== null) return;
      peerDisconnectedTimerRef.current = window.setTimeout(() => {
        peerDisconnectedTimerRef.current = null;
        const peerConnection = peerConnectionRef.current;
        if (
          peerConnection?.connectionState === "disconnected" ||
          peerConnection?.connectionState === "failed"
        ) {
          void reconnectRealtime("peer_disconnected_timeout");
        }
      }, PEER_DISCONNECTED_GRACE_MS);
    }
  }

  function shouldAttemptReconnect() {
    return Boolean(
      remoteMicRef.current &&
        !fullyStoppedRef.current &&
        !manuallyStoppedRef.current &&
        !sessionEndedRef.current &&
        (recordingActiveRef.current || micPhaseRef.current === "reconnecting"),
    );
  }

  function isCurrentConnection(generation: number, streamId: string) {
    return (
      connectionGenerationRef.current === generation &&
      streamIdRef.current === streamId &&
      !fullyStoppedRef.current
    );
  }

  function getReconnectDelayMs(attempt: number) {
    const baseDelay = RECONNECT_BACKOFF_MS[Math.min(attempt - 1, RECONNECT_BACKOFF_MS.length - 1)];
    return Math.round(baseDelay * (0.8 + Math.random() * 0.4));
  }

  async function applyLatestAiSpeechSnapshotAfterReconnect(): Promise<"listening" | "suppressed"> {
    const current = remoteMicRef.current;
    if (!current) {
      captureBlockedRef.current = true;
      setMicPhaseValue("suppressed");
      muteLocalAudioTracks();
      return "suppressed";
    }

    try {
      const response = await fetch(
        `/api/ai/speech-state?sessionId=${encodeURIComponent(current.sessionId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(`speech state failed: ${response.status}`);
      const data = (await response.json()) as {
        state?: {
          active?: boolean;
          playbackId?: string | null;
          revision?: number | null;
          releaseAfter?: string | null;
        } | null;
      };
      const state = data.state ?? null;
      const releaseAfterMs = state?.releaseAfter
        ? new Date(state.releaseAfter).getTime()
        : 0;
      const shouldSuppress =
        state?.active === true ||
        (Number.isFinite(releaseAfterMs) && Date.now() <= releaseAfterMs);

      if (state?.playbackId) {
        aiSpeechStateRef.current = {
          active: Boolean(state.active),
          playbackId: state.playbackId,
          revision: state.revision ?? aiSpeechStateRef.current.revision,
          releaseUntil: releaseAfterMs || 0,
        };
      }

      if (shouldSuppress) {
        captureBlockedRef.current = true;
        muteLocalAudioTracks();
        setMicPhaseValue("suppressed");
        return "suppressed";
      }

      captureBlockedRef.current = false;
      restoreAudioTracksWithoutConnectionCheck();
      setMicPhaseValue("listening");
      return "listening";
    } catch (error) {
      console.warn("[remote-mic speech state snapshot failed]", error);
      captureBlockedRef.current = true;
      muteLocalAudioTracks();
      setMicPhaseValue("suppressed");
      return "suppressed";
    }
  }

  function restoreAudioTracksWithoutConnectionCheck() {
    for (const track of streamRef.current?.getAudioTracks() ?? []) {
      if (track.readyState === "live") {
        track.enabled = true;
      }
    }
  }

  function closeRealtimeTransport(stopTracks: boolean) {
    if (peerDisconnectedTimerRef.current !== null) {
      window.clearTimeout(peerDisconnectedTimerRef.current);
      peerDisconnectedTimerRef.current = null;
    }

    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    if (!stopTracks) return;

    levelStopRef.current?.();
    levelStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.enabled = false;
      track.stop();
    });
    streamRef.current = null;
  }

  function clearTranscriptState(transcriptId?: string) {
    if (transcriptId) {
      clearPartialBroadcastTimer(transcriptId);
      partialTextByTranscriptRef.current.delete(transcriptId);
      speechStartedAtByTranscriptRef.current.delete(transcriptId);
      firstDeltaAtByTranscriptRef.current.delete(transcriptId);
      lastTranscriptActivityAtByTranscriptRef.current.delete(transcriptId);
      streamIdByTranscriptRef.current.delete(transcriptId);
      captureEpochByTranscriptRef.current.delete(transcriptId);
      blockedAtCaptureByTranscriptRef.current.delete(transcriptId);
      aiPlaybackIdAtCaptureByTranscriptRef.current.delete(transcriptId);
      revisionByTranscriptRef.current.delete(transcriptId);
      lastBroadcastByTranscriptRef.current.delete(transcriptId);
      return;
    }

    for (const timerId of partialBroadcastTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    partialBroadcastTimersRef.current.clear();
    partialTextByTranscriptRef.current.clear();
    speechStartedAtByTranscriptRef.current.clear();
    firstDeltaAtByTranscriptRef.current.clear();
    lastTranscriptActivityAtByTranscriptRef.current.clear();
    streamIdByTranscriptRef.current.clear();
    captureEpochByTranscriptRef.current.clear();
    blockedAtCaptureByTranscriptRef.current.clear();
    aiPlaybackIdAtCaptureByTranscriptRef.current.clear();
    revisionByTranscriptRef.current.clear();
    lastBroadcastByTranscriptRef.current.clear();
  }

  async function loadActiveSession(
    role: RemoteMicRole | null,
    options: { quiet?: boolean } = {},
  ): Promise<RemoteMicSession | null> {
    if (!role) {
      setServerLabel("役割未設定");
      setError("/mic/elder または /mic/caregiver で開いてください。");
      return null;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS);

    try {
      const data = await fetchCurrentSession(role, controller.signal);
      if (!data.active) {
        setRemoteMic(null);
        setServerLabel("PC待機中");
        return null;
      }

      const nextRemoteMic = {
        sessionId: data.active.sessionId,
        participantCode: data.active.participantCode,
        dialogueStartedAt: data.active.dialogueStartedAt,
        role: data.role,
      };
      setRemoteMic(nextRemoteMic);
      if (!options.quiet) setError("");
      setServerLabel("接続準備完了");
      return nextRemoteMic;
    } catch (loadError) {
      setServerLabel("未接続");
      if (!options.quiet) {
        setError(
          loadError instanceof DOMException && loadError.name === "AbortError"
            ? "サーバー確認がタイムアウトしました。PC側で /session を開いてください。"
            : loadError instanceof Error
              ? loadError.message
              : "現在の対話セッションを確認できませんでした。",
        );
      }
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function openRealtimeConnection(
    targetRemoteMic: RemoteMicSession,
    options: { reconnecting: boolean; reuseLiveStream: boolean },
  ) {
    const realtimeSession = await createRealtimeSession(targetRemoteMic);
    realtimeModelRef.current = realtimeSession.model;
    const stream = await getOrCreateMediaStream(options.reuseLiveStream);
    const connectionStreamId = `${targetRemoteMic.role}:${Date.now()}:${crypto.randomUUID()}`;
    const connectionGeneration = connectionGenerationRef.current + 1;
    connectionGenerationRef.current = connectionGeneration;
    streamIdRef.current = connectionStreamId;
    captureEpochRef.current += 1;
    const connectionCaptureEpoch = captureEpochRef.current;

    if (!levelStopRef.current) {
      try {
        levelStopRef.current = startLevelMeter(stream, (nextLevel) => {
          setLevel(nextLevel);
        });
      } catch {
        levelStopRef.current = null;
        setLevel(0);
      }
    }

    const peerConnection = new RTCPeerConnection();
    peerConnectionRef.current = peerConnection;
    const dataChannel = peerConnection.createDataChannel("oai-events");
    dataChannelRef.current = dataChannel;
    dataChannel.onopen = () => {
      if (!isCurrentConnection(connectionGeneration, connectionStreamId)) return;
      setConnectionLabel("接続済み");
      setServerLabel(captureBlockedRef.current ? "AI音声中のため一時ミュート" : "文字起こし中");
    };
    dataChannel.onmessage = (event) => {
      handleRealtimeEvent({
        session: targetRemoteMic,
        streamId: connectionStreamId,
        captureEpoch: connectionCaptureEpoch,
        generation: connectionGeneration,
        data: event.data,
      });
    };
    dataChannel.onerror = (event) => {
      if (!isCurrentConnection(connectionGeneration, connectionStreamId)) return;
      console.warn("[remote-mic realtime data channel error]", event);
      setConnectionLabel("データ接続エラー");
      void reconnectRealtime("data_channel_error");
    };
    dataChannel.onclose = () => {
      if (!isCurrentConnection(connectionGeneration, connectionStreamId)) return;
      if (!fullyStoppedRef.current && !sessionEndedRef.current) {
        void reconnectRealtime("data_channel_closed");
      }
    };
    peerConnection.onconnectionstatechange = () => {
      if (!isCurrentConnection(connectionGeneration, connectionStreamId)) return;
      handlePeerConnectionStateChange(peerConnection.connectionState);
    };

    for (const track of stream.getAudioTracks()) {
      track.enabled = options.reconnecting ? false : !captureBlockedRef.current;
      track.onended = () => {
        if (!isCurrentConnection(connectionGeneration, connectionStreamId)) return;
        void reconnectRealtime("track_ended");
      };
      peerConnection.addTrack(track, stream);
    }

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    if (!offer.sdp) {
      throw new Error("Realtime接続のofferを作成できませんでした。");
    }

    const answerSdp = await createRealtimeCall(realtimeSession.clientSecret, offer.sdp);
    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });

    if (!options.reconnecting) {
      captureBlockedRef.current = isAiSpeechBlockingCapture();
    }
  }

  async function getOrCreateMediaStream(reuseLiveStream: boolean) {
    const existing = streamRef.current;
    const existingTracks = existing?.getAudioTracks() ?? [];
    if (
      reuseLiveStream &&
      existing &&
      existingTracks.length > 0 &&
      existingTracks.every((track) => track.readyState === "live")
    ) {
      return existing;
    }

    levelStopRef.current?.();
    levelStopRef.current = null;
    existing?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    streamRef.current = stream;
    return stream;
  }

  async function start(targetRemoteMic = remoteMicRef.current) {
    if (!targetRemoteMic) return;
    if (startInFlightRef.current || recordingActiveRef.current || micStateRef.current !== "idle") {
      return;
    }
    if (isAiSpeechBlockingCapture()) {
      resumeAfterAiSpeechRef.current = true;
      return;
    }

    manuallyStoppedRef.current = false;
    fullyStoppedRef.current = false;
    sessionEndedRef.current = false;
    startInFlightRef.current = true;
    setError("");
    setPermissionLabel("確認中");
    setConnectionLabel("接続中");
    setMicState("requesting");
    setMicPhaseValue("connecting");

    let unmuted = false;
    try {
      if (!isHttpsTsNetUrl(window.location.href)) {
        throw new Error(
          "スマホマイクは https:// で始まる .ts.net のTailscale Serve URLから開いてください。",
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではマイクを利用できません。");
      }
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error(
          "このブラウザではRealtime接続を利用できません。ChromeまたはSafariで開いてください。",
        );
      }

      await setFixedMicMuted(false, targetRemoteMic);
      unmuted = true;
      await openRealtimeConnection(targetRemoteMic, {
        reconnecting: false,
        reuseLiveStream: false,
      });

      recordingActiveRef.current = true;
      reconnectAttemptRef.current = 0;
      setPermissionLabel("許可済み");
      setMicState("streaming");
      setServerLabel("文字起こし中");
      setMicPhaseValue(captureBlockedRef.current ? "suppressed" : "listening");
    } catch (startError) {
      if (isPermissionError(startError)) {
        setPermissionLabel("拒否");
      }
      setError(
        startError instanceof Error
          ? startError.message
          : "マイクを開始できませんでした。",
      );
      await stopRealtimeConnection();
      if (unmuted) {
        await setFixedMicMuted(true, targetRemoteMic).catch(() => undefined);
      }
      setMicState("idle");
      setMicPhaseValue(isPermissionError(startError) ? "error" : "disconnected");
      setConnectionLabel("未接続");
    } finally {
      startInFlightRef.current = false;
    }
  }

  function handleRealtimeEvent(input: {
    session: RemoteMicSession;
    streamId: string;
    captureEpoch: number;
    generation: number;
    data: unknown;
  }) {
    if (typeof input.data !== "string") return;

    let event: RealtimeEvent;
    try {
      event = JSON.parse(input.data) as RealtimeEvent;
    } catch {
      return;
    }

    const {
      session,
      streamId,
      captureEpoch: connectionCaptureEpoch,
      generation,
    } = input;
    const isCurrent = isCurrentConnection(generation, streamId);
    const type = event.type ?? "";
    if (type === "input_audio_buffer.speech_started") {
      if (!isCurrent) return;
      if (isAiSpeechBlockingCapture()) return;
      const transcriptId = getTranscriptId(event);
      ensureTranscriptCaptureMetadata(transcriptId, streamId, connectionCaptureEpoch);
      const speechStartedAt = Date.now();
      speechStartedAtByTranscriptRef.current.set(transcriptId, speechStartedAt);
      lastTranscriptActivityAtByTranscriptRef.current.set(
        transcriptId,
        speechStartedAt,
      );
      void publishRemoteMicRealtimeEvent({
        type: "mic.speech_started",
        sessionId: session.sessionId,
        role: session.role,
        streamId,
        transcriptId,
        captureEpoch: connectionCaptureEpoch,
        timestamp: new Date().toISOString(),
      }).catch(() => undefined);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      if (!isCurrent) return;
      if (isAiSpeechBlockingCapture()) return;
      const transcriptId = getTranscriptId(event);
      ensureTranscriptCaptureMetadata(transcriptId, streamId, connectionCaptureEpoch);
      const delta = event.delta ?? "";
      if (!delta) return;

      const previous = partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      const text = `${previous}${delta}`;
      partialTextByTranscriptRef.current.set(transcriptId, text);
      lastTranscriptActivityAtByTranscriptRef.current.set(transcriptId, Date.now());
      const firstPartialAt = logFirstDeltaLatency(transcriptId, session);
      schedulePartialBroadcast(session, transcriptId, text, firstPartialAt);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptId = getTranscriptId(event);
      ensureTranscriptCaptureMetadata(transcriptId, streamId, connectionCaptureEpoch);
      const text =
        event.transcript ?? partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      const eventStreamId = streamIdByTranscriptRef.current.get(transcriptId) ?? streamId;
      const captureEpoch =
        captureEpochByTranscriptRef.current.get(transcriptId) ?? input.captureEpoch;
      const blockedAtCapture =
        blockedAtCaptureByTranscriptRef.current.get(transcriptId) ??
        isAiSpeechBlockingCapture();
      const aiPlaybackIdAtCapture =
        aiPlaybackIdAtCaptureByTranscriptRef.current.get(transcriptId) ?? null;
      const startedAt = getTranscriptStartedAt(transcriptId);
      const firstPartialAt = getFirstPartialAt(transcriptId);
      const finalizedAt = new Date().toISOString();
      const endedAt = getTranscriptEndedAt(transcriptId) ?? finalizedAt;

      if (blockedAtCapture) {
        console.info("[remote-mic final transcript skipped during ai speech]", {
          sessionId: session.sessionId,
          role: session.role,
          transcriptId,
          streamId: eventStreamId,
          captureEpoch,
          aiPlaybackIdAtCapture,
        });
      } else {
        broadcastFinalTranscript(session, transcriptId, {
          streamId: eventStreamId,
          captureEpoch,
          text,
          startedAt,
          firstPartialAt,
          finalizedAt,
          eventId: event.event_id,
        });
        void publishRemoteMicRealtimeEvent({
          type: "mic.speech_finalized",
          sessionId: session.sessionId,
          role: session.role,
          streamId: eventStreamId,
          transcriptId,
          captureEpoch,
          timestamp: finalizedAt,
        }).catch(() => undefined);
      }
      clearTranscriptState(transcriptId);

      console.info("[remote-mic final transcript latency]", {
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        latencyMs: startedAt ? Date.now() - new Date(startedAt).getTime() : null,
      });
      const finalQueueKey = createPendingFinalKey(eventStreamId, transcriptId);
      pendingFinalByTranscriptRef.current.set(finalQueueKey, {
        streamId: eventStreamId,
        transcriptId,
        captureEpoch,
        text,
        startedAt,
        endedAt,
        finalizedAt,
        firstPartialAt,
        blockedAtCapture,
        aiPlaybackIdAtCapture,
        saveAttempts: 0,
      });
      void saveFinalTranscriptWithRetry(finalQueueKey, {
        eventId: event.event_id,
        firstPartialAt,
        finalizedAt,
      });
      return;
    }

    if (type === "error") {
      if (!isCurrent) return;
      console.warn("[remote-mic realtime error]", event);
      setConnectionLabel("Realtimeエラー");
      void reconnectRealtime("data_channel_error");
    }
  }

  function logFirstDeltaLatency(transcriptId: string, session: RemoteMicSession) {
    const existing = firstDeltaAtByTranscriptRef.current.get(transcriptId);
    if (existing) return new Date(existing).toISOString();

    const firstDeltaAt = Date.now();
    firstDeltaAtByTranscriptRef.current.set(transcriptId, firstDeltaAt);
    const speechStartedAt = speechStartedAtByTranscriptRef.current.get(transcriptId);
    console.info("[remote-mic first transcript delta latency]", {
      sessionId: session.sessionId,
      role: session.role,
      transcriptId,
      latencyMs: speechStartedAt ? firstDeltaAt - speechStartedAt : null,
    });
    return new Date(firstDeltaAt).toISOString();
  }

  function schedulePartialBroadcast(
    session: RemoteMicSession,
    transcriptId: string,
    text: string,
    firstPartialAt: string,
  ) {
    if (!text.trim() || !isLiveTranscriptBroadcastAllowed(session)) return;
    if (partialBroadcastTimersRef.current.has(transcriptId)) return;

    const timerId = window.setTimeout(() => {
      partialBroadcastTimersRef.current.delete(transcriptId);
      const latestText = partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      if (!latestText.trim() || !isLiveTranscriptBroadcastAllowed(session)) return;

      broadcastPartialTranscript(session, transcriptId, latestText, firstPartialAt);
    }, PARTIAL_BROADCAST_INTERVAL_MS);
    partialBroadcastTimersRef.current.set(transcriptId, timerId);
  }

  function broadcastPartialTranscript(
    session: RemoteMicSession,
    transcriptId: string,
    text: string,
    firstPartialAt: string,
  ) {
    const revision = nextTranscriptRevision(transcriptId);
    const previous = lastBroadcastByTranscriptRef.current.get(transcriptId);
    if (previous?.revision === revision && previous.text === text) return;

    lastBroadcastByTranscriptRef.current.set(transcriptId, { revision, text });
    void publishRemoteMicRealtimeEvent({
      type: "transcript.partial",
      sessionId: session.sessionId,
      role: session.role,
      streamId: streamIdByTranscriptRef.current.get(transcriptId) ?? streamIdRef.current,
      transcriptId,
      revision,
      captureEpoch:
        captureEpochByTranscriptRef.current.get(transcriptId) ?? captureEpochRef.current,
      text,
      startedAt: getTranscriptStartedAt(transcriptId),
      firstPartialAt,
      model: realtimeModelRef.current || undefined,
    }).catch((error) => {
      console.warn("[remote-mic live partial publish failed]", {
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        error,
      });
    });
  }

  function broadcastFinalTranscript(
    session: RemoteMicSession,
    transcriptId: string,
    input: {
      streamId: string;
      captureEpoch: number;
      text: string;
      startedAt?: string;
      firstPartialAt?: string;
      finalizedAt: string;
      eventId?: string;
    },
  ) {
    clearPartialBroadcastTimer(transcriptId);
    if (!input.text.trim() || !isRemoteMicSessionCurrent(session)) return;

    const revision = nextTranscriptRevision(transcriptId);
    lastBroadcastByTranscriptRef.current.set(transcriptId, {
      revision,
      text: input.text,
    });
    void publishRemoteMicRealtimeEvent({
      type: "transcript.final",
      sessionId: session.sessionId,
      role: session.role,
      streamId: input.streamId,
      transcriptId,
      revision,
      captureEpoch: input.captureEpoch,
      text: input.text,
      startedAt: input.startedAt,
      firstPartialAt: input.firstPartialAt,
      finalizedAt: input.finalizedAt,
      eventId: input.eventId,
      model: realtimeModelRef.current || undefined,
    }).catch((error) => {
      console.warn("[remote-mic live final publish failed]", {
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        error,
      });
    });
  }

  function clearPartialBroadcastTimer(transcriptId: string) {
    const timerId = partialBroadcastTimersRef.current.get(transcriptId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      partialBroadcastTimersRef.current.delete(transcriptId);
    }
  }

  function nextTranscriptRevision(transcriptId: string) {
    const nextRevision = (revisionByTranscriptRef.current.get(transcriptId) ?? 0) + 1;
    revisionByTranscriptRef.current.set(transcriptId, nextRevision);
    return nextRevision;
  }

  function createPendingFinalKey(streamId: string, transcriptId: string) {
    return `${streamId}:${transcriptId}`;
  }

  function ensureTranscriptCaptureMetadata(
    transcriptId: string,
    streamId = streamIdRef.current,
    captureEpoch = captureEpochRef.current,
  ) {
    if (!streamIdByTranscriptRef.current.has(transcriptId)) {
      streamIdByTranscriptRef.current.set(transcriptId, streamId);
    }
    if (!captureEpochByTranscriptRef.current.has(transcriptId)) {
      captureEpochByTranscriptRef.current.set(transcriptId, captureEpoch);
    }
    if (!blockedAtCaptureByTranscriptRef.current.has(transcriptId)) {
      blockedAtCaptureByTranscriptRef.current.set(
        transcriptId,
        isAiSpeechBlockingCapture(),
      );
    }
    if (!aiPlaybackIdAtCaptureByTranscriptRef.current.has(transcriptId)) {
      aiPlaybackIdAtCaptureByTranscriptRef.current.set(
        transcriptId,
        aiSpeechStateRef.current.playbackId,
      );
    }
  }

  function isLiveTranscriptBroadcastAllowed(session: RemoteMicSession) {
    return !isAiSpeechBlockingCapture() && isRemoteMicSessionCurrent(session);
  }

  function isRemoteMicSessionCurrent(session: RemoteMicSession) {
    const current = remoteMicRef.current;
    return (
      !manuallyStoppedRef.current &&
      micStateRef.current === "streaming" &&
      current?.sessionId === session.sessionId &&
      current.role === session.role
    );
  }

  function discardLiveTranscripts(reason: string) {
    const current = remoteMicRef.current;
    if (!current || !streamIdRef.current) return;

    for (const transcriptId of partialTextByTranscriptRef.current.keys()) {
      void publishRemoteMicRealtimeEvent({
        type: "transcript.discarded",
        sessionId: current.sessionId,
        role: current.role,
        streamId: streamIdRef.current,
        transcriptId,
        reason,
      }).catch(() => undefined);
    }
  }

  function getTranscriptStartedAt(transcriptId: string) {
    const startedAt = speechStartedAtByTranscriptRef.current.get(transcriptId);
    return startedAt ? new Date(startedAt).toISOString() : undefined;
  }

  function getFirstPartialAt(transcriptId: string) {
    const firstPartialAt = firstDeltaAtByTranscriptRef.current.get(transcriptId);
    return firstPartialAt ? new Date(firstPartialAt).toISOString() : undefined;
  }

  function getTranscriptEndedAt(transcriptId: string) {
    const endedAt = lastTranscriptActivityAtByTranscriptRef.current.get(transcriptId);
    return endedAt ? new Date(endedAt).toISOString() : undefined;
  }

  async function muteMicrophone() {
    await stop();
  }

  async function stop(notifyServer = true) {
    manuallyStoppedRef.current = true;
    fullyStoppedRef.current = true;
    resumeAfterAiSpeechRef.current = false;
    captureBlockedRef.current = false;
    await stopRealtimeConnection();
    setConnectionLabel("未接続");
    setLevel(0);
    setMicState("idle");
    setMicPhaseValue("stopped");

    if (notifyServer) {
      await setFixedMicMuted(true).catch(() => undefined);
      setServerLabel("停止中");
    }
  }

  async function stopRealtimeConnection() {
    recordingActiveRef.current = false;
    reconnectInFlightRef.current = false;
    clearReconnectTimers();
    connectionGenerationRef.current += 1;
    discardLiveTranscripts("connection_stopped");
    flushPendingFinalTranscripts();
    clearTranscriptState();
    closeRealtimeTransport(true);
  }

  async function setFixedMicMuted(
    muted: boolean,
    targetRemoteMic = remoteMicRef.current,
  ) {
    if (!targetRemoteMic) return;

    const response = await fetch("/api/remote-mic/fixed/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        muted,
      }),
    });

    if (!response.ok) {
      throw new Error(`マイク状態を更新できませんでした。(${response.status})`);
    }

    const data = (await response.json()) as {
      dialogueStartedAt: string | null;
      muted: boolean;
    };
    setRemoteMic((current) =>
      current
        ? {
            ...current,
            dialogueStartedAt: data.dialogueStartedAt,
          }
        : current,
    );
  }

  async function publishMicControlAck(
    type: "mic.suppressed" | "mic.resumed",
    playbackId: string,
    revision: number,
    trackLive: boolean,
  ) {
    const targetRemoteMic = remoteMicRef.current;
    if (!targetRemoteMic) return;

    await publishRemoteMicRealtimeEvent({
      type,
      sessionId: targetRemoteMic.sessionId,
      playbackId,
      role: targetRemoteMic.role,
      trackLive,
      revision,
      timestamp: new Date().toISOString(),
    }).catch((error) => {
      console.warn("[remote-mic control ack failed]", {
        type,
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        playbackId,
        revision,
        trackLive,
        error,
      });
    });
  }

  async function publishRemoteMicRealtimeEvent(event: RemoteMicRealtimeEvent) {
    await fetch("/api/ai/speech-state/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.08em] text-stone-500">
              Fixed Smartphone Mic
            </div>
            <h1 className="mt-1 text-[20px] font-black">{roleLabel}</h1>
            <p className="mt-1 text-[12px] font-bold text-stone-600">
              OpenAI Realtimeへ音声を送信します。
            </p>
          </div>
          <div
            className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
              micState === "streaming"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-stone-100 text-stone-600"
            }`}
          >
            {micState === "streaming" ? "接続中" : micState === "requesting" ? "確認中" : "停止中"}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <StatusRow label="役割" value={fixedRole ? getRemoteMicRoleLabel(fixedRole) : "未設定"} />
          <StatusRow label="参加者ID" value={remoteMic?.participantCode || "PC待機中"} />
          <StatusRow label="セッション" value={remoteMic?.sessionId || "未接続"} />
          <StatusRow label="接続URL" value={openUrlLabel} />
          <StatusRow label="ブラウザ" value={browserLabel} />
          <StatusRow label="HTTPS" value={secureContext ? "OK" : "NG"} />
          <StatusRow label="マイクAPI" value={mediaSupported ? "利用可能" : "利用不可"} />
          <StatusRow label="WebRTC" value={webrtcSupported ? "利用可能" : "利用不可"} />
          <StatusRow label="文字起こし方式" value="OpenAI Realtime" />
          <StatusRow label="マイク許可" value={permissionLabel} />
          <StatusRow label="接続状態" value={connectionLabel} />
          <StatusRow label="マイク状態" value={getMicPhaseLabel(micPhase)} />
          <StatusRow label="サーバー" value={serverLabel} />
          <StatusRow label="AI音声" value={aiSpeechLabel} />
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-stone-500">
            <span>入力レベル</span>
            <span>{Math.round(level * 100)}%</span>
          </div>
          <LevelBar value={level} />
        </div>

        {helpText ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold leading-relaxed text-amber-900">
            {helpText}
          </div>
        ) : null}

        {httpsUrl ? (
          <a
            href={httpsUrl}
            className="mt-3 block rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-[12px] font-black text-emerald-900"
          >
            HTTPS URLで開く
          </a>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-bold leading-relaxed text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void loadActiveSession(fixedRole)}
          className="mt-4 min-h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-[13px] font-black text-stone-700 active:scale-[0.99]"
        >
          接続状態を再取得
        </button>

        <button
          type="button"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.set("v", String(Date.now()));
            window.location.replace(url.toString());
          }}
          className="mt-2 min-h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-[13px] font-black text-stone-700 active:scale-[0.99]"
        >
          画面を更新
        </button>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start()}
            className="min-h-12 rounded-md bg-stone-950 px-3 text-[14px] font-black text-white active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400"
          >
            マイク開始
          </button>
          <button
            type="button"
            disabled={micState !== "streaming" && micState !== "requesting"}
            onClick={() => void muteMicrophone()}
            className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-[14px] font-black text-stone-700 active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
          >
            停止
          </button>
        </div>
      </section>
    </main>
  );

  async function saveFinalTranscriptWithRetry(
    finalQueueKey: string,
    input: {
      eventId?: string;
      firstPartialAt?: string;
      finalizedAt?: string;
    },
  ) {
    const pending = pendingFinalByTranscriptRef.current.get(finalQueueKey);
    if (!pending) return;
    pending.saveAttempts += 1;
    const current = remoteMicRef.current;
    const text = pending.text.trim();
    if (!text) {
      pendingFinalByTranscriptRef.current.delete(finalQueueKey);
      return;
    }
    if (!current) return;

    let response: Response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), FINAL_SAVE_TIMEOUT_MS);
    try {
      response = await fetch("/api/remote-mic/realtime/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: current.sessionId,
          role: current.role,
          streamId: pending.streamId,
          transcriptId: pending.transcriptId,
          captureEpoch: pending.captureEpoch,
          text,
          eventId: input.eventId,
          startedAt: pending.startedAt,
          firstPartialAt: pending.firstPartialAt ?? input.firstPartialAt,
          endedAt: pending.endedAt,
          finalizedAt: pending.finalizedAt ?? input.finalizedAt,
          model: realtimeModelRef.current,
          blockedAtCapture: pending.blockedAtCapture,
          aiPlaybackIdAtCapture: pending.aiPlaybackIdAtCapture,
        }),
      });
    } catch (error) {
      console.warn("[remote-mic final transcript save failed]", {
        transcriptId: pending.transcriptId,
        status: "network_error",
        attempts: pending.saveAttempts,
        error,
      });
      if (pending.saveAttempts < MAX_FINAL_SAVE_RETRY_COUNT) {
        window.setTimeout(() => {
          void saveFinalTranscriptWithRetry(finalQueueKey, input);
        }, FINAL_SAVE_RETRY_MS);
      } else {
        setError("確定発話を保存できませんでした。通信状態を確認してください。");
      }
      return;
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.warn("[remote-mic final transcript save rejected]", {
        transcriptId: pending.transcriptId,
        status: response.status,
        attempts: pending.saveAttempts,
      });
      if (response.status >= 500 && pending.saveAttempts < MAX_FINAL_SAVE_RETRY_COUNT) {
        window.setTimeout(() => {
          void saveFinalTranscriptWithRetry(finalQueueKey, input);
        }, FINAL_SAVE_RETRY_MS);
        return;
      }
      pendingFinalByTranscriptRef.current.delete(finalQueueKey);
      return;
    }

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      outcome?: "created" | "existing" | "skipped";
      reason?: string;
    } | null;
    if (data?.outcome === "skipped") {
      console.info("[remote-mic final transcript save skipped]", {
        transcriptId: pending.transcriptId,
        reason: data.reason ?? null,
      });
    }
    if (
      data?.outcome !== "created" &&
      data?.outcome !== "existing" &&
      data?.outcome !== "skipped"
    ) {
      console.warn("[remote-mic final transcript save invalid response]", {
        transcriptId: pending.transcriptId,
        attempts: pending.saveAttempts,
        data,
      });
      if (pending.saveAttempts < MAX_FINAL_SAVE_RETRY_COUNT) {
        window.setTimeout(() => {
          void saveFinalTranscriptWithRetry(finalQueueKey, input);
        }, FINAL_SAVE_RETRY_MS);
      }
      return;
    }
    pendingFinalByTranscriptRef.current.delete(finalQueueKey);
  }

  function flushPendingFinalTranscripts() {
    for (const [finalQueueKey, pending] of pendingFinalByTranscriptRef.current.entries()) {
      if (pending.saveAttempts >= MAX_FINAL_SAVE_RETRY_COUNT) continue;
      void saveFinalTranscriptWithRetry(finalQueueKey, {
        eventId: undefined,
        firstPartialAt: pending.firstPartialAt,
        finalizedAt: pending.finalizedAt,
      });
    }
  }

  async function flushPendingFinalTranscriptsForRequest(requestId: string) {
    const targetRemoteMic = remoteMicRef.current;
    if (!targetRemoteMic) return;

    const failedTranscriptKeys: string[] = [];
    const pendingEntries = Array.from(pendingFinalByTranscriptRef.current.entries());

    for (const [finalQueueKey, pending] of pendingEntries) {
      if (!pendingFinalByTranscriptRef.current.has(finalQueueKey)) continue;
      const beforeAttempts = pending.saveAttempts;
      await saveFinalTranscriptWithRetry(finalQueueKey, {
        eventId: undefined,
        firstPartialAt: pending.firstPartialAt,
        finalizedAt: pending.finalizedAt,
      });
      if (pendingFinalByTranscriptRef.current.has(finalQueueKey)) {
        failedTranscriptKeys.push(finalQueueKey);
        const currentPending = pendingFinalByTranscriptRef.current.get(finalQueueKey);
        if (currentPending && currentPending.saveAttempts === beforeAttempts) {
          currentPending.saveAttempts += 1;
        }
      }
    }

    const pendingCount = pendingFinalByTranscriptRef.current.size;
    await publishRemoteMicRealtimeEvent({
      type: "transcript.flush_ack",
      sessionId: targetRemoteMic.sessionId,
      requestId,
      role: targetRemoteMic.role,
      outcome: pendingCount === 0 ? "complete" : "failed",
      pendingCount,
      failedTranscriptKeys,
      timestamp: new Date().toISOString(),
    }).catch((error) => {
      console.warn("[remote-mic transcript flush ack failed]", {
        sessionId: targetRemoteMic.sessionId,
        role: targetRemoteMic.role,
        requestId,
        pendingCount,
        failedTranscriptKeys,
        error,
      });
    });
  }
}

async function fetchCurrentSession(role: RemoteMicRole, signal?: AbortSignal) {
  const response = await fetch(`/api/remote-mic/fixed/current?role=${role}`, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`現在の対話セッションを確認できませんでした。(${response.status})`);
  }

  return response.json() as Promise<{
    active: {
      sessionId: string;
      participantCode: string | null;
      dialogueStartedAt: string | null;
      endedAt: string | null;
    } | null;
    role: RemoteMicRole;
  }>;
}

async function createRealtimeSession(remoteMic: RemoteMicSession) {
  const response = await fetch("/api/remote-mic/realtime/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: remoteMic.sessionId,
      role: remoteMic.role,
    }),
  });

  if (!response.ok) {
    throw new Error(`Realtime session failed: ${response.status}`);
  }

  return response.json() as Promise<{
    clientSecret: string;
    expiresAt: number | null;
    model: string;
  }>;
}

async function createRealtimeCall(clientSecret: string, sdp: string) {
  const formData = new FormData();
  formData.append("sdp", sdp);

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${clientSecret}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.warn("[remote-mic realtime call failed]", {
      status: response.status,
      errorText,
    });
    throw new Error(`Realtime call failed: ${response.status}`);
  }

  return response.text();
}

function getTranscriptId(event: RealtimeEvent) {
  return event.item_id ?? event.item?.id ?? event.event_id ?? crypto.randomUUID();
}

function StatusRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-bold text-stone-500">{props.label}</span>
      <span className="min-w-0 truncate text-right text-[13px] font-black text-stone-900">
        {props.value}
      </span>
    </div>
  );
}

function LevelBar(props: { value: number }) {
  const width = `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div className="h-full bg-emerald-600" style={{ width }} />
    </div>
  );
}

function getHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !url.hostname.endsWith(".ts.net")) return "";

    url.protocol = "https:";
    return url.toString();
  } catch {
    return "";
  }
}

function isHttpsTsNetUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
}

function getInsecureContextHelp() {
  return "スマホマイクは https:// で始まる .ts.net のTailscale Serve URLで開いてください。";
}

function getBrowserLabel(userAgent: string) {
  if (/SamsungBrowser/i.test(userAgent)) return "Samsung Internet / Android";
  if (/EdgA|EdgiOS|Edg\//i.test(userAgent)) {
    return /Android/i.test(userAgent) ? "Edge / Android" : "Edge";
  }
  if (/CriOS/i.test(userAgent)) return "Chrome / iOS";
  if (/Chrome|Chromium/i.test(userAgent)) {
    return /Android/i.test(userAgent) ? "Chrome / Android" : "Chrome";
  }
  if (/FxiOS/i.test(userAgent)) return "Firefox / iOS";
  if (/Firefox/i.test(userAgent)) {
    return /Android/i.test(userAgent) ? "Firefox / Android" : "Firefox";
  }
  if (/Safari/i.test(userAgent) && /Mobile/i.test(userAgent)) return "Safari / iOS";
  if (/Safari/i.test(userAgent)) return "Safari";

  return "その他のブラウザ";
}

function getFixedRemoteMicRole(explicitRole: RemoteMicRole | null): RemoteMicRole | null {
  if (explicitRole) {
    window.localStorage.setItem("fixed-remote-mic-role", explicitRole);
    return explicitRole;
  }

  const path = window.location.pathname.toLowerCase();
  if (path.includes("/mic/elder")) {
    window.localStorage.setItem("fixed-remote-mic-role", "elder");
    return "elder";
  }
  if (path.includes("/mic/caregiver")) {
    window.localStorage.setItem("fixed-remote-mic-role", "caregiver");
    return "caregiver";
  }

  const saved = window.localStorage.getItem("fixed-remote-mic-role");
  return saved === "elder" || saved === "caregiver" ? saved : null;
}

function getRemoteMicRoleLabel(role: RemoteMicRole) {
  return role === "elder" ? "本人用" : "介護者用";
}

function getMicPhaseLabel(phase: MicPhase) {
  switch (phase) {
    case "connecting":
      return "接続中";
    case "listening":
      return "受付中";
    case "suppressing":
      return "ミュート準備中";
    case "suppressed":
      return "AI音声中ミュート";
    case "resuming":
      return "復帰中";
    case "reconnecting":
      return "再接続中";
    case "error":
      return "手動確認が必要";
    case "stopped":
      return "完全停止";
    case "disconnected":
    default:
      return "未接続";
  }
}

function startLevelMeter(stream: MediaStream, onLevel: (level: number) => void) {
  const AudioContextClass =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser");
  }

  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const buffer = new Float32Array(analyser.fftSize);
  let frameId = 0;
  let stopped = false;

  source.connect(analyser);

  const tick = () => {
    if (stopped) return;

    analyser.getFloatTimeDomainData(buffer);
    onLevel(calculateLevel(buffer));
    frameId = window.requestAnimationFrame(tick);
  };

  frameId = window.requestAnimationFrame(tick);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
    try {
      source.disconnect();
    } catch {}
    void context.close().catch(() => {});
  };
}

function calculateLevel(samples: Float32Array) {
  let sumSquares = 0;
  let peak = 0;

  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    if (absolute > peak) peak = absolute;
  }

  const rms = Math.sqrt(sumSquares / samples.length);

  return Math.min(1, Math.max(rms * 8, peak));
}

function isPermissionError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" ||
      error.name === "SecurityError" ||
      error.name === "PermissionDeniedError")
  );
}

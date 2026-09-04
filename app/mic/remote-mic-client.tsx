"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RemoteMicRole = "elder" | "caregiver";
type MicState = "idle" | "requesting" | "streaming";
type RemoteMicSession = {
  sessionId: string;
  role: RemoteMicRole;
  participantCode: string | null;
  dialogueStartedAt: string | null;
};
type AiSpeechEvent = {
  type?: string;
  sessionId?: string;
  playbackId?: string | null;
  revision?: number;
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
type RemoteMicWsTranscriptEvent = {
  type: "partial" | "final" | "speech_started" | "error";
  sessionId: string;
  role: RemoteMicRole;
  transcriptId: string;
  revision: number;
  text: string;
  startedAt?: string;
  endedAt?: string;
};
type RemoteMicWsClientType = "producer" | "subscriber";

const CLIENT_VERSION = "remote-mic-client-2026-09-04-openai-realtime";
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const HEARTBEAT_MS = 15_000;
const AI_SPEECH_RELEASE_DELAY_MS = 500;
const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45_000;
const REMOTE_MIC_WS_RECONNECT_MS = 1000;
const FINAL_SAVE_RETRY_MS = 2000;
const MAX_FINAL_SAVE_RETRY_COUNT = 5;

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
  const realtimeModelRef = useRef("");
  const relayWebSocketRef = useRef<WebSocket | null>(null);
  const relayReconnectTimerRef = useRef<number | null>(null);
  const relayConnectedSessionRef = useRef<RemoteMicSession | null>(null);
  const partialTextByTranscriptRef = useRef<Map<string, string>>(new Map());
  const speechStartedAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const firstDeltaAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const revisionByTranscriptRef = useRef<Map<string, number>>(new Map());
  const latestPartialByTranscriptRef = useRef<
    Map<string, RemoteMicWsTranscriptEvent>
  >(new Map());
  const pendingFinalByTranscriptRef = useRef<
    Map<
      string,
      RemoteMicWsTranscriptEvent & {
        firstPartialAt?: string;
        saveAttempts: number;
      }
    >
  >(new Map());
  const aiSpeechReleaseTimerRef = useRef<number | null>(null);
  const aiSpeechSafetyTimerRef = useRef<number | null>(null);
  const resumeAfterAiSpeechRef = useRef(false);
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

    const revision = typeof event.revision === "number" ? event.revision : 0;
    if (revision < aiSpeechStateRef.current.revision) return;

    if (event.type === "ai_speech_start" && event.playbackId) {
      pauseCaptureForAiSpeech(event.playbackId, revision);
      return;
    }

    if (
      (event.type === "ai_speech_end" || event.type === "ai_speech_cancel") &&
      event.playbackId === aiSpeechStateRef.current.playbackId
    ) {
      const releaseUntil = event.releaseAfter
        ? new Date(event.releaseAfter).getTime()
        : Date.now() + AI_SPEECH_RELEASE_DELAY_MS;
      releaseCaptureAfterAiSpeech(revision, releaseUntil);
    }
  }

  function pauseCaptureForAiSpeech(playbackId: string, revision: number) {
    resumeAfterAiSpeechRef.current = recordingActiveRef.current || startInFlightRef.current;
    aiSpeechStateRef.current = {
      active: true,
      playbackId,
      revision,
      releaseUntil: 0,
    };
    setAiSpeechLabel("AI音声中のため一時停止");
    clearTranscriptState();
    void stopRealtimeConnection();
    void setFixedMicMuted(true).catch(() => undefined);

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

    const delayMs = Math.max(0, releaseUntil - Date.now());
    aiSpeechStateRef.current = {
      ...aiSpeechStateRef.current,
      active: true,
      revision,
      releaseUntil,
    };
    aiSpeechReleaseTimerRef.current = window.setTimeout(() => {
      aiSpeechReleaseTimerRef.current = null;
      aiSpeechStateRef.current = {
        active: false,
        playbackId: null,
        revision,
        releaseUntil: 0,
      };
      setAiSpeechLabel("通常受付");

      if (resumeAfterAiSpeechRef.current) {
        resumeAfterAiSpeechRef.current = false;
        void start(remoteMicRef.current);
      }
    }, delayMs);
  }

  function isAiSpeechBlockingCapture() {
    const state = aiSpeechStateRef.current;
    return state.active || Date.now() <= state.releaseUntil;
  }

  function clearTranscriptState(transcriptId?: string) {
    if (transcriptId) {
      partialTextByTranscriptRef.current.delete(transcriptId);
      speechStartedAtByTranscriptRef.current.delete(transcriptId);
      firstDeltaAtByTranscriptRef.current.delete(transcriptId);
      return;
    }

    partialTextByTranscriptRef.current.clear();
    speechStartedAtByTranscriptRef.current.clear();
    firstDeltaAtByTranscriptRef.current.clear();
    revisionByTranscriptRef.current.clear();
    latestPartialByTranscriptRef.current.clear();
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

  async function start(targetRemoteMic = remoteMicRef.current) {
    if (!targetRemoteMic) return;
    if (startInFlightRef.current || recordingActiveRef.current || micStateRef.current !== "idle") {
      return;
    }
    if (isAiSpeechBlockingCapture()) {
      resumeAfterAiSpeechRef.current = true;
      return;
    }

    startInFlightRef.current = true;
    setError("");
    setPermissionLabel("確認中");
    setConnectionLabel("接続中");
    setMicState("requesting");

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
      connectRelayWebSocket(targetRemoteMic);
      const realtimeSession = await createRealtimeSession(targetRemoteMic);
      realtimeModelRef.current = realtimeSession.model;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;
      streamIdRef.current = `${targetRemoteMic.role}:${Date.now()}:${crypto.randomUUID()}`;
      try {
        levelStopRef.current = startLevelMeter(stream, (nextLevel) => {
          setLevel(nextLevel);
        });
      } catch {
        levelStopRef.current = null;
        setLevel(0);
      }

      const peerConnection = new RTCPeerConnection();
      peerConnectionRef.current = peerConnection;
      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () => {
        setConnectionLabel("接続済み");
        setServerLabel("文字起こし中");
      };
      dataChannel.onmessage = (event) => {
        handleRealtimeEvent(targetRemoteMic, event.data);
      };
      dataChannel.onerror = (event) => {
        console.warn("[remote-mic realtime data channel error]", event);
        setConnectionLabel("データ接続エラー");
      };
      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (state === "failed" || state === "disconnected" || state === "closed") {
          setConnectionLabel("切断");
        }
      };

      for (const track of stream.getAudioTracks()) {
        track.enabled = !isAiSpeechBlockingCapture();
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

      recordingActiveRef.current = true;
      setPermissionLabel("許可済み");
      setMicState("streaming");
      setServerLabel("文字起こし中");
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
      setConnectionLabel("未接続");
    } finally {
      startInFlightRef.current = false;
    }
  }

  function handleRealtimeEvent(session: RemoteMicSession, rawData: unknown) {
    if (typeof rawData !== "string") return;

    let event: RealtimeEvent;
    try {
      event = JSON.parse(rawData) as RealtimeEvent;
    } catch {
      return;
    }

    const type = event.type ?? "";
    if (type === "input_audio_buffer.speech_started") {
      if (isAiSpeechBlockingCapture()) return;
      const transcriptId = getTranscriptId(event);
      speechStartedAtByTranscriptRef.current.set(transcriptId, Date.now());
      sendRelayEvent({
        type: "speech_started",
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        revision: nextTranscriptRevision(transcriptId),
        text: "",
        startedAt: getTranscriptStartedAt(transcriptId),
      });
      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      if (isAiSpeechBlockingCapture()) return;
      const transcriptId = getTranscriptId(event);
      const delta = event.delta ?? "";
      if (!delta) return;

      const previous = partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      const text = `${previous}${delta}`;
      partialTextByTranscriptRef.current.set(transcriptId, text);
      const firstPartialAt = logFirstDeltaLatency(transcriptId, session);
      sendRelayEvent({
        type: "partial",
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        revision: nextTranscriptRevision(transcriptId),
        text,
        startedAt: getTranscriptStartedAt(transcriptId),
      });
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptId = getTranscriptId(event);
      const text =
        event.transcript ?? partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      const startedAt = getTranscriptStartedAt(transcriptId);
      const firstPartialAt = getFirstPartialAt(transcriptId);
      const endedAt = new Date().toISOString();
      clearTranscriptState(transcriptId);

      if (isAiSpeechBlockingCapture()) {
        console.info("[remote-mic final transcript skipped during ai speech]", {
          sessionId: session.sessionId,
          role: session.role,
          transcriptId,
        });
        return;
      }

      console.info("[remote-mic final transcript latency]", {
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        latencyMs: startedAt ? Date.now() - new Date(startedAt).getTime() : null,
      });
      const finalEvent = {
        type: "final" as const,
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        revision: nextTranscriptRevision(transcriptId),
        text,
        startedAt,
        endedAt,
      };
      pendingFinalByTranscriptRef.current.set(transcriptId, {
        ...finalEvent,
        firstPartialAt,
        saveAttempts: 0,
      });
      sendRelayEvent(finalEvent);
      void saveFinalTranscriptWithRetry(transcriptId, {
        eventId: event.event_id,
        firstPartialAt,
        finalizedAt: endedAt,
      });
      return;
    }

    if (type === "error") {
      console.warn("[remote-mic realtime error]", event);
      setConnectionLabel("Realtimeエラー");
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

  function getTranscriptStartedAt(transcriptId: string) {
    const startedAt = speechStartedAtByTranscriptRef.current.get(transcriptId);
    return startedAt ? new Date(startedAt).toISOString() : undefined;
  }

  function getFirstPartialAt(transcriptId: string) {
    const firstPartialAt = firstDeltaAtByTranscriptRef.current.get(transcriptId);
    return firstPartialAt ? new Date(firstPartialAt).toISOString() : undefined;
  }

  function nextTranscriptRevision(transcriptId: string) {
    const nextRevision = (revisionByTranscriptRef.current.get(transcriptId) ?? 0) + 1;
    revisionByTranscriptRef.current.set(transcriptId, nextRevision);
    return nextRevision;
  }

  function connectRelayWebSocket(session: RemoteMicSession) {
    if (
      relayWebSocketRef.current &&
      relayWebSocketRef.current.readyState <= WebSocket.OPEN &&
      relayConnectedSessionRef.current?.sessionId === session.sessionId &&
      relayConnectedSessionRef.current.role === session.role
    ) {
      return;
    }

    closeRelayWebSocket(false);
    relayConnectedSessionRef.current = session;
    const socket = new WebSocket(
      buildRemoteMicRelayUrl({
        sessionId: session.sessionId,
        role: session.role,
        clientType: "producer",
      }),
    );
    relayWebSocketRef.current = socket;

    socket.onopen = () => {
      setConnectionLabel("接続済み");
      flushRelayEvents();
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as RemoteMicWsTranscriptEvent;
        if (message.type === "error") {
          console.warn("[remote-mic ws relay error]", message);
        }
      } catch {}
    };
    socket.onerror = (event) => {
      console.warn("[remote-mic ws relay socket error]", event);
    };
    socket.onclose = () => {
      if (relayWebSocketRef.current === socket) {
        relayWebSocketRef.current = null;
      }
      if (recordingActiveRef.current || startInFlightRef.current) {
        scheduleRelayReconnect();
      }
    };
  }

  function scheduleRelayReconnect() {
    if (relayReconnectTimerRef.current !== null) return;
    relayReconnectTimerRef.current = window.setTimeout(() => {
      relayReconnectTimerRef.current = null;
      const session = relayConnectedSessionRef.current ?? remoteMicRef.current;
      if (!session || (!recordingActiveRef.current && !startInFlightRef.current)) {
        return;
      }
      connectRelayWebSocket(session);
    }, REMOTE_MIC_WS_RECONNECT_MS);
  }

  function sendRelayEvent(event: RemoteMicWsTranscriptEvent) {
    if (event.type === "partial") {
      latestPartialByTranscriptRef.current.set(event.transcriptId, event);
    }
    if (event.type === "final") {
      latestPartialByTranscriptRef.current.delete(event.transcriptId);
    }

    const socket = relayWebSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return;
    }

    scheduleRelayReconnect();
  }

  function flushRelayEvents() {
    for (const event of latestPartialByTranscriptRef.current.values()) {
      relayWebSocketRef.current?.send(JSON.stringify(event));
    }
    for (const event of pendingFinalByTranscriptRef.current.values()) {
      relayWebSocketRef.current?.send(JSON.stringify(toRelayFinalEvent(event)));
    }
  }

  function closeRelayWebSocket(clearPending: boolean) {
    if (relayReconnectTimerRef.current !== null) {
      window.clearTimeout(relayReconnectTimerRef.current);
      relayReconnectTimerRef.current = null;
    }
    relayWebSocketRef.current?.close();
    relayWebSocketRef.current = null;
    relayConnectedSessionRef.current = null;
    if (clearPending) {
      latestPartialByTranscriptRef.current.clear();
      pendingFinalByTranscriptRef.current.clear();
    }
  }

  function toRelayFinalEvent(
    event: RemoteMicWsTranscriptEvent & {
      firstPartialAt?: string;
      saveAttempts: number;
    },
  ): RemoteMicWsTranscriptEvent {
    return {
      type: "final",
      sessionId: event.sessionId,
      role: event.role,
      transcriptId: event.transcriptId,
      revision: event.revision,
      text: event.text,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
    };
  }

  async function muteMicrophone() {
    await stop();
  }

  async function stop(notifyServer = true) {
    resumeAfterAiSpeechRef.current = false;
    await stopRealtimeConnection();
    setConnectionLabel("未接続");
    setLevel(0);
    setMicState("idle");

    if (notifyServer) {
      await setFixedMicMuted(true).catch(() => undefined);
      setServerLabel("停止中");
    }
  }

  async function stopRealtimeConnection() {
    recordingActiveRef.current = false;
    closeRelayWebSocket(false);
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    clearTranscriptState();

    levelStopRef.current?.();
    levelStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    streamRef.current = null;
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
    transcriptId: string,
    input: {
      eventId?: string;
      firstPartialAt?: string;
      finalizedAt?: string;
    },
  ) {
    const pending = pendingFinalByTranscriptRef.current.get(transcriptId);
    if (!pending) return;
    pending.saveAttempts += 1;
    const current = remoteMicRef.current;
    const text = pending.text.trim();
    if (!current || !text) return;

    const response = await fetch("/api/remote-mic/realtime/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: current.sessionId,
        role: current.role,
        streamId: streamIdRef.current,
        transcriptId,
        text,
        status: "final",
        eventId: input.eventId,
        startedAt: pending.startedAt,
        firstPartialAt: input.firstPartialAt,
        endedAt: pending.endedAt,
        finalizedAt: input.finalizedAt,
        model: realtimeModelRef.current,
        aiPlaybackIdAtCapture: aiSpeechStateRef.current.playbackId,
      }),
    });

    if (!response.ok) {
      console.warn("[remote-mic final transcript save failed]", {
        transcriptId,
        status: response.status,
        attempts: pending.saveAttempts,
      });
      if (pending.saveAttempts < MAX_FINAL_SAVE_RETRY_COUNT) {
        window.setTimeout(() => {
          void saveFinalTranscriptWithRetry(transcriptId, input);
        }, FINAL_SAVE_RETRY_MS);
      }
      return;
    }

    pendingFinalByTranscriptRef.current.delete(transcriptId);
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

function buildRemoteMicRelayUrl(input: {
  sessionId: string;
  role?: RemoteMicRole;
  clientType: RemoteMicWsClientType;
}) {
  const configuredUrl = process.env.NEXT_PUBLIC_REMOTE_MIC_WS_URL?.trim();
  const baseUrl = configuredUrl || getDefaultRemoteMicRelayUrl(window.location);
  const url = new URL(baseUrl);
  url.searchParams.set("sessionId", input.sessionId);
  url.searchParams.set("clientType", input.clientType);
  if (input.role) {
    url.searchParams.set("role", input.role);
  }
  return url.toString();
}

function getDefaultRemoteMicRelayUrl(location: Location) {
  if (location.protocol === "https:" && location.hostname.endsWith(".ts.net")) {
    return `wss://${location.host}/remote-mic-ws`;
  }
  return `ws://${location.hostname || "localhost"}:3010/remote-mic-ws`;
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

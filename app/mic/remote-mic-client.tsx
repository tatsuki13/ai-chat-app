"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RemoteMicRole = "elder" | "caregiver";
type RemoteMicSession = {
  sessionId: string;
  role: RemoteMicRole;
  participantCode: string | null;
  dialogueStartedAt: string | null;
};
type MicState = "idle" | "requesting" | "streaming";
type RealtimeEvent = {
  type?: string;
  event_id?: string;
  item_id?: string;
  item?: { id?: string };
  delta?: string;
  transcript?: string;
};
type RemoteMicTranscriptionProvider = "browser" | "openai";
type AiSpeechEvent = {
  type?: string;
  sessionId?: string;
  playbackId?: string | null;
  contentType?: string | null;
  revision?: number;
  timestamp?: string;
  releaseAfter?: string | null;
};
type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0?: {
    transcript?: string;
  };
};
type BrowserSpeechRecognitionResultList = {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
};
type BrowserSpeechRecognitionEvent = Event & {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
};
type BrowserSpeechRecognitionErrorEvent = Event & {
  error?: string;
  message?: string;
};
type BrowserSpeechRecognition = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
};

const SESSION_CHECK_TIMEOUT_MS = 8_000;
const CLIENT_VERSION = "remote-mic-client-2026-08-24-realtime";
const TRANSCRIPTION_PROVIDER: RemoteMicTranscriptionProvider =
  process.env.NEXT_PUBLIC_REMOTE_MIC_TRANSCRIPTION_PROVIDER === "browser"
    ? "browser"
    : "openai";
const AI_SPEECH_RELEASE_DELAY_MS = 500;
const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45_000;

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
  const [level, setLevel] = useState(0);
  const [connectionLabel, setConnectionLabel] = useState("未接続");
  const [aiSpeechLabel, setAiSpeechLabel] = useState("通常受付");
  const [openUrlLabel, setOpenUrlLabel] = useState("確認中");
  const [browserLabel, setBrowserLabel] = useState("確認中");
  const [httpsUrl, setHttpsUrl] = useState("");
  const [helpText, setHelpText] = useState("");
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const levelStopRef = useRef<(() => void) | null>(null);
  const recordingActiveRef = useRef(false);
  const remoteMicRef = useRef<RemoteMicSession | null>(null);
  const micStateRef = useRef<MicState>("idle");
  const speechRecognitionStopRequestedRef = useRef(false);
  const partialTextByTranscriptRef = useRef<Map<string, string>>(new Map());
  const speechStartedAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const firstDeltaAtByTranscriptRef = useRef<Map<string, number>>(new Map());
  const aiSpeechStateRef = useRef<{
    active: boolean;
    playbackId: string | null;
    revision: number;
    releaseUntil: number;
  }>({
    active: false,
    playbackId: null,
    revision: 0,
    releaseUntil: 0,
  });
  const aiSpeechReleaseTimerRef = useRef<number | null>(null);
  const aiSpeechSafetyTimerRef = useRef<number | null>(null);

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
    micStateRef.current = micState;
  }, [micState]);

  function handleAiSpeechEvent(event: AiSpeechEvent) {
    if (!remoteMic?.sessionId || event.sessionId !== remoteMic.sessionId) return;

    const revision = typeof event.revision === "number" ? event.revision : 0;
    if (revision < aiSpeechStateRef.current.revision) return;

    if (event.type === "ai_speech_snapshot") {
      if (event.playbackId && event.releaseAfter) {
        const releaseUntil = new Date(event.releaseAfter).getTime();
        if (Date.now() < releaseUntil) {
          pauseCaptureForAiSpeech(event.playbackId, revision, releaseUntil);
        }
      }
      return;
    }

    if (event.type === "ai_speech_start" && event.playbackId) {
      pauseCaptureForAiSpeech(
        event.playbackId,
        revision,
        Date.now() + AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS,
      );
      return;
    }

    if (
      (event.type === "ai_speech_end" || event.type === "ai_speech_cancel") &&
      event.playbackId
    ) {
      if (event.playbackId !== aiSpeechStateRef.current.playbackId) return;
      const releaseUntil = event.releaseAfter
        ? new Date(event.releaseAfter).getTime()
        : Date.now() + AI_SPEECH_RELEASE_DELAY_MS;
      releaseCaptureAfterAiSpeech(revision, releaseUntil);
    }
  }

  function pauseCaptureForAiSpeech(
    playbackId: string,
    revision: number,
    releaseUntil: number,
  ) {
    aiSpeechStateRef.current = {
      active: true,
      playbackId,
      revision,
      releaseUntil,
    };
    setAiSpeechLabel("AI音声中のため一時停止");
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    clearPartialTranscriptState();
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
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
      if (recordingActiveRef.current) {
        void setFixedMicMuted(false).catch(() => undefined);
      } else if (remoteMicRef.current && micStateRef.current === "idle") {
        void start();
      }
      setAiSpeechLabel("通常受付");
    }, delayMs);
  }

  function clearPartialTranscriptState() {
    partialTextByTranscriptRef.current.clear();
    speechStartedAtByTranscriptRef.current.clear();
    firstDeltaAtByTranscriptRef.current.clear();
  }

  function isAiSpeechBlockingCapture() {
    const state = aiSpeechStateRef.current;
    return state.active || Date.now() <= state.releaseUntil;
  }

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

    if (!nextSecureContext) {
      setHelpText(getInsecureContextHelp());

      if (maybeHttpsUrl) {
        window.setTimeout(() => {
          window.location.replace(maybeHttpsUrl);
        }, 800);
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
      setAiSpeechLabel("AI音声状態の確認待ち");
    };

    return () => {
      source.close();
    };
  }, [remoteMic?.sessionId]);

  async function loadActiveSession(
    role: RemoteMicRole | null,
    options: { quiet?: boolean } = {},
  ) {
    if (!role) {
      setServerLabel("役割未設定");
      setError("/mic/elder または /mic/caregiver で開いてください。");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, SESSION_CHECK_TIMEOUT_MS);

    try {
      const data = await fetchCurrentSession(role, controller.signal);
      if (!data.active) {
        setRemoteMic(null);
        setServerLabel("PC待機中");
        return;
      }

      setRemoteMic({
        sessionId: data.active.sessionId,
        participantCode: data.active.participantCode,
        dialogueStartedAt: data.active.dialogueStartedAt,
        role: data.role,
      });
      if (!options.quiet) setError("");
      setServerLabel("接続準備完了");
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
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function start() {
    if (!canStart || !remoteMic) return;

    setError("");
    setPermissionLabel("確認中");
    setConnectionLabel("接続中");
    setMicState("requesting");

    try {
      if (!window.isSecureContext) {
        throw new Error(
          "HTTPSで接続してください。Tailscale ServeのHTTPS URLから開いてください。",
        );
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではマイクを利用できません。");
      }
      if (TRANSCRIPTION_PROVIDER === "browser") {
        await startBrowserSpeechRecognition(remoteMic);
        return;
      }
      if (typeof RTCPeerConnection === "undefined") {
        throw new Error(
          "このブラウザではRealtime接続を利用できません。ChromeまたはSafariで開いてください。",
        );
      }

      const realtimeSession = await createRealtimeSession(remoteMic);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;
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
        handleRealtimeEvent(remoteMic, event.data);
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
        peerConnection.addTrack(track, stream);
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      if (!offer.sdp) {
        throw new Error("Realtime接続のofferを作成できませんでした。");
      }

      const answerSdp = await createRealtimeCall(
        realtimeSession.clientSecret,
        offer.sdp,
      );
      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      recordingActiveRef.current = true;
      setPermissionLabel("許可済み");
      setMicState("streaming");
      await setFixedMicMuted(false);
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
      await stop(false);
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
      logFirstDeltaLatency(transcriptId, session);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcriptId = getTranscriptId(event);
      if (isAiSpeechBlockingCapture()) {
        partialTextByTranscriptRef.current.delete(transcriptId);
        speechStartedAtByTranscriptRef.current.delete(transcriptId);
        firstDeltaAtByTranscriptRef.current.delete(transcriptId);
        console.info("[remote-mic final transcript skipped during ai speech]", {
          sessionId: session.sessionId,
          role: session.role,
          transcriptId,
          playbackId: aiSpeechStateRef.current.playbackId,
        });
        return;
      }
      const text =
        event.transcript ?? partialTextByTranscriptRef.current.get(transcriptId) ?? "";
      partialTextByTranscriptRef.current.delete(transcriptId);
      const startedAt = speechStartedAtByTranscriptRef.current.get(transcriptId);
      const firstDeltaAt = firstDeltaAtByTranscriptRef.current.get(transcriptId);
      speechStartedAtByTranscriptRef.current.delete(transcriptId);
      firstDeltaAtByTranscriptRef.current.delete(transcriptId);
      const transcriptStartedAt = startedAt ?? firstDeltaAt;
      console.info("[remote-mic final transcript latency]", {
        sessionId: session.sessionId,
        role: session.role,
        transcriptId,
        latencyMs: transcriptStartedAt ? Date.now() - transcriptStartedAt : null,
      });
      void postFinalTranscript(session, {
        transcriptId,
        text,
        eventId: event.event_id,
        startedAt: transcriptStartedAt
          ? new Date(transcriptStartedAt).toISOString()
          : undefined,
        aiPlaybackIdAtCapture: aiSpeechStateRef.current.playbackId,
        captureRevision: aiSpeechStateRef.current.revision,
      });
      return;
    }

    if (type === "error") {
      console.warn("[remote-mic realtime error]", event);
      setConnectionLabel("Realtimeエラー");
    }
  }

  function logFirstDeltaLatency(transcriptId: string, session: RemoteMicSession) {
    if (firstDeltaAtByTranscriptRef.current.has(transcriptId)) return;

    const firstDeltaAt = Date.now();
    firstDeltaAtByTranscriptRef.current.set(transcriptId, firstDeltaAt);
    const speechStartedAt = speechStartedAtByTranscriptRef.current.get(transcriptId);
    console.info("[remote-mic first transcript delta latency]", {
      sessionId: session.sessionId,
      role: session.role,
      transcriptId,
      latencyMs: speechStartedAt ? firstDeltaAt - speechStartedAt : null,
    });
  }

  async function startBrowserSpeechRecognition(session: RemoteMicSession) {
    const SpeechRecognitionClass = getBrowserSpeechRecognitionClass();
    if (!SpeechRecognitionClass) {
      throw new Error(
        "このブラウザではAIを使わない音声認識を利用できません。Chromeで開くか、OpenAI方式に戻してください。",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    streamRef.current = stream;
    try {
      levelStopRef.current = startLevelMeter(stream, (nextLevel) => {
        setLevel(nextLevel);
      });
    } catch {
      levelStopRef.current = null;
      setLevel(0);
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "ja-JP";
    speechRecognitionRef.current = recognition;
    speechRecognitionStopRequestedRef.current = false;

    recognition.onstart = () => {
      setConnectionLabel("ブラウザ認識中");
      setServerLabel("文字起こし中");
    };
    recognition.onerror = (event) => {
      console.warn("[remote-mic browser speech recognition error]", {
        error: event.error,
        message: event.message,
      });
      setConnectionLabel("音声認識エラー");
      setError(
        event.error === "service-not-allowed"
          ? "ブラウザ標準の音声認識サービスが許可されませんでした。Chromeで試すか、OpenAI方式に戻してください。"
          : event.message || event.error || "ブラウザ音声認識でエラーが発生しました。",
      );
    };
    recognition.onend = () => {
      if (!recordingActiveRef.current || speechRecognitionStopRequestedRef.current) {
        return;
      }

      window.setTimeout(() => {
        if (!recordingActiveRef.current || speechRecognitionStopRequestedRef.current) {
          return;
        }

        try {
          recognition.start();
        } catch {}
      }, 500);
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal) continue;

        const text = result[0]?.transcript?.trim() ?? "";
        if (!text) continue;
        if (isAiSpeechBlockingCapture()) {
          console.info("[remote-mic browser transcript skipped during ai speech]", {
            sessionId: session.sessionId,
            role: session.role,
            playbackId: aiSpeechStateRef.current.playbackId,
          });
          continue;
        }

        void postFinalTranscript(session, {
          transcriptId: `browser:${Date.now()}:${crypto.randomUUID()}`,
          text,
          aiPlaybackIdAtCapture: aiSpeechStateRef.current.playbackId,
          captureRevision: aiSpeechStateRef.current.revision,
        });
      }
    };

    recognition.start();
    recordingActiveRef.current = true;
    setPermissionLabel("許可済み");
    setMicState("streaming");
    await setFixedMicMuted(false);
    setServerLabel("文字起こし中");
  }

  async function muteMicrophone() {
    await stop();
  }

  async function stop(notifyServer = true) {
    recordingActiveRef.current = false;
    speechRecognitionStopRequestedRef.current = true;
    speechRecognitionRef.current?.abort();
    speechRecognitionRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    clearPartialTranscriptState();
    if (aiSpeechReleaseTimerRef.current !== null) {
      window.clearTimeout(aiSpeechReleaseTimerRef.current);
      aiSpeechReleaseTimerRef.current = null;
    }
    if (aiSpeechSafetyTimerRef.current !== null) {
      window.clearTimeout(aiSpeechSafetyTimerRef.current);
      aiSpeechSafetyTimerRef.current = null;
    }

    levelStopRef.current?.();
    levelStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setConnectionLabel("未接続");
    setLevel(0);
    setMicState("idle");

    if (notifyServer) {
      await setFixedMicMuted(true).catch(() => {});
      setServerLabel("停止中");
    }
  }

  async function setFixedMicMuted(muted: boolean) {
    if (!remoteMic) return;

    const response = await fetch("/api/remote-mic/fixed/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: remoteMic.sessionId,
        role: remoteMic.role,
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
        <div className="border-b border-stone-200 pb-3">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
            Remote microphone
          </div>
          <h1 className="mt-1 text-[22px] font-black leading-tight">{roleLabel}</h1>
        </div>

        <div className="mt-4 space-y-3">
          <StatusRow label="サーバー接続" value={serverLabel} />
          <StatusRow
            label="固定役割"
            value={fixedRole ? getRemoteMicRoleLabel(fixedRole) : "未設定"}
          />
          <StatusRow label="参加者ID" value={remoteMic?.participantCode || "PC待機中"} />
          <StatusRow label="表示URL" value={openUrlLabel} />
          <StatusRow label="ブラウザ" value={browserLabel} />
          <StatusRow label="安全判定" value={getSecureContextLabel(secureContext)} />
          <StatusRow
            label="マイクAPI"
            value={getMediaSupportLabel(mediaSupported, secureContext)}
          />
          <StatusRow
            label="WebRTC"
            value={getWebrtcSupportLabel(webrtcSupported, secureContext)}
          />
          <StatusRow
            label="文字起こし方式"
            value={getTranscriptionProviderLabel(TRANSCRIPTION_PROVIDER)}
          />
          <StatusRow label="Realtime" value={connectionLabel} />
          <StatusRow label="マイク権限" value={permissionLabel} />
          <StatusRow
            label="入力状態"
            value={
              aiSpeechStateRef.current.active
                ? "AI音声中は停止"
                : micState === "streaming"
                  ? "文字起こし中"
                  : "停止中"
            }
          />
          <StatusRow label="AI音声" value={aiSpeechLabel} />
          <div>
            <div className="mb-1 flex items-center justify-between text-[12px] font-black text-stone-600">
              <span>入力音量</span>
              <span>{Math.round(level * 100)}%</span>
            </div>
            <LevelBar value={level} />
          </div>
        </div>

        {error ? (
          <p className="mt-4 whitespace-pre-line rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
            {error}
          </p>
        ) : null}
        {helpText ? (
          <p className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] font-bold leading-relaxed text-amber-900">
            {helpText}
          </p>
        ) : null}
        {httpsUrl && !secureContext ? (
          <a
            href={httpsUrl}
            className="mt-3 block min-h-10 rounded-md border border-amber-300 bg-white px-3 py-2 text-center text-[13px] font-black text-amber-900 active:scale-[0.99]"
          >
            HTTPSで開き直す
          </a>
        ) : null}
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

async function postFinalTranscript(
  session: RemoteMicSession,
  input: {
    transcriptId: string;
    text: string;
    eventId?: string;
    startedAt?: string;
    aiPlaybackIdAtCapture?: string | null;
    captureRevision?: number;
  },
) {
  if (!input.text.trim()) return;

  const response = await fetch("/api/remote-mic/realtime/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: session.sessionId,
      role: session.role,
      transcriptId: input.transcriptId,
      text: input.text,
      status: "final",
      eventId: input.eventId,
      startedAt: input.startedAt,
      endedAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      aiPlaybackIdAtCapture: input.aiPlaybackIdAtCapture,
      captureRevision: input.captureRevision,
    }),
  });

  if (!response.ok) {
    throw new Error(`Transcript relay failed: ${response.status}`);
  }

  console.info("[remote-mic final transcript saved]", {
    sessionId: session.sessionId,
    role: session.role,
    transcriptId: input.transcriptId,
    textLength: input.text.length,
  });
}

function getTranscriptId(event: RealtimeEvent) {
  return event.item_id ?? event.item?.id ?? event.event_id ?? crypto.randomUUID();
}

function StatusRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-bold text-stone-500">{props.label}</span>
      <span className="text-right text-[13px] font-black text-stone-900">
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

function getSecureContextLabel(value: boolean) {
  if (value) return "安全な接続";
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "HTTPSですが安全判定されていません";
  }

  return "HTTPSが必要";
}

function getMediaSupportLabel(mediaSupported: boolean, secureContext: boolean) {
  if (mediaSupported) return "利用可能";
  if (secureContext) return "利用不可";

  return "安全判定待ち";
}

function getWebrtcSupportLabel(webrtcSupported: boolean, secureContext: boolean) {
  if (webrtcSupported) return "利用可能";
  if (secureContext) return "利用不可";

  return "安全判定待ち";
}

function getTranscriptionProviderLabel(provider: RemoteMicTranscriptionProvider) {
  return provider === "browser" ? "ブラウザ標準" : "OpenAI Realtime";
}

function getBrowserSpeechRecognitionClass() {
  const windowWithSpeechRecognition = window as WindowWithSpeechRecognition;

  return (
    windowWithSpeechRecognition.SpeechRecognition ??
    windowWithSpeechRecognition.webkitSpeechRecognition ??
    null
  );
}

function getFixedRemoteMicRole(
  explicitRole: RemoteMicRole | null,
): RemoteMicRole | null {
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

function getInsecureContextHelp() {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "URLはhttpsですが、この環境では安全なページとして扱われていません。SafariまたはChromeで固定マイクURLを直接開いてください。";
  }

  return "この画面はHTTPSで開く必要があります。Safariで https:// から始まるTailscale URLを開いてください。";
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
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

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
type WindowWithAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const CLIENT_VERSION = "remote-mic-client-2026-08-27-local-asr";
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const TARGET_SAMPLE_RATE = 16_000;
const FRAME_MS = 500;
const AI_SPEECH_RELEASE_DELAY_MS = 500;
const AI_SPEECH_CLIENT_SAFETY_TIMEOUT_MS = 45_000;
const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (input && input.length) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
`;

export default function RemoteMicClient(props: {
  initialRole?: RemoteMicRole | null;
}) {
  const [remoteMic, setRemoteMic] = useState<RemoteMicSession | null>(null);
  const [fixedRole, setFixedRole] = useState<RemoteMicRole | null>(null);
  const [micState, setMicState] = useState<MicState>("idle");
  const [secureContext, setSecureContext] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const [workletSupported, setWorkletSupported] = useState(false);
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  const frameSamplesRef = useRef<Int16Array[]>([]);
  const frameSampleCountRef = useRef(0);
  const sequenceRef = useRef(0);
  const streamIdRef = useRef("");
  const recordingActiveRef = useRef(false);
  const remoteMicRef = useRef<RemoteMicSession | null>(null);
  const fixedRoleRef = useRef<RemoteMicRole | null>(null);
  const micStateRef = useRef<MicState>("idle");
  const postingFrameRef = useRef(false);
  const pendingFramesRef = useRef<LocalPcmFrame[]>([]);
  const reconnectingAfterMismatchRef = useRef(false);
  const aiSpeechReleaseTimerRef = useRef<number | null>(null);
  const aiSpeechSafetyTimerRef = useRef<number | null>(null);
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
    micStateRef.current = micState;
  }, [micState]);

  useEffect(() => {
    fixedRoleRef.current = fixedRole;
  }, [fixedRole]);

  useEffect(() => {
    const nextSecureContext = window.isSecureContext;
    const nextMediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);
    const nextWorkletSupported = Boolean(getAudioContextClass() && window.AudioWorkletNode);

    setSecureContext(nextSecureContext);
    setMediaSupported(nextMediaSupported);
    setWorkletSupported(nextWorkletSupported);
    setOpenUrlLabel(`${window.location.protocol}//${window.location.host}`);
    setBrowserLabel(getBrowserLabel(navigator.userAgent));
    console.info("[remote-mic client]", { version: CLIENT_VERSION });

    const maybeHttpsUrl = getHttpsUrl(window.location.href);
    setHttpsUrl(maybeHttpsUrl);
    if (!nextSecureContext) {
      setHelpText(getInsecureContextHelp());
      if (maybeHttpsUrl) {
        window.setTimeout(() => window.location.replace(maybeHttpsUrl), 800);
      }
    } else if (!nextMediaSupported || !nextWorkletSupported) {
      setHelpText("このブラウザではローカルASR用の音声入力を利用できません。ChromeまたはSafariで固定マイクURLを開いてください。");
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
      setAiSpeechLabel("AI音声状態を再接続中");
    };

    return () => {
      source.close();
    };
  }, [remoteMic?.sessionId]);

  function handleAiSpeechEvent(event: AiSpeechEvent) {
    if (!remoteMic?.sessionId || event.sessionId !== remoteMic.sessionId) return;

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
    aiSpeechStateRef.current = {
      active: true,
      playbackId,
      revision,
      releaseUntil: 0,
    };
    setAiSpeechLabel("AI音声中のため一時停止");
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    clearAudioFrameBuffer();
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

  function isAiSpeechBlockingCapture() {
    const state = aiSpeechStateRef.current;
    return state.active || Date.now() <= state.releaseUntil;
  }

  function clearAudioFrameBuffer() {
    frameSamplesRef.current = [];
    frameSampleCountRef.current = 0;
  }

  function takeFrameSamples(sampleCount: number) {
    return takeFrameSamplesFromBuffers(
      frameSamplesRef.current,
      frameSampleCountRef,
      sampleCount,
    );
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
    if (!targetRemoteMic || micStateRef.current !== "idle") return;

    setError("");
    setPermissionLabel("確認中");
    setConnectionLabel("接続中");
    setMicState("requesting");

    try {
      if (!window.isSecureContext) {
        throw new Error("HTTPSで接続してください。Tailscale ServeのHTTPS URLから開いてください。");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではマイクを利用できません。");
      }
      const AudioContextClass = getAudioContextClass();
      if (!AudioContextClass || !window.AudioWorkletNode) {
        throw new Error("このブラウザではローカルASR用のAudioWorkletを利用できません。");
      }

      const health = await fetch("/api/remote-mic/local/health", { cache: "no-store" });
      if (!health.ok) {
        throw new Error("ローカル文字起こしサービスに接続できません。Local ASR Workerを起動してください。");
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
      streamIdRef.current = `${targetRemoteMic.role}:${Date.now()}:${crypto.randomUUID()}`;
      sequenceRef.current = 0;

      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      const workletUrl = URL.createObjectURL(
        new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
      );
      workletUrlRef.current = workletUrl;
      await audioContext.audioWorklet.addModule(workletUrl);

      const source = audioContext.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(audioContext, "pcm-capture-processor");
      audioSourceRef.current = source;
      workletNodeRef.current = node;
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!recordingActiveRef.current || isAiSpeechBlockingCapture()) return;
        handleAudioSamples(event.data, audioContext.sampleRate);
      };
      source.connect(node);
      node.connect(audioContext.destination);

      recordingActiveRef.current = true;
      setPermissionLabel("許可済み");
      setMicState("streaming");
      setConnectionLabel("送信中");
      setServerLabel("ローカル文字起こし中");
      await setFixedMicMuted(false, targetRemoteMic);
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

  function handleAudioSamples(samples: Float32Array, sampleRate: number) {
    const pcm = convertFloat32ToPcm16(downsample(samples, sampleRate, TARGET_SAMPLE_RATE));
    frameSamplesRef.current.push(pcm);
    frameSampleCountRef.current += pcm.length;

    const frameSampleTarget = Math.round((TARGET_SAMPLE_RATE * FRAME_MS) / 1000);
    while (frameSampleCountRef.current >= frameSampleTarget) {
      const framePcm = takeFrameSamples(frameSampleTarget);
      const stats = getPcmStats(framePcm);
      setLevel(stats.peakLevel);
      enqueueFrame({
        sessionId: remoteMicRef.current?.sessionId ?? "",
        role: remoteMicRef.current?.role ?? "elder",
        streamId: streamIdRef.current,
        sequence: sequenceRef.current,
        capturedAt: new Date().toISOString(),
        durationMs: FRAME_MS,
        sampleRate: TARGET_SAMPLE_RATE,
        averageLevel: stats.averageLevel,
        peakLevel: stats.peakLevel,
        pcmBase64: int16ToBase64(framePcm),
      });
      sequenceRef.current += 1;
    }
  }

  function enqueueFrame(frame: LocalPcmFrame) {
    if (!frame.sessionId || !frame.streamId) return;
    pendingFramesRef.current.push(frame);
    void flushFrames();
  }

  async function flushFrames() {
    if (postingFrameRef.current) return;
    postingFrameRef.current = true;

    try {
      while (pendingFramesRef.current.length > 0 && recordingActiveRef.current) {
        const frame = pendingFramesRef.current.shift();
        if (!frame) continue;
        const response = await postFrame(frame);
        if (!response.ok) {
          if (response.status === 409) {
            await recoverFromActiveSessionMismatch();
            return;
          }
          throw new Error(`Local ASR frame failed: ${response.status}`);
        }
        const data = (await response.json()) as {
          saved?: unknown[];
          skipped?: boolean;
          reason?: string;
        };
        if (Array.isArray(data.saved) && data.saved.length > 0) {
          setServerLabel("発話を保存しました");
        } else if (data.skipped && data.reason === "ai_speech_active") {
          setServerLabel("AI音声中のため一時停止");
        } else {
          setServerLabel("ローカル文字起こし中");
        }
      }
    } catch (frameError) {
      console.warn("[remote-mic local frame failed]", frameError);
      setConnectionLabel("送信エラー");
      setError(
        frameError instanceof Error
          ? frameError.message
          : "ローカル文字起こしサービスへの送信に失敗しました。",
      );
      await stop(false);
    } finally {
      postingFrameRef.current = false;
    }
  }

  async function postFrame(frame: LocalPcmFrame) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch("/api/remote-mic/local/frame", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(frame),
        });
        if (response.status !== 500 && response.status !== 502 && response.status !== 503) {
          return response;
        }
        lastError = new Error(`Local ASR frame failed: ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      await wait(300);
    }

    throw lastError instanceof Error ? lastError : new Error("Local ASR frame failed");
  }

  async function recoverFromActiveSessionMismatch() {
    if (reconnectingAfterMismatchRef.current) return;
    reconnectingAfterMismatchRef.current = true;

    try {
      setConnectionLabel("蜀肴磁邯壻ｸｭ");
      setServerLabel("PC蛛ｴ縺ｮ譁ｰsession繧堤｢ｺ隱堺ｸｭ");
      await stop(false);
      const nextRemoteMic = await loadActiveSession(fixedRoleRef.current, { quiet: true });
      if (nextRemoteMic) {
        await start(nextRemoteMic);
      }
    } finally {
      reconnectingAfterMismatchRef.current = false;
    }
  }

  async function muteMicrophone() {
    await stop();
  }

  async function stop(notifyServer = true) {
    const shouldFlush = Boolean(
      notifyServer &&
        recordingActiveRef.current &&
        remoteMicRef.current &&
        streamIdRef.current,
    );
    recordingActiveRef.current = false;
    pendingFramesRef.current = [];
    clearAudioFrameBuffer();
    if (shouldFlush) {
      await flushCurrentStream().catch((flushError) => {
        console.warn("[remote-mic local flush failed]", flushError);
      });
    }
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    await audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    if (workletUrlRef.current) {
      URL.revokeObjectURL(workletUrlRef.current);
      workletUrlRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (aiSpeechReleaseTimerRef.current !== null) {
      window.clearTimeout(aiSpeechReleaseTimerRef.current);
      aiSpeechReleaseTimerRef.current = null;
    }
    if (aiSpeechSafetyTimerRef.current !== null) {
      window.clearTimeout(aiSpeechSafetyTimerRef.current);
      aiSpeechSafetyTimerRef.current = null;
    }
    setConnectionLabel("未接続");
    setLevel(0);
    setMicState("idle");

    if (notifyServer) {
      await setFixedMicMuted(true).catch(() => undefined);
      setServerLabel("停止中");
    }
  }

  async function flushCurrentStream() {
    const current = remoteMicRef.current;
    const streamId = streamIdRef.current;
    if (!current || !streamId) return;

    const response = await fetch("/api/remote-mic/local/flush", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: current.sessionId,
        role: current.role,
        streamId,
      }),
    });

    if (!response.ok && response.status !== 409) {
      throw new Error(`Local ASR flush failed: ${response.status}`);
    }
  }

  async function setFixedMicMuted(muted: boolean, targetRemoteMic = remoteMicRef.current) {
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
              ローカルASRへ音声を送信します。
            </p>
          </div>
          <div
            className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
              micState === "streaming"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-stone-100 text-stone-600"
            }`}
          >
            {micState === "streaming" ? "送信中" : micState === "requesting" ? "確認中" : "停止中"}
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
          <StatusRow label="AudioWorklet" value={workletSupported ? "利用可能" : "利用不可"} />
          <StatusRow label="文字起こし方式" value="Local ASR Worker" />
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
}

type LocalPcmFrame = {
  sessionId: string;
  role: RemoteMicRole;
  streamId: string;
  sequence: number;
  capturedAt: string;
  durationMs: number;
  sampleRate: number;
  averageLevel: number;
  peakLevel: number;
  pcmBase64: string;
};

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

function downsample(input: Float32Array, inputRate: number, outputRate: number) {
  if (inputRate === outputRate) return input;
  if (inputRate < outputRate) return input;

  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex] ?? 0;
    }
    output[outputIndex] = sum / Math.max(1, end - start);
  }

  return output;
}

function convertFloat32ToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function getPcmStats(pcm: Int16Array) {
  if (pcm.length === 0) return { averageLevel: 0, peakLevel: 0 };

  let sum = 0;
  let peak = 0;
  for (const sample of pcm) {
    const normalized = Math.abs(sample) / 32768;
    sum += normalized;
    peak = Math.max(peak, normalized);
  }

  return {
    averageLevel: sum / pcm.length,
    peakLevel: peak,
  };
}

function takeFrameSamplesFromBuffers(
  buffers: Int16Array[],
  sampleCountRef: { current: number },
  sampleCount: number,
) {
  const output = new Int16Array(sampleCount);
  let offset = 0;

  while (offset < sampleCount && buffers.length > 0) {
    const current = buffers[0];
    const remaining = sampleCount - offset;
    if (current.length <= remaining) {
      output.set(current, offset);
      offset += current.length;
      buffers.shift();
    } else {
      output.set(current.subarray(0, remaining), offset);
      buffers[0] = current.subarray(remaining);
      offset += remaining;
    }
  }

  sampleCountRef.current = Math.max(0, sampleCountRef.current - sampleCount);
  return output;
}

function int16ToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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

function getAudioContextClass() {
  return window.AudioContext ?? (window as WindowWithAudioContext).webkitAudioContext ?? null;
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

function getInsecureContextHelp() {
  return "スマートフォンのマイクはHTTPSでのみ利用できます。Tailscale ServeなどのHTTPS URLで開いてください。";
}

function getBrowserLabel(userAgent: string) {
  if (/CriOS|Chrome/i.test(userAgent)) return "Chrome";
  if (/Safari/i.test(userAgent)) return "Safari";
  return "Browser";
}

function getFixedRemoteMicRole(explicitRole: RemoteMicRole | null): RemoteMicRole | null {
  if (explicitRole) {
    window.localStorage.setItem("fixed-remote-mic-role", explicitRole);
    return explicitRole;
  }

  const path = window.location.pathname;
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

function isPermissionError(error: unknown) {
  if (!(error instanceof DOMException)) return false;

  return error.name === "NotAllowedError" || error.name === "PermissionDeniedError";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

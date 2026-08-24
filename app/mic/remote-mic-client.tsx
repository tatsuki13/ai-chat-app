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
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        results: {
          length: number;
          [index: number]: {
            isFinal: boolean;
            [index: number]: { transcript: string };
          };
        };
        resultIndex: number;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type QueuedText = {
  sessionId: string;
  role: RemoteMicRole;
  text: string;
  recognizedAt: string;
  clientTextId: string;
};

const HEARTBEAT_MS = 15_000;
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const CLIENT_VERSION = "remote-mic-client-2026-08-24-speech-recognition";

export default function RemoteMicClient(props: {
  initialRole?: RemoteMicRole | null;
}) {
  const [remoteMic, setRemoteMic] = useState<RemoteMicSession | null>(null);
  const [fixedRole, setFixedRole] = useState<RemoteMicRole | null>(null);
  const [micState, setMicState] = useState<MicState>("idle");
  const [secureContext, setSecureContext] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [permissionLabel, setPermissionLabel] = useState("未確認");
  const [serverLabel, setServerLabel] = useState("確認中");
  const [level, setLevel] = useState(0);
  const [recorderLabel, setRecorderLabel] = useState("未確認");
  const [openUrlLabel, setOpenUrlLabel] = useState("確認中");
  const [browserLabel, setBrowserLabel] = useState("確認中");
  const [httpsUrl, setHttpsUrl] = useState("");
  const [helpText, setHelpText] = useState("");
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const levelStopRef = useRef<(() => void) | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recordingActiveRef = useRef(false);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());

  const roleLabel = useMemo(() => {
    if (remoteMic?.role === "elder") return "本人用マイク";
    if (remoteMic?.role === "caregiver") return "介護者用マイク";
    return "スマートフォンマイク";
  }, [remoteMic?.role]);
  const canStart = Boolean(remoteMic) && micState === "idle";

  useEffect(() => {
    const nextSecureContext = window.isSecureContext;
    const nextMediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);
    const nextSpeechSupported = Boolean(getSpeechRecognitionClass());

    setSecureContext(nextSecureContext);
    setMediaSupported(nextMediaSupported);
    setSpeechSupported(nextSpeechSupported);
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
    } else if (!nextMediaSupported || !nextSpeechSupported) {
      setHelpText(
        "このブラウザでは音声認識を利用できません。ChromeまたはSafariで固定マイクURLを開いてください。",
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
    setMicState("requesting");

    try {
      if (!window.isSecureContext) {
        throw new Error("HTTPSで接続してください。Tailscale ServeのHTTPS URLから開いてください。");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザではマイクを利用できません。");
      }

      const SpeechRecognitionClass = getSpeechRecognitionClass();
      if (!SpeechRecognitionClass) {
        throw new Error("このブラウザでは音声認識を利用できません。ChromeまたはSafariで開いてください。");
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
      recognition.onresult = (event) => {
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result?.isFinal) continue;

          const text = result[0]?.transcript?.trim() ?? "";
          if (!text) continue;

          enqueueRecognizedText({
            sessionId: remoteMic.sessionId,
            role: remoteMic.role,
            text,
            recognizedAt: new Date().toISOString(),
            clientTextId: crypto.randomUUID(),
          });
        }
      };
      recognition.onerror = (event) => {
        handleSpeechRecognitionError(event.error ?? "unknown", event.message ?? "");
      };
      recognition.onend = () => {
        if (!recordingActiveRef.current) return;

        window.setTimeout(() => {
          if (!recordingActiveRef.current) return;
          try {
            recognition.start();
          } catch {
            // The browser can reject immediate restarts while the previous session settles.
          }
        }, 250);
      };
      recognitionRef.current = recognition;
      recordingActiveRef.current = true;
      recognition.start();

      setPermissionLabel("許可済み");
      setMicState("streaming");
      setRecorderLabel("音声認識中");
      await setFixedMicMuted(false);
      setServerLabel("音声認識中");
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

  function enqueueRecognizedText(item: QueuedText) {
    console.info("[remote-mic final transcript]", {
      role: item.role,
      textLength: item.text.length,
      clientTextId: item.clientTextId,
    });
    sendQueueRef.current = sendQueueRef.current
      .catch(() => {})
      .then(() => sendRecognizedText(item));
  }

  async function sendRecognizedText(item: QueuedText) {
    const response = await fetch("/api/remote-mic/fixed/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });

    if (!response.ok) {
      throw new Error(`recognized text relay failed: ${response.status}`);
    }

    setServerLabel("認識結果送信済み");
  }

  function handleSpeechRecognitionError(errorCode: string, message: string) {
    console.warn("[remote-mic speech recognition error]", {
      error: errorCode,
      message,
    });

    if (errorCode === "no-speech" || errorCode === "aborted") {
      return;
    }

    if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
      setPermissionLabel("拒否");
      setError("音声認識またはマイクの利用が許可されていません。ブラウザの権限を確認してください。");
      void stop(false);
      return;
    }

    if (recordingActiveRef.current && (errorCode === "network" || errorCode === "audio-capture")) {
      setServerLabel("音声認識を再開中");
      return;
    }

    setError(`音声認識エラー: ${errorCode}`);
  }

  async function muteMicrophone() {
    await stop();
  }

  async function stop(notifyServer = true) {
    recordingActiveRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;

    levelStopRef.current?.();
    levelStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecorderLabel("マイクOFF");
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
          <StatusRow label="固定役割" value={fixedRole ? getRemoteMicRoleLabel(fixedRole) : "未設定"} />
          <StatusRow label="参加者ID" value={remoteMic?.participantCode || "PC待機中"} />
          <StatusRow label="表示URL" value={openUrlLabel} />
          <StatusRow label="ブラウザ" value={browserLabel} />
          <StatusRow label="安全判定" value={getSecureContextLabel(secureContext)} />
          <StatusRow label="マイクAPI" value={getMediaSupportLabel(mediaSupported, secureContext)} />
          <StatusRow label="音声認識API" value={getSpeechSupportLabel(speechSupported, secureContext)} />
          <StatusRow label="認識状態" value={recorderLabel} />
          <StatusRow label="マイク権限" value={permissionLabel} />
          <StatusRow label="入力状態" value={micState === "streaming" ? "認識中" : "停止中"} />
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
    throw new Error(`現在の対話セッションを確認できません。(${response.status})`);
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

function getSpeechRecognitionClass() {
  const maybeWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return maybeWindow.SpeechRecognition ?? maybeWindow.webkitSpeechRecognition ?? null;
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
    return "HTTPSだが安全判定なし";
  }

  return "HTTPSが必要";
}

function getMediaSupportLabel(mediaSupported: boolean, secureContext: boolean) {
  if (mediaSupported) return "利用可能";
  if (secureContext) return "利用不可";

  return "安全判定待ち";
}

function getSpeechSupportLabel(speechSupported: boolean, secureContext: boolean) {
  if (speechSupported) return "利用可能";
  if (secureContext) return "利用不可";

  return "安全判定待ち";
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type RemoteMicRole = "elder" | "caregiver";
type RemoteMicSession = {
  sessionId: string;
  role: RemoteMicRole;
  expiresAt: string;
};
type MicState = "idle" | "requesting" | "streaming";
type PendingChunk = {
  blob: Blob;
  capturedAt: number;
  durationMs: number;
  averageLevel: number;
  peakLevel: number;
};
type ChunkErrorDetail = {
  error?: string;
  stage?: string;
  detail?: string;
};

const CHUNK_MS = 2000;
const HEARTBEAT_MS = 15_000;
const SESSION_CHECK_TIMEOUT_MS = 8_000;
const MIN_SEND_AVERAGE_LEVEL = 0.008;
const MIN_SEND_PEAK_LEVEL = 0.03;
const MAX_PENDING_CHUNKS = 8;
const MAX_CONSECUTIVE_SERVER_FAILURES = 3;
const CLIENT_VERSION = "remote-mic-client-2026-07-30-segmented";

export default function RemoteMicClient() {
  const [remoteMic, setRemoteMic] = useState<RemoteMicSession | null>(null);
  const [micState, setMicState] = useState<MicState>("idle");
  const [secureContext, setSecureContext] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);
  const [permissionLabel, setPermissionLabel] = useState("未確認");
  const [serverLabel, setServerLabel] = useState("確認中");
  const [level, setLevel] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [lastSentAt, setLastSentAt] = useState("");
  const [recorderLabel, setRecorderLabel] = useState("未確認");
  const [openUrlLabel, setOpenUrlLabel] = useState("確認中");
  const [browserLabel, setBrowserLabel] = useState("確認中");
  const [httpsUrl, setHttpsUrl] = useState("");
  const [helpText, setHelpText] = useState("");
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const levelStopRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef(0);
  const sequenceRef = useRef(0);
  const mimeTypeRef = useRef("");
  const chunkLevelRef = useRef({ sum: 0, count: 0, peak: 0 });
  const sendingRef = useRef(false);
  const recordingActiveRef = useRef(false);
  const segmentTimerRef = useRef<number | null>(null);
  const pendingChunksRef = useRef<PendingChunk[]>([]);
  const consecutiveServerFailuresRef = useRef(0);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const answerPollTimerRef = useRef<number | null>(null);

  const roleLabel = useMemo(() => {
    if (remoteMic?.role === "elder") return "本人用マイク";
    if (remoteMic?.role === "caregiver") return "介護者用マイク";
    return "スマートフォンマイク";
  }, [remoteMic?.role]);
  const canStart = Boolean(remoteMic) && micState === "idle";

  useEffect(() => {
    const nextSecureContext = window.isSecureContext;
    const nextMediaSupported = Boolean(navigator.mediaDevices?.getUserMedia);

    setSecureContext(nextSecureContext);
    setMediaSupported(nextMediaSupported);
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
    } else if (!nextMediaSupported) {
      setHelpText(
        "HTTPSとしては開けていますが、マイクAPIが見えていません。QR読み取り後のカメラ内ブラウザではなく、右下の「…」からSafariで開いてください。",
      );
    }

    async function loadSession() {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, SESSION_CHECK_TIMEOUT_MS);

      try {
        const response = await fetch("/api/remote-mic/session", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `認証情報を確認できません。PC画面から新しいQRコードを発行してください。(${response.status})`,
          );
        }

        const data = (await response.json()) as { remoteMic: RemoteMicSession };
        setRemoteMic(data.remoteMic);
        setServerLabel("接続準備完了");
      } catch (loadError) {
        setServerLabel("未接続");
        setError(
          loadError instanceof DOMException && loadError.name === "AbortError"
            ? "サーバー接続確認がタイムアウトしました。Tailscale接続とSafariで開いているかを確認してください。"
            : loadError instanceof Error
              ? loadError.message
              : "マイク接続を確認できませんでした。",
        );
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadSession();

    return () => {
      void stop(false);
    };
  }, []);

  useEffect(() => {
    if (!remoteMic || micState !== "streaming") return;

    const timerId = window.setInterval(() => {
      void fetch("/api/remote-mic/heartbeat", { method: "POST" }).catch(() => {
        setServerLabel("通信が不安定です");
      });
    }, HEARTBEAT_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [remoteMic, micState]);

  async function start() {
    if (!canStart || !remoteMic) return;

    setError("");
    setPermissionLabel("確認中");
    setMicState("requesting");

    try {
      if (!window.isSecureContext) {
        throw new Error("HTTPSで接続してください。Tailscale ServeのHTTPS URLから開いてください。");
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("このブラウザーではマイク録音を利用できません。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const mimeType = getPreferredAudioMimeType();
      mimeTypeRef.current = mimeType;
      streamRef.current = stream;
      setRecorderLabel(mimeType || "ブラウザー標準");
      try {
        levelStopRef.current = startLevelMeter(stream, (nextLevel) => {
          setLevel(nextLevel);
          chunkLevelRef.current.sum += nextLevel;
          chunkLevelRef.current.count += 1;
          chunkLevelRef.current.peak = Math.max(chunkLevelRef.current.peak, nextLevel);
        });
      } catch {
        levelStopRef.current = null;
        setLevel(0);
      }

      recordingActiveRef.current = true;
      pendingChunksRef.current = [];
      sendingRef.current = false;
      consecutiveServerFailuresRef.current = 0;
      startedAtRef.current = Date.now();
      chunkLevelRef.current = { sum: 0, count: 0, peak: 0 };
      setPermissionLabel("許可済み");
      setMicState("streaming");
      setServerLabel("音声送信中");
      await startWebRtcMicrophone(stream);
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

  async function startWebRtcMicrophone(stream: MediaStream) {
    const peerConnection = new RTCPeerConnection();
    peerConnectionRef.current = peerConnection;

    for (const track of stream.getAudioTracks()) {
      peerConnection.addTrack(track, stream);
    }

    peerConnection.onconnectionstatechange = () => {
      if (
        peerConnection.connectionState === "connected" ||
        peerConnection.connectionState === "connecting"
      ) {
        setServerLabel("音声ストリーム送信中");
        return;
      }

      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "disconnected"
      ) {
        setServerLabel("音声ストリーム切断");
      }
    };

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection);

    const offerResponse = await fetch("/api/remote-mic/webrtc/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer: peerConnection.localDescription }),
    });

    if (!offerResponse.ok) {
      throw new Error(`音声ストリーム接続を開始できませんでした。(${offerResponse.status})`);
    }

    const data = (await offerResponse.json()) as { peerId: string };
    setServerLabel("PC側の受信準備を待っています");
    pollWebRtcAnswer(data.peerId, peerConnection);
  }

  function pollWebRtcAnswer(peerId: string, peerConnection: RTCPeerConnection) {
    if (answerPollTimerRef.current !== null) {
      window.clearInterval(answerPollTimerRef.current);
    }

    answerPollTimerRef.current = window.setInterval(() => {
      void fetch(
        `/api/remote-mic/webrtc/offer?peerId=${encodeURIComponent(peerId)}`,
        { cache: "no-store" },
      )
        .then((response) => {
          if (!response.ok) throw new Error(`answer poll failed: ${response.status}`);

          return response.json() as Promise<{
            answer: RTCSessionDescriptionInit | null;
          }>;
        })
        .then(async (data) => {
          if (!data.answer || peerConnection.remoteDescription) return;

          await peerConnection.setRemoteDescription(data.answer);
          if (answerPollTimerRef.current !== null) {
            window.clearInterval(answerPollTimerRef.current);
            answerPollTimerRef.current = null;
          }
          setServerLabel("音声ストリーム送信中");
        })
        .catch(() => {
          setServerLabel("PC側の受信準備を待っています");
        });
    }, 1000);
  }

  function startRecordingSegment() {
    const stream = streamRef.current;
    if (!stream || !recordingActiveRef.current || recorderRef.current) return;

    const parts: Blob[] = [];
    const segmentStartedAt = Date.now();
    const recorder = createMediaRecorder(stream, mimeTypeRef.current);
    recorderRef.current = recorder;
    startedAtRef.current = segmentStartedAt;
    chunkLevelRef.current = { sum: 0, count: 0, peak: 0 };

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        parts.push(event.data);
      }
    };
    recorder.onerror = () => {
      setError("録音中にエラーが発生しました。");
    };
    recorder.onstop = () => {
      if (segmentTimerRef.current !== null) {
        window.clearTimeout(segmentTimerRef.current);
        segmentTimerRef.current = null;
      }
      recorderRef.current = null;

      const actualType =
        recorder.mimeType || parts[0]?.type || mimeTypeRef.current || "audio/webm";
      const blob = new Blob(parts, { type: actualType });
      const levels = chunkLevelRef.current;
      const averageLevel = levels.count > 0 ? levels.sum / levels.count : 0;
      const peakLevel = levels.peak;
      chunkLevelRef.current = { sum: 0, count: 0, peak: 0 };

      if (recordingActiveRef.current && blob.size > 0) {
        enqueueChunk({
          blob,
          capturedAt: segmentStartedAt,
          durationMs: Math.max(1, Date.now() - segmentStartedAt),
          averageLevel,
          peakLevel,
        });
      }

      if (recordingActiveRef.current) {
        startRecordingSegment();
      }
    };

    recorder.start();
    segmentTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, CHUNK_MS);
  }

  function enqueueChunk(chunk: PendingChunk) {
    if (
      chunk.averageLevel < MIN_SEND_AVERAGE_LEVEL &&
      chunk.peakLevel < MIN_SEND_PEAK_LEVEL
    ) {
      return;
    }

    pendingChunksRef.current.push(chunk);
    if (pendingChunksRef.current.length > MAX_PENDING_CHUNKS) {
      pendingChunksRef.current.splice(
        0,
        pendingChunksRef.current.length - MAX_PENDING_CHUNKS,
      );
    }

    void flushChunkQueue();
  }

  async function flushChunkQueue() {
    if (sendingRef.current) return;
    sendingRef.current = true;

    try {
      while (pendingChunksRef.current.length > 0 && recordingActiveRef.current) {
        const chunk = pendingChunksRef.current.shift();
        if (!chunk) continue;

        await sendChunk(chunk);
      }
    } finally {
      sendingRef.current = false;
    }
  }

  async function sendChunk(chunk: PendingChunk) {
    const sentSequence = sequenceRef.current + 1;
    sequenceRef.current = sentSequence;
    setSequence(sentSequence);

    try {
      const actualType =
        chunk.blob.type ||
        recorderRef.current?.mimeType ||
        mimeTypeRef.current ||
        "application/octet-stream";
      const formData = new FormData();
      formData.append(
        "audio",
        chunk.blob,
        getAudioFileName(sentSequence, actualType),
      );
      formData.append("client_chunk_id", createClientChunkId());
      formData.append("sequence", String(sentSequence));
      formData.append("captured_at", String(chunk.capturedAt));
      formData.append("duration_ms", String(chunk.durationMs));
      formData.append("average_level", String(chunk.averageLevel));
      formData.append("peak_level", String(chunk.peakLevel));

      const response = await fetch("/api/remote-mic/chunks", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as
          | ChunkErrorDetail
          | null;
        const message =
          typeof detail?.error === "string" ? detail.error : "音声送信に失敗しました。";
        if (response.status === 415) {
          await stop(false);
          throw new Error(
            "この端末の録音形式にサーバーが対応していません。録音形式を確認して、もう一度開始してください。",
          );
        }
        const displayMessage = formatChunkError(response.status, message, detail);
        if (response.status >= 500) {
          consecutiveServerFailuresRef.current += 1;
          if (
            consecutiveServerFailuresRef.current >=
            MAX_CONSECUTIVE_SERVER_FAILURES
          ) {
            await stopRecordingAfterServerFailures(displayMessage);
            return;
          }
        }

        throw new Error(displayMessage);
      }

      consecutiveServerFailuresRef.current = 0;
      setLastSentAt(new Date().toLocaleTimeString("ja-JP"));
      setServerLabel("音声送信中");
    } catch (sendError) {
      setServerLabel("通信エラー");
      setError(
        sendError instanceof Error ? sendError.message : "音声送信に失敗しました。",
      );
    }
  }

  async function stopRecordingAfterServerFailures(message: string) {
    setServerLabel("音声処理停止");
    pendingChunksRef.current = [];
    setError(`音声処理に連続して失敗したため、録音を停止しました。\n${message}`);
    await stop(false);
  }

  function formatChunkError(
    status: number,
    message: string,
    detail: ChunkErrorDetail | null,
  ) {
    const category = getChunkErrorCategory(status);
    const parts = [`${category}: ${message} (${status})`];

    if (detail?.stage) {
      parts.push(`処理段階: ${detail.stage}`);
    }
    if (detail?.detail) {
      parts.push(`詳細: ${detail.detail}`);
    }

    return parts.join("\n");
  }

  async function stop(notifyServer = true) {
    recordingActiveRef.current = false;
    pendingChunksRef.current = [];
    if (answerPollTimerRef.current !== null) {
      window.clearInterval(answerPollTimerRef.current);
      answerPollTimerRef.current = null;
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (segmentTimerRef.current !== null) {
      window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }

    levelStopRef.current?.();
    levelStopRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mimeTypeRef.current = "";
    chunkLevelRef.current = { sum: 0, count: 0, peak: 0 };
    setRecorderLabel("未確認");
    setLevel(0);
    setMicState("idle");

    if (notifyServer) {
      await fetch("/api/remote-mic/disconnect", { method: "POST" }).catch(() => {});
      setServerLabel("停止中");
    }
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
          <StatusRow label="表示URL" value={openUrlLabel} />
          <StatusRow label="ブラウザ" value={browserLabel} />
          <StatusRow label="安全判定" value={getSecureContextLabel(secureContext)} />
          <StatusRow label="マイクAPI" value={getMediaSupportLabel(mediaSupported, secureContext)} />
          <StatusRow label="録音形式" value={recorderLabel} />
          <StatusRow label="マイク権限" value={permissionLabel} />
          <StatusRow label="音声送信" value={micState === "streaming" ? "送信中" : "停止中"} />
          <StatusRow label="最終送信" value={lastSentAt || "未送信"} />
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
            onClick={() => void stop()}
            className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-[14px] font-black text-stone-700 active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
          >
            停止
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            void stop(false).then(() => start());
          }}
          disabled={!remoteMic}
          className="mt-2 min-h-10 w-full rounded-md border border-emerald-700 bg-emerald-50 px-3 text-[13px] font-black text-emerald-900 active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
        >
          再接続
        </button>
      </section>
    </main>
  );
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

function createMediaRecorder(stream: MediaStream, mimeType: string) {
  try {
    return mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch {
    throw new Error("このブラウザーでは録音を開始できません。Safariを最新版にするか、別のブラウザーで開いてください。");
  }
}

function getPreferredAudioMimeType() {
  return getSupportedAudioMimeTypes()[0] ?? "";
}

function getSupportedAudioMimeTypes() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];

  if (typeof MediaRecorder === "undefined") return [];

  return candidates.filter((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function getAudioFileName(sequence: number, mimeType: string) {
  const extension = extensionForMimeType(mimeType);

  return `remote-mic-${sequence}.${extension}`;
}

function extensionForMimeType(value: string) {
  const type = value.toLowerCase().split(";")[0].trim();

  switch (type) {
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    case "audio/aac":
      return "aac";
    default:
      return "webm";
  }
}

function createClientChunkId() {
  if (crypto.randomUUID) return crypto.randomUUID();

  const random = new Uint32Array(4);
  crypto.getRandomValues(random);

  return Array.from(random, (value) => value.toString(36)).join("-");
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
  if (secureContext) return "利用不可/Safariで開く";

  return "利用不可/安全判定待ち";
}

function getChunkErrorCategory(status: number) {
  if (status === 400) return "音声メタデータが不正です";
  if (status === 401) return "マイク認証が期限切れです";
  if (status === 403) return "マイク認証が拒否されました";
  if (status === 415) return "録音形式が未対応です";
  if (status === 429) return "送信が混み合っています";
  if (status >= 500) return "サーバーの音声処理に失敗しました";

  return "音声送信に失敗しました";
}

function getInsecureContextHelp() {
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "URLはhttpsですが、この表示環境は安全なページとして扱われていません。QR読み取り後のカメラ内ブラウザではなく、右下の「…」からSafariで開いてください。";
  }

  return "この画面はHTTPSで開かれていません。Safariで https:// から始まるTailscale URLを開いてください。";
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

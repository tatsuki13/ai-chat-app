"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  createInitialRemoteMicrophoneState,
  createRemoteMicrophoneSender,
  createStreamLevelMeter,
  type RemoteMicrophoneState,
  type SpeakerRole,
} from "../../session/remote-microphone-service";

type MicrophoneClientProps = {
  role: SpeakerRole;
  validRole: boolean;
};

type PermissionStateText = "未確認" | "許可済み" | "拒否" | "利用不可";
type MicInputState = "停止中" | "取得中" | "送信中";

export default function MicrophoneClient(props: MicrophoneClientProps) {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  const token = searchParams.get("token")?.trim() ?? "";
  const [permissionState, setPermissionState] =
    useState<PermissionStateText>("未確認");
  const [micInputState, setMicInputState] = useState<MicInputState>("停止中");
  const [connectionState, setConnectionState] = useState<RemoteMicrophoneState>(
    createInitialRemoteMicrophoneState,
  );
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const senderRef = useRef<ReturnType<typeof createRemoteMicrophoneSender> | null>(
    null,
  );
  const streamRef = useRef<MediaStream | null>(null);
  const stopLevelMeterRef = useRef<(() => void) | null>(null);

  const roleLabel = props.role === "caregiver" ? "介護者用マイク" : "高齢者用マイク";
  const canStart =
    props.validRole && Boolean(sessionId) && Boolean(token) && micInputState === "停止中";

  useEffect(() => {
    return () => {
      void stop();
    };
  }, []);

  async function start(force = false) {
    if (!force && !canStart) return;
    if (!props.validRole || !sessionId || !token) return;

    setError("");
    setPermissionState("未確認");
    setMicInputState("取得中");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState("利用不可");
        throw new Error("このブラウザではマイクを利用できません。");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      streamRef.current = stream;
      setPermissionState("許可済み");
      setMicInputState("送信中");
      stopLevelMeterRef.current = createStreamLevelMeter(stream, setLevel);

      const sender = createRemoteMicrophoneSender({
        sessionId,
        role: props.role,
        token,
        stream,
        onState: setConnectionState,
      });
      senderRef.current = sender;
      await sender.start();
    } catch (startError) {
      if (isPermissionError(startError)) {
        setPermissionState("拒否");
      }
      setError(toErrorMessage(startError));
      await stop();
    }
  }

  async function stop() {
    const sender = senderRef.current;
    senderRef.current = null;
    await sender?.stop().catch(() => {});

    stopLevelMeterRef.current?.();
    stopLevelMeterRef.current = null;

    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;

    setLevel(0);
    setMicInputState("停止中");
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="border-b border-stone-200 pb-3">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
            Network microphone
          </div>
          <h1 className="mt-1 text-[22px] font-black leading-tight">
            {roleLabel}
          </h1>
        </div>

        <div className="mt-4 space-y-3">
          <StatusRow label="セッションID" value={sessionId || "未設定"} />
          <StatusRow label="マイク権限" value={permissionState} />
          <StatusRow label="PCとの接続" value={connectionLabel(connectionState)} />
          <StatusRow label="マイク入力" value={micInputState} />
          <div>
            <div className="mb-1 flex items-center justify-between text-[12px] font-black text-stone-600">
              <span>入力音量</span>
              <span>{Math.round(level * 100)}%</span>
            </div>
            <LevelBar value={level} tone="emerald" />
          </div>
        </div>

        {!props.validRole ? (
          <p className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
            URLの役割が正しくありません。
          </p>
        ) : null}
        {!token ? (
          <p className="mt-4 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-800">
            接続用トークンがありません。PC画面のQRコードから開いてください。
          </p>
        ) : null}
        {!sessionId ? (
          <p className="mt-4 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[13px] font-bold text-amber-800">
            URLに sessionId を付けて開いてください。
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start()}
            className="min-h-12 rounded-md bg-stone-950 px-3 text-[14px] font-black text-white active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400"
          >
            マイク接続を開始
          </button>
          <button
            type="button"
            disabled={micInputState === "停止中"}
            onClick={() => void stop()}
            className="min-h-12 rounded-md border border-stone-300 bg-white px-3 text-[14px] font-black text-stone-700 active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
          >
            停止
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            void stop().then(() => start(true));
          }}
          disabled={!props.validRole || !sessionId}
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

function LevelBar(props: { value: number; tone: "emerald" | "sky" }) {
  const width = `${Math.round(Math.min(1, Math.max(0, props.value)) * 100)}%`;

  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div
        className={`h-full ${props.tone === "emerald" ? "bg-emerald-600" : "bg-sky-600"}`}
        style={{ width }}
      />
    </div>
  );
}

function connectionLabel(state: RemoteMicrophoneState) {
  if (state.error) return "通信エラー";
  if (state.connectionState === "connected") return "接続済み";
  if (state.connectionState === "connecting") return "接続中";
  if (state.connectionState === "disconnected") return "切断";
  if (state.connectionState === "failed") return "接続失敗";
  if (state.connectionState === "closed") return "停止中";
  return "未接続";
}

function isPermissionError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "マイク接続に失敗しました。";
}

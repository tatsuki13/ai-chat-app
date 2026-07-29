"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

type SessionInfo = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  ended_at: string | null;
};

type RemoteMicRole = "caregiver" | "elder";
type RemoteMicQrInfo = {
  joinUrl: string;
  expiresAt: string;
};
type RemoteMicQrState = Record<RemoteMicRole, RemoteMicQrInfo | null>;
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
};
type RemoteMicStatusResponse = {
  now: string;
  roles: Record<RemoteMicRole, RemoteMicRoleStatus>;
};

const STORAGE_KEY = "acp-hitl-current-session-id";

export default function Home() {
  const router = useRouter();
  const [participantCode, setParticipantCode] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [remoteMicQr, setRemoteMicQr] = useState<RemoteMicQrState>({
    caregiver: null,
    elder: null,
  });
  const [remoteMicStatuses, setRemoteMicStatuses] = useState<
    Record<RemoteMicRole, RemoteMicRoleStatus>
  >({
    caregiver: { status: "not-issued" },
    elder: { status: "not-issued" },
  });
  const [remoteMicQrLoading, setRemoteMicQrLoading] = useState(false);
  const [remoteMicQrError, setRemoteMicQrError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const bothMicsConnected =
    remoteMicStatuses.caregiver.status === "connected" &&
    remoteMicStatuses.elder.status === "connected";

  useEffect(() => {
    if (!session?.id || bothMicsConnected) return;

    void issueRemoteMicQrCodes(session.id);
  }, [bothMicsConnected, session?.id]);

  useEffect(() => {
    if (!session?.id) return;

    let ignore = false;

    async function refresh() {
      try {
        const status = await fetchRemoteMicStatus(session.id);
        if (!ignore) {
          setRemoteMicStatuses(status.roles);
        }
      } catch {
        if (!ignore) {
          setRemoteMicQrError("スマートフォンマイクの接続状態を確認できませんでした。");
        }
      }
    }

    void refresh();
    const timerId = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      ignore = true;
      window.clearInterval(timerId);
    };
  }, [session?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = participantCode.trim();
    if (!code) {
      setError("参加者IDを入力してください。");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_code: code,
          condition: "mvp",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message =
          body && typeof body.error === "string"
            ? toUserFacingError(body.error)
            : "セッションを作成できませんでした。";
        throw new Error(message);
      }

      const data = (await response.json()) as { session: SessionInfo };
      window.localStorage.setItem(STORAGE_KEY, data.session.id);
      setSession(data.session);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "セッションを作成できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  async function issueRemoteMicQrCodes(sessionId: string) {
    setRemoteMicQrLoading(true);
    setRemoteMicQrError("");

    try {
      const [caregiver, elder] = await Promise.all([
        issueRemoteMicToken(sessionId, "caregiver"),
        issueRemoteMicToken(sessionId, "elder"),
      ]);

      setRemoteMicQr({ caregiver, elder });
      const status = await fetchRemoteMicStatus(sessionId);
      setRemoteMicStatuses(status.roles);
    } catch (qrError) {
      setRemoteMicQr({ caregiver: null, elder: null });
      setRemoteMicQrError(
        qrError instanceof Error
          ? qrError.message
          : "スマートフォンマイク用QRを発行できませんでした。",
      );
    } finally {
      setRemoteMicQrLoading(false);
    }
  }

  function goToSession() {
    if (!session || !bothMicsConnected) return;

    router.push(`/session?sessionId=${encodeURIComponent(session.id)}`);
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-5xl">
        <header className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
            ACP dialogue support
          </div>
          <h1 className="mt-1 text-[26px] font-black leading-tight">
            実験セッション準備
          </h1>
        </header>

        <div className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <form
            onSubmit={handleSubmit}
            className="rounded-md border border-stone-300 bg-white p-4 shadow-sm"
          >
            <label className="block">
              <span className="text-[13px] font-black text-stone-700">
                参加者ID
              </span>
              <input
                value={participantCode}
                onChange={(event) => setParticipantCode(event.target.value)}
                disabled={busy || Boolean(session)}
                placeholder="例: P-20260724-001"
                className="mt-2 min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-[15px] font-bold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100 disabled:text-stone-400"
              />
            </label>
            {error ? (
              <p className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || Boolean(session)}
              className="mt-4 min-h-11 w-full rounded-md bg-stone-950 px-3 text-[14px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-200 disabled:text-stone-400"
            >
              {busy ? "作成中" : session ? "セッション作成済み" : "マイク登録へ進む"}
            </button>
            {session ? (
              <>
                <button
                  type="button"
                  onClick={goToSession}
                  disabled={!bothMicsConnected}
                  className="mt-2 min-h-11 w-full rounded-md border border-emerald-700 bg-emerald-50 px-3 text-[14px] font-black text-emerald-900 shadow-sm active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-100 disabled:text-stone-400"
                >
                  {bothMicsConnected ? "対話画面へ進む" : "2台の接続を待っています"}
                </button>
                <p className="mt-2 text-[11px] font-bold text-stone-500">
                  本人用・介護者用の両方が接続済みになると進めます。
                </p>
              </>
            ) : null}
          </form>

          <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-black leading-tight">
                  スマートフォンマイク登録
                </h2>
                <p className="mt-1 text-[12px] font-bold text-stone-500">
                  本人用と介護者用のスマートフォンで、それぞれのQRコードを読み取ってください。
                </p>
              </div>
              <div className="rounded-full bg-stone-100 px-3 py-1 text-[12px] font-black text-stone-600">
                {session?.participant_code ?? "未作成"}
              </div>
            </div>

            {session ? (
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-bold text-stone-500">
                    QRコードは1回限り、短時間のみ有効です。URLは画面に表示しません。
                  </p>
                  <button
                    type="button"
                    onClick={() => void issueRemoteMicQrCodes(session.id)}
                    disabled={remoteMicQrLoading}
                    className="min-h-9 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 active:scale-[0.99] disabled:bg-stone-100 disabled:text-stone-400"
                  >
                    {remoteMicQrLoading ? "発行中" : "QRを再発行"}
                  </button>
                </div>
                {remoteMicQrError ? (
                  <p className="mb-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800">
                    {remoteMicQrError}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <QrCard
                    title="介護者用マイク"
                    qr={remoteMicQr.caregiver}
                    status={remoteMicStatuses.caregiver}
                    tone="sky"
                  />
                  <QrCard
                    title="本人用マイク"
                    qr={remoteMicQr.elder}
                    status={remoteMicStatuses.elder}
                    tone="emerald"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 flex min-h-[280px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-[13px] font-bold text-stone-500">
                参加者IDを入力してセッションを作成すると、ここに2台分のQRコードが表示されます。
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function QrCard(props: {
  title: string;
  qr: RemoteMicQrInfo | null;
  status: RemoteMicRoleStatus;
  tone: "sky" | "emerald";
}) {
  const connected = props.status.status === "connected";

  return (
    <article className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div
          className={`text-[14px] font-black ${
            props.tone === "sky" ? "text-sky-800" : "text-emerald-800"
          }`}
        >
          {props.title}
        </div>
        <div
          className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
            connected
              ? "bg-emerald-100 text-emerald-900"
              : "bg-stone-200 text-stone-600"
          }`}
        >
          {remoteMicStatusLabel(props.status.status)}
        </div>
      </div>
      {props.qr && !connected ? (
        <>
          <div className="mt-3 flex justify-center rounded-md border border-stone-200 bg-white p-3">
            <QrCanvas value={props.qr.joinUrl} label={`${props.title} QRコード`} />
          </div>
          <div className="mt-3 rounded border border-stone-200 bg-white px-2 py-2 text-[11px] font-bold leading-snug text-stone-500">
            有効期限: {formatDateTime(props.qr.expiresAt)}
          </div>
        </>
      ) : (
        <div className="mt-3 flex min-h-[250px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-white px-3 text-center text-[12px] font-bold text-stone-500">
          {connected ? "接続済みです" : "QRコード未発行"}
        </div>
      )}
      {props.status.lastHeartbeatAt ? (
        <p className="mt-2 text-[11px] font-bold text-stone-500">
          最終通信: {formatDateTime(props.status.lastHeartbeatAt)}
        </p>
      ) : null}
    </article>
  );
}

function QrCanvas(props: { value: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    void QRCode.toCanvas(canvas, props.value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 220,
      color: {
        dark: "#111827",
        light: "#ffffff",
      },
    });
  }, [props.value]);

  return (
    <canvas
      ref={canvasRef}
      width={220}
      height={220}
      aria-label={props.label}
      role="img"
      className="h-[220px] w-[220px]"
    />
  );
}

async function issueRemoteMicToken(sessionId: string, role: RemoteMicRole) {
  const response = await fetch("/api/remote-mic/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body.error === "string"
        ? body.error
        : "スマートフォンマイク用QRを発行できませんでした。";
    throw new Error(message);
  }

  return (await response.json()) as RemoteMicQrInfo;
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "不明";

  return date.toLocaleString("ja-JP");
}

function toUserFacingError(message: string) {
  if (message === "participant_code already exists") {
    return "この参加者IDはすでに使われています。別のIDを入力してください。";
  }

  return message;
}

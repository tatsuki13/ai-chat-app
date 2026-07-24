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

type PairingToken = {
  role: "caregiver" | "elder";
  token: string;
  expiresAt: string;
};

const STORAGE_KEY = "acp-hitl-current-session-id";

export default function Home() {
  const router = useRouter();
  const [participantCode, setParticipantCode] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [pairingTokens, setPairingTokens] = useState<
    Record<"caregiver" | "elder", PairingToken | null>
  >({
    caregiver: null,
    elder: null,
  });
  const [origin, setOrigin] = useState("");
  const [microphoneBaseUrl, setMicrophoneBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    setMicrophoneBaseUrl(window.location.origin);
  }, []);

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
      const tokens = await createPairingTokens(data.session.id);
      window.localStorage.setItem(STORAGE_KEY, data.session.id);
      setSession(data.session);
      setPairingTokens(tokens);
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

  const normalizedMicrophoneBaseUrl = normalizeBaseUrl(microphoneBaseUrl) || origin;
  const caregiverUrl = session
    ? buildMicrophoneUrl(
        normalizedMicrophoneBaseUrl,
        "caregiver",
        session.id,
        pairingTokens.caregiver?.token ?? "",
      )
    : "";
  const elderUrl = session
    ? buildMicrophoneUrl(
        normalizedMicrophoneBaseUrl,
        "elder",
        session.id,
        pairingTokens.elder?.token ?? "",
      )
    : "";
  const usingLocalhost =
    normalizedMicrophoneBaseUrl.includes("localhost") ||
    normalizedMicrophoneBaseUrl.includes("127.0.0.1");

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
              <button
                type="button"
                onClick={() => {
                  router.push(`/session?sessionId=${encodeURIComponent(session.id)}`);
                }}
                className="mt-2 min-h-11 w-full rounded-md border border-emerald-700 bg-emerald-50 px-3 text-[14px] font-black text-emerald-900 shadow-sm active:scale-[0.99]"
              >
                次へ進む
              </button>
            ) : null}
          </form>

          <section className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[16px] font-black leading-tight">
                  スマートフォンマイク登録
                </h2>
                <p className="mt-1 text-[12px] font-bold text-stone-500">
                  2台のスマートフォンで、それぞれのQRを読み取ってください。
                </p>
              </div>
              <div className="rounded-full bg-stone-100 px-3 py-1 text-[12px] font-black text-stone-600">
                {session?.participant_code ?? "未作成"}
              </div>
            </div>

            <label className="mt-4 block rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
              <span className="text-[12px] font-black text-stone-700">
                スマホ接続用URL
              </span>
              <input
                value={microphoneBaseUrl}
                onChange={(event) => setMicrophoneBaseUrl(event.target.value)}
                placeholder="例: http://172.17.69.186:3000"
                className="mt-2 min-h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-[12px] font-bold outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              />
              {usingLocalhost ? (
                <p className="mt-2 text-[11px] font-bold text-amber-800">
                  localhost はスマホから接続できません。PCのLAN IPまたはHTTPSの公開URLを指定してください。
                </p>
              ) : null}
            </label>

            {session ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <QrCard
                  title="介護者用マイク"
                  url={caregiverUrl}
                  expiresAt={pairingTokens.caregiver?.expiresAt ?? ""}
                  tone="sky"
                />
                <QrCard
                  title="高齢者用マイク"
                  url={elderUrl}
                  expiresAt={pairingTokens.elder?.expiresAt ?? ""}
                  tone="emerald"
                />
              </div>
            ) : (
              <div className="mt-4 flex min-h-[280px] items-center justify-center rounded-md border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-[13px] font-bold text-stone-500">
                参加者IDを入力してセッションを作成すると、ここに2台分のQRが表示されます。
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
  url: string;
  expiresAt: string;
  tone: "sky" | "emerald";
}) {
  return (
    <article className="rounded-md border border-stone-200 bg-stone-50 p-3">
      <div
        className={`text-[14px] font-black ${
          props.tone === "sky" ? "text-sky-800" : "text-emerald-800"
        }`}
      >
        {props.title}
      </div>
      <div className="mt-3 flex justify-center rounded-md border border-stone-200 bg-white p-3">
        <QrCanvas value={props.url} label={`${props.title} 接続QRコード`} />
      </div>
      {props.expiresAt ? (
        <div className="mt-2 text-[11px] font-bold text-stone-500">
          有効期限: {formatDateTime(props.expiresAt)}
        </div>
      ) : null}
      <div className="mt-3 break-all rounded border border-stone-200 bg-white px-2 py-2 text-[11px] font-bold leading-snug text-stone-500">
        {props.url}
      </div>
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

async function createPairingTokens(sessionId: string) {
  const response = await fetch("/api/microphone/pairing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });

  if (!response.ok) {
    throw new Error("マイク接続用トークンを作成できませんでした。");
  }

  const data = (await response.json()) as { tokens?: PairingToken[] };
  const tokens = data.tokens ?? [];

  return {
    caregiver: tokens.find((token) => token.role === "caregiver") ?? null,
    elder: tokens.find((token) => token.role === "elder") ?? null,
  };
}

function buildMicrophoneUrl(
  baseUrl: string,
  role: "caregiver" | "elder",
  sessionId: string,
  token: string,
) {
  const params = new URLSearchParams({
    sessionId,
    token,
  });

  return `${normalizeBaseUrl(baseUrl)}/microphone/${role}?${params.toString()}`;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}


function toUserFacingError(error: string) {
  if (error === "participant_code already exists") {
    return "この参加者IDはすでに使われています。";
  }

  return error;
}

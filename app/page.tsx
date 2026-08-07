"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SessionInfo = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  dialogue_started_at: string | null;
  ended_at: string | null;
};

const STORAGE_KEY = "acp-hitl-current-session-id";

export default function Home() {
  const router = useRouter();
  const [participantCode, setParticipantCode] = useState("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedId = window.localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      router.replace(`/session?sessionId=${encodeURIComponent(savedId)}`);
    }
  }, [router]);

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
      router.push(`/session?sessionId=${encodeURIComponent(data.session.id)}`);
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

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-3xl">
        <header className="rounded-md border border-stone-300 bg-white p-4 shadow-sm">
          <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
            ACP dialogue support
          </div>
          <h1 className="mt-1 text-[26px] font-black leading-tight">
            実験セッション準備
          </h1>
        </header>

        <form
          onSubmit={handleSubmit}
          className="mt-4 rounded-md border border-stone-300 bg-white p-4 shadow-sm"
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
            {busy ? "作成中" : session ? "セッション作成済み" : "対話画面へ進む"}
          </button>
          <p className="mt-3 text-[12px] font-bold leading-relaxed text-stone-500">
            固定スマホは本人用が /mic/elder、介護者用が /mic/caregiver です。QRコードの読み取りは不要です。
          </p>
        </form>
      </section>
    </main>
  );
}

function toUserFacingError(message: string) {
  if (message === "participant_code already exists") {
    return "この参加者IDはすでに使われています。別のIDを入力してください。";
  }

  return message;
}

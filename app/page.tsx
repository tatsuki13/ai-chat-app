"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SessionInfo = {
  id: string;
  participant_code: string | null;
};

type Condition = "mvp" | "dev";

const SESSION_TOKEN_STORAGE_KEY = "acp-hitl-session-access-tokens";

export default function Home() {
  const router = useRouter();
  const [participantCode, setParticipantCode] = useState("");
  const [condition, setCondition] = useState<Condition>("mvp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          participant_code: code,
          condition,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | {
            session?: SessionInfo;
            session_access_token?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !data?.session) {
        throw new Error(data?.error || "セッションを開始できませんでした。");
      }

      if (data.session_access_token) {
        saveSessionAccessToken(data.session.id, data.session_access_token);
      }

      router.push(`/session?sessionId=${encodeURIComponent(data.session.id)}`);
    } catch (caught) {
      const message =
        caught instanceof Error && caught.message
          ? caught.message
          : "セッションを開始できませんでした。";
      setError(toUserFacingError(message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] px-4 py-8 text-stone-950">
      <section className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-xl items-center">
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-md border border-stone-200 bg-white p-5 shadow-sm"
        >
          <p className="text-[13px] font-bold text-stone-500">ACP対話支援</p>
          <h1 className="mt-1 text-[26px] font-black leading-tight">
            セッション開始
          </h1>

          <label className="mt-6 block">
            <span className="text-[13px] font-black text-stone-700">
              {condition === "dev" ? "参照元の参加者ID" : "参加者ID"}
            </span>
            <input
              value={participantCode}
              onChange={(event) => setParticipantCode(event.target.value)}
              autoFocus
              disabled={busy}
              className="mt-2 h-12 w-full rounded-md border border-stone-300 bg-white px-3 text-[16px] font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-[13px] font-black text-stone-700">
              condition
            </span>
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as Condition)}
              disabled={busy}
              className="mt-2 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-[14px] font-bold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            >
              <option value="mvp">mvp</option>
              <option value="dev">dev</option>
            </select>
          </label>

          {condition === "dev" ? (
            <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] font-bold leading-relaxed text-sky-800">
              devでは入力したIDの過去ログをコピーして検証用セッションを開始します。
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-6 min-h-12 w-full rounded-md bg-stone-950 px-4 text-[15px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-300"
          >
            {busy ? "開始中" : "セッション画面へ"}
          </button>
        </form>
      </section>
    </main>
  );
}

function saveSessionAccessToken(sessionId: string, token: string) {
  const tokens = loadSessionAccessTokens();
  tokens[sessionId] = token;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

function loadSessionAccessTokens() {
  try {
    const value = window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : {};

    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function toUserFacingError(error: string) {
  if (error === "participant_code already exists") {
    return "この参加者IDはすでに使われています。別のIDを入力してください。";
  }

  if (error === "source session not found") {
    return "参照元の参加者IDが見つかりませんでした。";
  }

  return error;
}

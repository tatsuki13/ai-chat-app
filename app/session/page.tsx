"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Speaker = "caregiver" | "elder";
type ButtonType = "next_question" | "switch_topic" | "check_end" | "update_slots";

type SessionInfo = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  ended_at: string | null;
};

type Utterance = {
  id: string;
  speaker: Speaker | string;
  text: string;
  created_at: string;
};

type SuggestionModal = {
  title: string;
  body: string;
  suggestionId?: string;
  draftText?: string;
  tone: "question" | "switch" | "end" | "status" | "error";
};

const STORAGE_KEY = "acp-hitl-current-session-id";

export default function SessionPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speaker, setSpeaker] = useState<Speaker>("elder");
  const [draft, setDraft] = useState("");
  const [busyAction, setBusyAction] = useState<ButtonType | "start" | null>("start");
  const [modal, setModal] = useState<SuggestionModal | null>(null);
  const [statusText, setStatusText] = useState("準備中");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let ignore = false;

    async function boot() {
      try {
        const savedId = window.localStorage.getItem(STORAGE_KEY);

        if (savedId) {
          const restored = await fetchSessionDetail(savedId);

          if (!ignore) {
            setSession(restored.session);
            setUtterances(restored.utterances);
            setStatusText("保存中");
            setBusyAction(null);
          }

          return;
        }

        const created = await startSession();

        if (!ignore) {
          window.localStorage.setItem(STORAGE_KEY, created.id);
          setSession(created);
          setStatusText("保存中");
          setBusyAction(null);
        }
      } catch {
        if (!ignore) {
          setBusyAction(null);
          setStatusText("接続エラー");
          setModal({
            title: "セッションを開始できません",
            body: "DATABASE_URL とデータベース接続を確認してください。",
            tone: "error",
          });
        }
      }
    }

    boot();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [utterances.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !draft.trim()) return;

    const text = draft.trim();
    setDraft("");
    setStatusText("保存中");

    try {
      const utterance = await addUtterance(session.id, speaker, text);
      setUtterances((current) => [...current, utterance]);
      setStatusText("保存済み");
    } catch {
      setDraft(text);
      setStatusText("保存エラー");
      setModal({
        title: "発話を保存できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    }
  }

  async function handleAction(buttonType: ButtonType) {
    if (!session || busyAction) return;

    setBusyAction(buttonType);
    setStatusText("保存中");

    try {
      const triggerEventId = await saveButtonEvent(session.id, buttonType);

      if (buttonType === "next_question") {
        const data = await postJson<NextQuestionResponse>("/api/ai/next-question", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });
        const body = joinPrompt(
          data.suggestion.transition_phrase,
          data.suggestion.question,
        );

        setModal({
          title: "質問する",
          body,
          suggestionId: data.suggestion.id,
          draftText: body,
          tone: "question",
        });
      }

      if (buttonType === "switch_topic") {
        const data = await postJson<TopicSwitchResponse>("/api/ai/switch-topic", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });

        setModal({
          title: "話題を変える",
          body: data.suggestion.message,
          suggestionId: data.suggestion.id,
          draftText: data.suggestion.message,
          tone: "switch",
        });
      }

      if (buttonType === "check_end") {
        const data = await postJson<EndCheckResponse>("/api/ai/check-end", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });

        setModal({
          title: data.suggestion.can_end ? "終了確認" : "もう少し確認",
          body: data.suggestion.message,
          suggestionId: data.suggestion.id,
          tone: "end",
        });
      }

      if (buttonType === "update_slots") {
        await postJson("/api/ai/update-slots", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });

        setModal({
          title: "議事録更新",
          body: "議事録を更新しました。",
          tone: "status",
        });
      }

      setStatusText("保存済み");
    } catch {
      setStatusText("保存エラー");
      setModal({
        title: "AI支援を実行できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUseSuggestion() {
    if (!modal?.draftText) return;

    if (modal.suggestionId) {
      await markSuggestionAdopted(modal.suggestionId, true).catch(() => undefined);
    }

    setSpeaker("caregiver");
    setDraft(modal.draftText);
    setModal(null);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function handleNewSession() {
    if (busyAction) return;

    const confirmed = window.confirm("新しいセッションを開始しますか？");
    if (!confirmed) return;

    setBusyAction("start");
    setModal(null);

    try {
      const created = await startSession();
      window.localStorage.setItem(STORAGE_KEY, created.id);
      setSession(created);
      setUtterances([]);
      setDraft("");
      setStatusText("保存中");
    } catch {
      setStatusText("接続エラー");
      setModal({
        title: "セッションを開始できません",
        body: "DATABASE_URL とデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] pb-[calc(136px+env(safe-area-inset-bottom))] text-stone-950">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fdfdf9]/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[820px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-stone-500">ACP対話支援</p>
            <h1 className="truncate text-[22px] font-black leading-tight">
              プレACPセッション
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[13px] font-bold text-emerald-800">
              {statusText}
            </span>
            <button
              type="button"
              onClick={handleNewSession}
              className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-[14px] font-bold text-stone-700 shadow-sm active:scale-[0.99]"
            >
              新規
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto flex min-h-[calc(100dvh-238px)] max-w-[820px] flex-col px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3 text-[13px] font-bold text-stone-500">
          <span>会話ログ</span>
          <span className="truncate">ID: {session?.id ?? "準備中"}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-stone-200 bg-white px-3 py-3 shadow-sm">
          {busyAction === "start" && utterances.length === 0 ? (
            <EmptyState text="セッションを準備しています" />
          ) : utterances.length === 0 ? (
            <EmptyState text="発話を入力するとここに表示されます" />
          ) : (
            <div className="space-y-3">
              {utterances.map((utterance) => (
                <SpeechBubble key={utterance.id} utterance={utterance} />
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-3 rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <SpeakerButton
              active={speaker === "elder"}
              label="本人"
              onClick={() => setSpeaker("elder")}
            />
            <SpeakerButton
              active={speaker === "caregiver"}
              label="介護者"
              onClick={() => setSpeaker("caregiver")}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="発話を入力"
              className="min-h-24 flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-3 text-[18px] leading-relaxed outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              disabled={!session || busyAction === "start"}
            />
            <button
              type="submit"
              disabled={!session || !draft.trim() || busyAction === "start"}
              className="min-h-24 w-24 rounded-lg bg-stone-950 px-3 text-[17px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-300"
            >
              追加
            </button>
          </div>
        </form>
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-[#fdfdf9]/95 shadow-[0_-12px_28px_rgba(28,25,23,0.12)] backdrop-blur">
        <div className="mx-auto grid max-w-[820px] grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
          <ActionButton
            label="質問する"
            tone="emerald"
            busy={busyAction === "next_question"}
            disabled={!session || Boolean(busyAction)}
            onClick={() => handleAction("next_question")}
          />
          <ActionButton
            label="話題を変える"
            tone="blue"
            busy={busyAction === "switch_topic"}
            disabled={!session || Boolean(busyAction)}
            onClick={() => handleAction("switch_topic")}
          />
          <ActionButton
            label="終了確認"
            tone="amber"
            busy={busyAction === "check_end"}
            disabled={!session || Boolean(busyAction)}
            onClick={() => handleAction("check_end")}
          />
          <ActionButton
            label="議事録更新"
            tone="stone"
            busy={busyAction === "update_slots"}
            disabled={!session || Boolean(busyAction)}
            onClick={() => handleAction("update_slots")}
          />
        </div>
      </footer>

      {modal ? (
        <SuggestionDialog
          modal={modal}
          onClose={() => setModal(null)}
          onUse={modal.draftText ? handleUseSuggestion : undefined}
        />
      ) : null}
    </main>
  );
}

function EmptyState(props: { text: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-[17px] font-bold text-stone-500">
      {props.text}
    </div>
  );
}

function SpeakerButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-12 rounded-lg border px-3 text-[17px] font-black active:scale-[0.99] ${
        props.active
          ? "border-emerald-700 bg-emerald-700 text-white"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {props.label}
    </button>
  );
}

function SpeechBubble(props: { utterance: Utterance }) {
  const isCaregiver = props.utterance.speaker === "caregiver";

  return (
    <div className={`flex ${isCaregiver ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-lg border px-3 py-2 shadow-sm ${
          isCaregiver
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-stone-200 bg-[#fffdf7] text-stone-950"
        }`}
      >
        <div
          className={`mb-1 text-[12px] font-black ${
            isCaregiver ? "text-sky-100" : "text-emerald-700"
          }`}
        >
          {isCaregiver ? "介護者" : "本人"}
        </div>
        <p className="whitespace-pre-wrap break-words text-[18px] leading-relaxed">
          {props.utterance.text}
        </p>
        <time
          className={`mt-2 block text-[11px] font-bold ${
            isCaregiver ? "text-sky-100" : "text-stone-400"
          }`}
        >
          {formatDateTime(props.utterance.created_at)}
        </time>
      </article>
    </div>
  );
}

function ActionButton(props: {
  label: string;
  tone: "emerald" | "blue" | "amber" | "stone";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const toneClass =
    props.tone === "emerald"
      ? "bg-emerald-700 text-white"
      : props.tone === "blue"
        ? "bg-sky-700 text-white"
        : props.tone === "amber"
          ? "bg-amber-500 text-stone-950"
          : "bg-stone-950 text-white";

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-20 rounded-lg px-2 text-[17px] font-black leading-tight shadow-sm active:scale-[0.99] disabled:bg-stone-300 disabled:text-stone-500 ${toneClass}`}
    >
      {props.busy ? "処理中" : props.label}
    </button>
  );
}

function SuggestionDialog(props: {
  modal: SuggestionModal;
  onClose: () => void;
  onUse?: () => void;
}) {
  const accent =
    props.modal.tone === "error"
      ? "border-red-200 bg-red-50"
      : props.modal.tone === "end"
        ? "border-amber-200 bg-amber-50"
        : props.modal.tone === "switch"
          ? "border-sky-200 bg-sky-50"
          : "border-emerald-200 bg-emerald-50";

  return (
    <>
      <button
        type="button"
        aria-label="閉じる"
        className="fixed inset-0 z-40 bg-stone-950/35"
        onClick={props.onClose}
      />
      <section className="fixed inset-x-0 bottom-[152px] z-50 mx-auto max-w-[760px] px-4 sm:bottom-[120px]">
        <div className={`rounded-lg border p-4 shadow-2xl ${accent}`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[22px] font-black leading-tight text-stone-950">
              {props.modal.title}
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-[16px] font-bold text-stone-700"
            >
              閉じる
            </button>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-[24px] font-black leading-relaxed text-stone-950">
            {props.modal.body}
          </p>
          {props.onUse ? (
            <button
              type="button"
              onClick={props.onUse}
              className="mt-4 min-h-14 w-full rounded-lg bg-emerald-700 px-4 text-[18px] font-black text-white shadow-sm active:scale-[0.99]"
            >
              入力欄に入れる
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}

async function startSession(): Promise<SessionInfo> {
  const data = await postJson<{ session: SessionInfo }>("/api/session/start", {
    participant_code: `P-${new Date().toISOString().slice(0, 10)}`,
    condition: "mvp",
  });

  return data.session;
}

async function fetchSessionDetail(sessionId: string): Promise<{
  session: SessionInfo;
  utterances: Utterance[];
}> {
  const response = await fetch(`/api/admin/session/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to restore session");
  }

  return response.json();
}

async function addUtterance(
  sessionId: string,
  speaker: Speaker,
  text: string,
): Promise<Utterance> {
  const data = await postJson<{ utterance: Utterance }>("/api/utterance", {
    session_id: sessionId,
    speaker,
    text,
  });

  return data.utterance;
}

async function saveButtonEvent(sessionId: string, buttonType: ButtonType) {
  const data = await postJson<{
    button_event: {
      id: string;
    };
  }>("/api/button-event", {
    session_id: sessionId,
    button_type: buttonType,
  });

  return data.button_event.id;
}

async function markSuggestionAdopted(suggestionId: string, adopted: boolean) {
  await postJson(`/api/ai-suggestion/${encodeURIComponent(suggestionId)}`, {
    adopted,
  });
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return response.json() as Promise<T>;
}

function joinPrompt(transition: string, question: string) {
  if (!transition) return question;
  return `${transition}${question}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type NextQuestionResponse = {
  suggestion: {
    id: string;
    question: string;
    transition_phrase: string;
  };
};

type TopicSwitchResponse = {
  suggestion: {
    id: string;
    message: string;
  };
};

type EndCheckResponse = {
  suggestion: {
    id: string;
    can_end: boolean;
    message: string;
  };
};

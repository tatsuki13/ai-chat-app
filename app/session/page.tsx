"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { DISCUSSION_TOPIC } from "../../lib/acp-mvp";

type Speaker = "caregiver" | "elder";
type ButtonType = "next_question" | "switch_topic" | "check_end" | "update_slots";
type PromptTone = "question" | "switch" | "end" | "status" | "error";

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

type PromptPanelState = {
  title: string;
  body: string;
  suggestionId?: string;
  tone: PromptTone;
};

const STORAGE_KEY = "acp-hitl-current-session-id";
const MAX_RENDERED_UTTERANCES = 120;
const INITIAL_PROMPT_PANEL: PromptPanelState = {
  title: "最初の話題提供",
  body: "最近の生活で、これからも続けたいことは何ですか。\nお二人で、話しやすいところから話してみてください。",
  tone: "question",
};

export default function SessionPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [utteranceTotal, setUtteranceTotal] = useState(0);
  const [speaker, setSpeaker] = useState<Speaker>("elder");
  const [draft, setDraft] = useState("");
  const [busyAction, setBusyAction] = useState<ButtonType | "start" | "id" | null>("start");
  const [promptPanel, setPromptPanel] = useState<PromptPanelState | null>(
    INITIAL_PROMPT_PANEL,
  );
  const [statusText, setStatusText] = useState("準備中");
  const [isEditingId, setIsEditingId] = useState(false);
  const [idDraft, setIdDraft] = useState("");
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const idInputRef = useRef<HTMLInputElement | null>(null);

  const displayId = session?.participant_code || session?.id || "準備中";
  const visibleUtterances = utterances.slice(-MAX_RENDERED_UTTERANCES);
  const hiddenUtteranceCount = Math.max(
    0,
    utteranceTotal - visibleUtterances.length,
  );

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
            setUtteranceTotal(restored.utterance_count);
            setStatusText("保存中");
            setBusyAction(null);
          }

          return;
        }

        const created = await startSession();

        if (!ignore) {
          window.localStorage.setItem(STORAGE_KEY, created.id);
          setSession(created);
          setUtteranceTotal(0);
          setStatusText("保存中");
          setBusyAction(null);
        }
      } catch {
        if (!ignore) {
          setBusyAction(null);
          setStatusText("接続エラー");
          setPromptPanel({
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

  useEffect(() => {
    if (isEditingId) {
      window.setTimeout(() => {
        idInputRef.current?.focus();
        idInputRef.current?.select();
      }, 0);
    }
  }, [isEditingId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!session || !draft.trim()) return;

    const text = draft.trim();
    setDraft("");
    setStatusText("保存中");

    try {
      const utterance = await addUtterance(session.id, speaker, text);
      setUtterances((current) =>
        [...current, utterance].slice(-MAX_RENDERED_UTTERANCES),
      );
      setUtteranceTotal((current) => current + 1);
      setStatusText("保存済み");
    } catch {
      setDraft(text);
      setStatusText("保存エラー");
      setPromptPanel({
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
    setPromptPanel(getPendingPrompt(buttonType));

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

        setPromptPanel({
          title: "AIからの質問",
          body,
          suggestionId: data.suggestion.id,
          tone: "question",
        });
      }

      if (buttonType === "switch_topic") {
        const data = await postJson<TopicSwitchResponse>("/api/ai/switch-topic", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });

        setPromptPanel({
          title: "話題を変える一言",
          body: data.suggestion.message,
          suggestionId: data.suggestion.id,
          tone: "switch",
        });
      }

      if (buttonType === "check_end") {
        const data = await postJson<EndCheckResponse>("/api/ai/check-end", {
          session_id: session.id,
          trigger_event_id: triggerEventId,
        });

        setPromptPanel({
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

        setPromptPanel({
          title: "議事録更新",
          body: "議事録を更新しました。",
          tone: "status",
        });
      }

      setStatusText("保存済み");
    } catch {
      setStatusText("保存エラー");
      setPromptPanel({
        title: "AI支援を実行できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleNewSession() {
    if (busyAction) return;

    const confirmed = window.confirm("新しいセッションを開始しますか？");
    if (!confirmed) return;

    setBusyAction("start");
    setPromptPanel(INITIAL_PROMPT_PANEL);
    setIsEditingId(false);

    try {
      const created = await startSession();
      window.localStorage.setItem(STORAGE_KEY, created.id);
      setSession(created);
      setUtterances([]);
      setUtteranceTotal(0);
      setDraft("");
      setStatusText("保存中");
    } catch {
      setStatusText("接続エラー");
      setPromptPanel({
        title: "セッションを開始できません",
        body: "DATABASE_URL とデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function startEditingId() {
    if (!session || busyAction) return;

    setIdDraft(session.participant_code || session.id);
    setIsEditingId(true);
  }

  async function saveDisplayId() {
    if (!session || !isEditingId) return;

    const nextId = idDraft.trim();

    if (nextId === (session.participant_code || session.id)) {
      setIsEditingId(false);
      return;
    }

    setBusyAction("id");
    setStatusText("保存中");

    try {
      const updated = await updateSessionDisplayId(session.id, nextId);
      setSession(updated);
      setIsEditingId(false);
      setStatusText("保存済み");
    } catch {
      setStatusText("保存エラー");
      setPromptPanel({
        title: "IDを保存できません",
        body: "通信状態またはデータベース接続を確認してください。",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleIdKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void saveDisplayId();
    }

    if (event.key === "Escape") {
      setIsEditingId(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] pb-[calc(124px+env(safe-area-inset-bottom))] text-stone-950">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-[#fdfdf9]/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[860px] items-center justify-between gap-3 px-4 py-3">
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

      <section className="mx-auto flex min-h-[calc(100dvh-210px)] max-w-[860px] flex-col gap-3 px-4 py-4">
        <div className="flex items-center justify-between gap-3 text-[13px] font-bold text-stone-500">
          <span>セッション</span>
          <div className="min-w-0 text-right">
            {isEditingId ? (
              <input
                ref={idInputRef}
                value={idDraft}
                onBlur={() => void saveDisplayId()}
                onChange={(event) => setIdDraft(event.target.value)}
                onKeyDown={handleIdKeyDown}
                className="h-9 max-w-[260px] rounded-lg border border-emerald-400 bg-white px-2 text-right text-[14px] font-black text-stone-950 outline-none ring-2 ring-emerald-100"
                disabled={busyAction === "id"}
              />
            ) : (
              <button
                type="button"
                onDoubleClick={startEditingId}
                className="max-w-[320px] truncate rounded-md px-2 py-1 text-right font-black text-stone-600 hover:bg-stone-100"
                title="ダブルクリックでIDを編集"
              >
                ID: {displayId}
              </button>
            )}
          </div>
        </div>

        <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <details className="group border-b border-stone-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="text-[13px] font-black text-stone-500">
                  今日の機会
                </div>
                <h2 className="mt-1 truncate text-[20px] font-black leading-tight text-stone-950">
                  {DISCUSSION_TOPIC.title}
                </h2>
              </div>
              <span className="shrink-0 rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-[13px] font-black text-stone-600">
                説明
              </span>
            </summary>
            <div className="border-t border-stone-100 px-4 pb-4 text-[15px] font-semibold leading-relaxed text-stone-600">
              {DISCUSSION_TOPIC.description}
            </div>
          </details>
          <div className="px-4 py-4">
            <PromptPanel prompt={promptPanel} />
          </div>
        </section>

        <section className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
            <h2 className="text-[18px] font-black leading-tight">会話ログ</h2>
            <span className="text-[13px] font-bold text-stone-500">
              {utteranceTotal}件
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50 px-3 py-3">
            {busyAction === "start" && utterances.length === 0 ? (
              <EmptyState text="セッションを準備しています" />
            ) : utterances.length === 0 ? (
              <EmptyState text="発話を入力するとここに表示されます" />
            ) : (
              <div className="space-y-3">
                {hiddenUtteranceCount > 0 ? (
                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-center text-[13px] font-bold text-stone-500">
                    以前の発話 {hiddenUtteranceCount} 件
                  </div>
                ) : null}
                {visibleUtterances.map((utterance) => (
                  <SpeechBubble key={utterance.id} utterance={utterance} />
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm"
        >
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
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={2}
              placeholder="発話を入力"
              className="min-h-20 flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-3 text-[18px] leading-relaxed outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
              disabled={!session || busyAction === "start"}
            />
            <button
              type="submit"
              disabled={!session || !draft.trim() || busyAction === "start"}
              className="min-h-20 w-24 rounded-lg bg-stone-950 px-3 text-[17px] font-black text-white shadow-sm active:scale-[0.99] disabled:bg-stone-300"
            >
              追加
            </button>
          </div>
        </form>
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-[#fdfdf9]/95 shadow-[0_-12px_28px_rgba(28,25,23,0.12)] backdrop-blur">
        <div className="mx-auto grid max-w-[860px] grid-cols-2 gap-3 px-4 py-4 sm:grid-cols-4">
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
    </main>
  );
}

function PromptPanel(props: { prompt: PromptPanelState | null }) {
  if (!props.prompt) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-5">
        <div className="text-[13px] font-black text-stone-500">AIからの質問</div>
        <p className="mt-2 text-[20px] font-black leading-relaxed text-stone-500">
          下の「質問する」または「話題を変える」を押すと、ここに介護者が読み上げられる文が表示されます。
        </p>
      </div>
    );
  }

  const toneClass =
    props.prompt.tone === "error"
      ? "border-red-200 bg-red-50"
      : props.prompt.tone === "end"
        ? "border-amber-200 bg-amber-50"
        : props.prompt.tone === "switch"
          ? "border-sky-200 bg-sky-50"
          : props.prompt.tone === "status"
            ? "border-stone-200 bg-stone-50"
            : "border-emerald-200 bg-emerald-50";

  return (
    <div className={`rounded-lg border px-4 py-4 ${toneClass}`}>
      <div className="text-[13px] font-black text-stone-600">{props.prompt.title}</div>
      <p className="mt-2 whitespace-pre-wrap text-[24px] font-black leading-relaxed text-stone-950">
        {props.prompt.body}
      </p>
    </div>
  );
}

function getPendingPrompt(buttonType: ButtonType): PromptPanelState {
  if (buttonType === "next_question") {
    return {
      title: "AIからの質問",
      body: "現在の会話に合う質問を生成しています。",
      tone: "status",
    };
  }

  if (buttonType === "switch_topic") {
    return {
      title: "話題を変える一言",
      body: "自然につながる話題転換を生成しています。",
      tone: "status",
    };
  }

  if (buttonType === "check_end") {
    return {
      title: "終了確認",
      body: "今日の対話を終えてよいか確認しています。",
      tone: "status",
    };
  }

  return {
    title: "議事録更新",
    body: "会話ログから議事録を更新しています。",
    tone: "status",
  };
}

function EmptyState(props: { text: string }) {
  return (
    <div className="flex min-h-[210px] items-center justify-center rounded-lg border border-dashed border-stone-300 bg-white px-4 text-center text-[17px] font-bold text-stone-500">
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

async function startSession(): Promise<SessionInfo> {
  const data = await postJson<{ session: SessionInfo }>("/api/session/start", {
    participant_code: `P-${new Date().toISOString().slice(0, 10)}`,
    condition: "mvp",
  });

  return data.session;
}

async function fetchSessionDetail(sessionId: string): Promise<{
  session: SessionInfo;
  utterance_count: number;
  utterances: Utterance[];
}> {
  const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
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

async function updateSessionDisplayId(
  sessionId: string,
  participantCode: string,
): Promise<SessionInfo> {
  const data = await patchJson<{ session: SessionInfo }>(
    `/api/session/${encodeURIComponent(sessionId)}`,
    {
      participant_code: participantCode,
    },
  );

  return data.session;
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

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, "POST", body);
}

async function patchJson<T = unknown>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, "PATCH", body);
}

async function requestJson<T = unknown>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
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

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeTranscript,
  calculateCompletionRate,
  createActionLog,
  createEmptySlots,
  createExitJudgement,
  createId,
  createMemoJson,
  createMemoMarkdown,
  createQuestionCandidates,
  createResearchSnapshot,
  createTopicShiftSuggestions,
  inferCurrentTopic,
  type AcpSlotRecord,
  type ActionButtonType,
  type AiSuggestion,
  type ExitJudgement,
  type ResearchActionLog,
  type ResearchSnapshot,
  type SlotStatus,
  type Speaker,
  type Utterance,
} from "../lib/acp";

const STORAGE_KEY = "acp-mvp-session-v1";
const SESSION_DURATION_MS = 30 * 60 * 1000;

type ModalState =
  | {
      mode: "suggestions";
      title: string;
      description: string;
      actionLogId: string;
      suggestions: AiSuggestion[];
    }
  | {
      mode: "exit";
      title: string;
      actionLogId: string;
      judgement: ExitJudgement;
    }
  | null;

type SaveState = "idle" | "saving" | "saved" | "error";

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [now, setNow] = useState(0);
  const [transcript, setTranscript] = useState<Utterance[]>([]);
  const [slots, setSlots] = useState<AcpSlotRecord[]>(() => createEmptySlots(""));
  const [actionLogs, setActionLogs] = useState<ResearchActionLog[]>([]);
  const [speaker, setSpeaker] = useState<Speaker>("caregiver");
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [copied, setCopied] = useState<"json" | "markdown" | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const saved = loadSnapshot();

    if (saved) {
      setSessionId(saved.sessionId);
      setStartedAt(saved.startedAt);
      setTranscript(saved.full_utterance_log ?? []);
      setSlots(saved.acp_slots?.length ? saved.acp_slots : createEmptySlots(""));
      setActionLogs(saved.button_logs ?? []);
    } else {
      setSessionId(createId("acp-session"));
      setStartedAt(new Date().toISOString());
    }

    setNow(Date.now());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript.length]);

  const completionRate = useMemo(() => calculateCompletionRate(slots), [slots]);
  const completionPercent = Math.round(completionRate * 100);
  const filledCount = slots.filter((slot) => slot.status === "filled").length;
  const partialCount = slots.filter((slot) => slot.status === "partial").length;
  const currentTopic = useMemo(() => inferCurrentTopic(slots, transcript), [slots, transcript]);
  const elapsedMs = startedAt && now ? Math.max(0, now - new Date(startedAt).getTime()) : 0;
  const remainingMs = Math.max(0, SESSION_DURATION_MS - elapsedMs);
  const markdownMinutes = useMemo(
    () => createMemoMarkdown(slots, transcript),
    [slots, transcript],
  );
  const jsonMinutes = useMemo(
    () => JSON.stringify(createMemoJson(transcript, slots, actionLogs), null, 2),
    [transcript, slots, actionLogs],
  );

  const handleAddUtterance = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const text = draft.trim();
    if (!text) return;

    const nextTranscript = [
      ...transcript,
      {
        id: createId("utt"),
        speaker,
        text,
        timestamp: new Date().toISOString(),
      },
    ];

    setTranscript(nextTranscript);
    setDraft("");
    persistSnapshot({ nextTranscript });
  };

  const handleUpdateMemo = () => {
    const nextSlots = analyzeTranscript(transcript);
    const actionLog = createActionLog({
      buttonType: "update_memo",
      slots: nextSlots,
    });
    const nextActionLogs = [...actionLogs, actionLog];

    setSlots(nextSlots);
    setActionLogs(nextActionLogs);
    persistSnapshot({ nextSlots, nextActionLogs });
  };

  const handleQuestionSuggestions = () => {
    const nextSlots = analyzeTranscript(transcript);
    const suggestions = createQuestionCandidates(nextSlots, transcript);
    const actionLog = createActionLog({
      buttonType: "question_suggestions",
      slots: nextSlots,
      suggestions,
    });
    const nextActionLogs = [...actionLogs, actionLog];

    setSlots(nextSlots);
    setActionLogs(nextActionLogs);
    setModal({
      mode: "suggestions",
      title: "追加質問候補",
      description: "未充足スロットから、今の流れで自然に聞きやすい候補です。",
      actionLogId: actionLog.id,
      suggestions,
    });
    persistSnapshot({ nextSlots, nextActionLogs });
  };

  const handleTopicShift = () => {
    const nextSlots = analyzeTranscript(transcript);
    const suggestions = createTopicShiftSuggestions(nextSlots, transcript);
    const actionLog = createActionLog({
      buttonType: "topic_shift",
      slots: nextSlots,
      suggestions,
    });
    const nextActionLogs = [...actionLogs, actionLog];

    setSlots(nextSlots);
    setActionLogs(nextActionLogs);
    setModal({
      mode: "suggestions",
      title: "話題切り替え候補",
      description: "短い橋渡し文を含む、次に移りやすい話題候補です。",
      actionLogId: actionLog.id,
      suggestions,
    });
    persistSnapshot({ nextSlots, nextActionLogs });
  };

  const handleExitCheck = () => {
    const nextSlots = analyzeTranscript(transcript);
    const judgement = createExitJudgement(nextSlots);
    const actionLog = createActionLog({
      buttonType: "exit_check",
      slots: nextSlots,
      exitJudgement: judgement,
    });
    const nextActionLogs = [...actionLogs, actionLog];

    setSlots(nextSlots);
    setActionLogs(nextActionLogs);
    setModal({
      mode: "exit",
      title: "終了判断",
      actionLogId: actionLog.id,
      judgement,
    });
    persistSnapshot({ nextSlots, nextActionLogs });
  };

  const handleAdoption = (suggestion: AiSuggestion, adopted: boolean) => {
    if (!modal || modal.mode !== "suggestions") return;

    const nextSuggestions = modal.suggestions.map((item) =>
      item.id === suggestion.id ? { ...item, adopted } : item,
    );
    const nextActionLogs = updateActionLogSuggestions(
      actionLogs,
      modal.actionLogId,
      nextSuggestions,
    );

    setActionLogs(nextActionLogs);

    if (adopted) {
      setSpeaker("caregiver");
      setDraft(suggestion.text);
      setModal(null);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    } else {
      setModal({ ...modal, suggestions: nextSuggestions });
    }

    persistSnapshot({ nextActionLogs });
  };

  const handleCopy = async (kind: "json" | "markdown") => {
    const text = kind === "json" ? jsonMinutes : markdownMinutes;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const handleReset = () => {
    const confirmed = window.confirm("現在の入力を閉じて、新しいACPセッションを開始しますか？");
    if (!confirmed) return;

    const nextSessionId = createId("acp-session");
    const nextStartedAt = new Date().toISOString();
    const nextSlots = createEmptySlots("");

    setSessionId(nextSessionId);
    setStartedAt(nextStartedAt);
    setTranscript([]);
    setSlots(nextSlots);
    setActionLogs([]);
    setDraft("");
    setModal(null);
    persistSnapshot({
      nextSessionId,
      nextStartedAt,
      nextTranscript: [],
      nextSlots,
      nextActionLogs: [],
    });
  };

  const persistSnapshot = async (input: {
    nextSessionId?: string;
    nextStartedAt?: string;
    nextTranscript?: Utterance[];
    nextSlots?: AcpSlotRecord[];
    nextActionLogs?: ResearchActionLog[];
  }) => {
    const effectiveSessionId = input.nextSessionId || sessionId || createId("acp-session");
    const effectiveStartedAt = input.nextStartedAt || startedAt || new Date().toISOString();
    const snapshot = createResearchSnapshot({
      sessionId: effectiveSessionId,
      startedAt: effectiveStartedAt,
      transcript: input.nextTranscript ?? transcript,
      slots: input.nextSlots ?? slots,
      actionLogs: input.nextActionLogs ?? actionLogs,
    });

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    setSaveState("saving");

    try {
      const response = await fetch("/api/acp-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      setSaveState(response.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div className="min-h-dvh bg-[#eef2f5] pb-[calc(132px+env(safe-area-inset-bottom))] text-slate-900 md:pb-[calc(104px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto max-w-[1180px] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-slate-500">現在の話題</p>
              <h1 className="mt-1 truncate text-[22px] font-bold leading-tight text-slate-950">
                {currentTopic}
              </h1>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="min-h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-4 text-[16px] font-bold text-slate-700 shadow-sm active:scale-[0.99]"
            >
              新規
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Metric label="残り時間" value={formatTime(remainingMs)} tone="amber" />
            <Metric label="経過時間" value={formatTime(elapsedMs)} tone="slate" />
            <Metric label="充足率" value={`${completionPercent}%`} tone="emerald" />
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-600 transition-[width]"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto grid h-[calc(100dvh-276px)] min-h-[610px] max-w-[1180px] grid-rows-[minmax(250px,0.9fr)_minmax(330px,1.1fr)] gap-3 px-4 py-3 lg:h-[calc(100dvh-220px)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:grid-rows-1">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-[20px] font-bold leading-tight">対話ログ</h2>
              <p className="text-[13px] font-semibold text-slate-500">
                {transcript.length}件の発話
              </p>
            </div>
            <SaveIndicator state={saveState} />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
            {transcript.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white px-4 text-center text-[16px] font-semibold text-slate-500">
                まだ発話ログはありません
              </div>
            ) : (
              transcript.map((utterance) => (
                <SpeechBubble key={utterance.id} utterance={utterance} />
              ))
            )}
            <div ref={logEndRef} />
          </div>

          <form onSubmit={handleAddUtterance} className="border-t border-slate-200 bg-white p-3">
            <div className="mb-2 grid grid-cols-2 gap-2">
              <SpeakerButton
                active={speaker === "caregiver"}
                label="介護者"
                onClick={() => setSpeaker("caregiver")}
              />
              <SpeakerButton
                active={speaker === "elder"}
                label="高齢者役"
                onClick={() => setSpeaker("elder")}
              />
            </div>
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={2}
                className="min-h-14 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-3 text-[16px] leading-relaxed text-slate-950 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                placeholder="発話を入力"
              />
              <button
                type="submit"
                className="min-h-14 w-24 rounded-lg bg-slate-950 px-4 text-[16px] font-bold text-white shadow-sm active:scale-[0.99] disabled:bg-slate-300"
                disabled={!draft.trim()}
              >
                追加
              </button>
            </div>
          </form>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-[20px] font-bold leading-tight">AI議事録</h2>
              <p className="text-[13px] font-semibold text-slate-500">
                filled {filledCount} / partial {partialCount} / total {slots.length}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
              <div className="text-[12px] font-bold text-emerald-700">進行</div>
              <div className="text-[20px] font-black leading-none text-emerald-800">
                {completionPercent}%
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3">
            <div className="grid gap-2">
              {slots.map((slot) => (
                <SlotCard key={slot.id} slot={slot} />
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <CopyButton
                active={copied === "json"}
                label={copied === "json" ? "JSONコピー済み" : "JSONコピー"}
                onClick={() => handleCopy("json")}
              />
              <CopyButton
                active={copied === "markdown"}
                label={copied === "markdown" ? "Markdownコピー済み" : "Markdownコピー"}
                onClick={() => handleCopy("markdown")}
              />
            </div>

            <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-3 py-3 text-[16px] font-bold text-slate-700">
                JSON / Markdown出力
              </summary>
              <div className="space-y-3 border-t border-slate-200 p-3">
                <OutputBlock title="JSON" value={jsonMinutes} />
                <OutputBlock title="Markdown" value={markdownMinutes} />
              </div>
            </details>
          </div>
        </section>
      </main>

      <ActionBar
        onUpdateMemo={handleUpdateMemo}
        onQuestionSuggestions={handleQuestionSuggestions}
        onTopicShift={handleTopicShift}
        onExitCheck={handleExitCheck}
      />

      {modal ? (
        <SuggestionModal
          modal={modal}
          onClose={() => setModal(null)}
          onAdoption={handleAdoption}
        />
      ) : null}
    </div>
  );
}

function Metric(props: { label: string; value: string; tone: "amber" | "slate" | "emerald" }) {
  const toneClass =
    props.tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : props.tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : "border-slate-200 bg-slate-50 text-slate-900";

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="text-[12px] font-bold opacity-75">{props.label}</div>
      <div className="mt-1 text-[20px] font-black leading-none">{props.value}</div>
    </div>
  );
}

function SaveIndicator(props: { state: SaveState }) {
  const label =
    props.state === "saving"
      ? "保存中"
      : props.state === "saved"
        ? "保存済み"
        : props.state === "error"
          ? "保存エラー"
          : "待機";
  const className =
    props.state === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : props.state === "saved"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span className={`rounded-full border px-3 py-1 text-[13px] font-bold ${className}`}>
      {label}
    </span>
  );
}

function SpeakerButton(props: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-12 rounded-lg border px-3 text-[16px] font-bold active:scale-[0.99] ${
        props.active
          ? "border-slate-950 bg-slate-950 text-white"
          : "border-slate-300 bg-white text-slate-700"
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
      <div
        className={`max-w-[88%] rounded-lg border px-3 py-2 shadow-sm ${
          isCaregiver
            ? "border-sky-200 bg-sky-700 text-white"
            : "border-emerald-200 bg-white text-slate-950"
        }`}
      >
        <div
          className={`mb-1 text-[12px] font-bold ${
            isCaregiver ? "text-sky-100" : "text-emerald-700"
          }`}
        >
          {isCaregiver ? "介護者" : "高齢者役"}
        </div>
        <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">
          {props.utterance.text}
        </p>
      </div>
    </div>
  );
}

function SlotCard(props: { slot: AcpSlotRecord }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[16px] font-bold leading-snug text-slate-950">{props.slot.label}</h3>
        <StatusBadge status={props.slot.status} />
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-slate-800">
        {props.slot.summary}
      </p>
      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-[12px] font-bold text-slate-500">根拠発話</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-700">
          {props.slot.evidence_utterance || "未確認"}
        </p>
      </div>
    </article>
  );
}

function StatusBadge(props: { status: SlotStatus }) {
  const className =
    props.status === "filled"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : props.status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[12px] font-black ${className}`}>
      {props.status}
    </span>
  );
}

function CopyButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-12 rounded-lg border px-3 text-[16px] font-bold active:scale-[0.99] ${
        props.active
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-slate-300 bg-white text-slate-700"
      }`}
    >
      {props.label}
    </button>
  );
}

function OutputBlock(props: { title: string; value: string }) {
  return (
    <section>
      <h3 className="mb-2 text-[16px] font-bold text-slate-700">{props.title}</h3>
      <textarea
        readOnly
        value={props.value}
        rows={8}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-mono text-[13px] leading-relaxed text-slate-800"
      />
    </section>
  );
}

function ActionBar(props: {
  onUpdateMemo: () => void;
  onQuestionSuggestions: () => void;
  onTopicShift: () => void;
  onExitCheck: () => void;
}) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-12px_30px_rgba(15,23,42,0.14)] backdrop-blur">
      <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-3 px-4 py-4 md:grid-cols-4">
        <ActionButton label="議事録を更新" tone="slate" onClick={props.onUpdateMemo} />
        <ActionButton label="追加質問候補" tone="emerald" onClick={props.onQuestionSuggestions} />
        <ActionButton label="話題切り替え" tone="sky" onClick={props.onTopicShift} />
        <ActionButton label="終了確認" tone="amber" onClick={props.onExitCheck} />
      </div>
    </footer>
  );
}

function ActionButton(props: {
  label: string;
  tone: "slate" | "emerald" | "sky" | "amber";
  onClick: () => void;
}) {
  const className =
    props.tone === "emerald"
      ? "bg-emerald-700 text-white"
      : props.tone === "sky"
        ? "bg-sky-700 text-white"
        : props.tone === "amber"
          ? "bg-amber-500 text-slate-950"
          : "bg-slate-950 text-white";

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-16 rounded-lg px-3 text-[17px] font-black leading-snug shadow-sm active:scale-[0.99] ${className}`}
    >
      {props.label}
    </button>
  );
}

function SuggestionModal(props: {
  modal: ModalState;
  onClose: () => void;
  onAdoption: (suggestion: AiSuggestion, adopted: boolean) => void;
}) {
  if (!props.modal) return null;

  return (
    <>
      <button
        type="button"
        aria-label="閉じる"
        className="fixed inset-0 z-40 bg-slate-950/30"
        onClick={props.onClose}
      />
      <section className="fixed inset-x-0 bottom-[176px] z-50 mx-auto max-w-[760px] px-4 md:bottom-[112px]">
        <div className="max-h-[62dvh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
          <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-[22px] font-black leading-tight text-slate-950">
                {props.modal.title}
              </h2>
              {props.modal.mode === "suggestions" ? (
                <p className="mt-1 text-[15px] font-semibold leading-relaxed text-slate-600">
                  {props.modal.description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={props.onClose}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-[16px] font-bold text-slate-700"
            >
              閉じる
            </button>
          </div>

          {props.modal.mode === "suggestions" ? (
            <div className="space-y-3 p-4">
              {props.modal.suggestions.length === 0 ? (
                <p className="text-[16px] font-semibold text-slate-600">
                  追加候補はありません。
                </p>
              ) : (
                props.modal.suggestions.map((suggestion) => (
                  <article
                    key={suggestion.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-black text-slate-600">
                        {suggestion.targetSlotLabel}
                      </span>
                      {suggestion.adopted === true ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-black text-emerald-700">
                          採用済み
                        </span>
                      ) : null}
                      {suggestion.adopted === false ? (
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[12px] font-black text-slate-600">
                          未採用
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-[18px] font-bold leading-relaxed text-slate-950">
                      {suggestion.text}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => props.onAdoption(suggestion, true)}
                        className="min-h-12 rounded-lg bg-emerald-700 px-3 text-[16px] font-black text-white"
                      >
                        採用して入力欄へ
                      </button>
                      <button
                        type="button"
                        onClick={() => props.onAdoption(suggestion, false)}
                        className="min-h-12 rounded-lg border border-slate-300 bg-white px-3 text-[16px] font-bold text-slate-700"
                      >
                        使わない
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <div
                className={`rounded-lg border p-4 ${
                  props.modal.judgement.decision === "終了してよい"
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="text-[13px] font-black text-slate-600">判断</div>
                <p className="mt-1 text-[24px] font-black leading-tight text-slate-950">
                  {props.modal.judgement.decision}
                </p>
                <p className="mt-3 text-[17px] font-semibold leading-relaxed text-slate-800">
                  {props.modal.judgement.reason}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-[13px] font-black text-slate-500">主要スロット</div>
                <p className="mt-1 text-[17px] font-bold text-slate-800">
                  {props.modal.judgement.keySlotFilledCount} /{" "}
                  {props.modal.judgement.keySlotCount} filled
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-[13px] font-black text-slate-500">
                  未確認または部分確認の重要項目
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {props.modal.judgement.remainingImportantSlots.length > 0 ? (
                    props.modal.judgement.remainingImportantSlots.map((slot) => (
                      <span
                        key={slot}
                        className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-[14px] font-bold text-slate-700"
                      >
                        {slot}
                      </span>
                    ))
                  ) : (
                    <span className="text-[16px] font-semibold text-slate-600">なし</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function updateActionLogSuggestions(
  logs: ResearchActionLog[],
  actionLogId: string,
  suggestions: AiSuggestion[],
) {
  const adopted =
    suggestions.some((suggestion) => suggestion.adopted === true)
      ? true
      : suggestions.length > 0 && suggestions.every((suggestion) => suggestion.adopted === false)
        ? false
        : null;

  return logs.map((log) =>
    log.id === actionLogId
      ? {
          ...log,
          ai_suggestions: suggestions,
          adopted,
        }
      : log,
  );
}

function loadSnapshot(): ResearchSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    return JSON.parse(raw) as ResearchSnapshot;
  } catch {
    return null;
  }
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

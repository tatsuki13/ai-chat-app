"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

export type SessionSpeaker = "elder" | "caregiver";
export type SessionSpeakerWithUnknown = SessionSpeaker | "unknown";
export type PromptTone = "question" | "switch" | "end" | "status" | "error";

export type PromptPanelState = {
  title: string;
  body: string;
  tone: PromptTone;
};

export type LiveTranscriptLike = {
  key: string;
  sessionId: string;
  role: SessionSpeaker;
  streamId: string;
  transcriptId: string;
  revision: number;
  text: string;
  status: "partial" | "final";
  startedAt?: string;
  firstPartialAt?: string;
  finalizedAt?: string;
};

export type UtteranceLike = {
  id: string;
  speaker: string;
  text: string;
  created_at: string;
  source_group_id?: string | null;
};

export type RemoteMicConversationEntryLike =
  | {
      kind: "final";
      key: string;
      createdAt: string;
      utterance: UtteranceLike;
    }
  | {
      kind: "live";
      key: string;
      createdAt: string;
      transcript: LiveTranscriptLike;
    };

export type RemoteMicRoleStatusLike = {
  status: "connected" | "disconnected";
  ready: boolean;
  readyReason?: string | null;
  lastHeartbeatAt?: string | null;
  muted?: boolean;
  realtimeConnected?: boolean;
  captureState?: "idle" | "listening" | "suppressed" | "reconnecting" | "error";
};

export function SessionShell(props: {
  topDetails?: ReactNode;
  header: ReactNode;
  sidePanel?: ReactNode;
  promptPanel: ReactNode;
  actionPanel: ReactNode;
  transitionPanel?: ReactNode;
  conversationPanel: ReactNode;
  inputPanel?: ReactNode;
  rightPanel?: ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#f7f8f4] text-stone-950">
      <section className="mx-auto w-full max-w-[1120px] px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,860px)_240px]">
          <div className="min-w-0 space-y-3">
            {props.topDetails}
            {props.header}
          </div>
        </div>

        <div className="relative mt-3">
          {props.sidePanel ? (
            <div className="mb-4 lg:absolute lg:left-[-332px] lg:top-0 lg:mb-0 lg:w-[316px]">
              {props.sidePanel}
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,860px)_240px] lg:items-start">
            {props.promptPanel}
            {props.actionPanel}
          </div>
        </div>

        {props.transitionPanel ? (
          <div className="mt-3">{props.transitionPanel}</div>
        ) : null}

        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,860px)_240px]">
          <div className="min-w-0 space-y-3">
            {props.conversationPanel}
            {props.inputPanel}
          </div>
          {props.rightPanel ? <div className="space-y-3">{props.rightPanel}</div> : null}
        </div>
      </section>
    </main>
  );
}

export function PromptPanel(props: {
  prompt: PromptPanelState | null;
  topicTitle: string;
  topicIndex: number;
  topicCount: number;
  aiSpeechActive: boolean;
}) {
  if (!props.prompt) {
    return (
      <div className="flex min-h-[296px] flex-col justify-center overflow-hidden rounded-md border border-stone-200 bg-white px-4 py-4 lg:h-[316px]">
        <div className="w-fit rounded-full border border-emerald-100 bg-emerald-100 px-3 py-1 text-[12px] font-black text-emerald-800">
          話題 {props.topicIndex}/{props.topicCount}: {props.topicTitle}
        </div>
        <p className="mt-3 text-[18px] font-black leading-relaxed text-stone-700">
          「AIに質問してもらう」を押すと、ここにAIが読み上げる文が表示されます。「次の話題へ」では次のテーマへ移ります。
        </p>
      </div>
    );
  }

  const toneClass =
    props.prompt.tone === "error"
      ? "border-red-300 bg-red-50"
      : props.prompt.tone === "end"
        ? "border-amber-300 bg-amber-50"
        : props.prompt.tone === "switch"
          ? "border-emerald-600 bg-emerald-50"
          : props.prompt.tone === "status"
            ? "border-stone-300 bg-white"
            : "border-sky-300 bg-sky-50";

  return (
    <div className={`flex min-h-[296px] flex-col overflow-hidden rounded-md border px-4 py-4 lg:h-[316px] ${toneClass}`}>
      <div className="space-y-1.5">
        <div className="w-fit rounded-full border border-emerald-100 bg-emerald-100 px-3 py-1 text-[12px] font-black text-emerald-800">
          話題 {props.topicIndex}/{props.topicCount}: {props.topicTitle}
        </div>
        <div className="text-[13px] font-black text-stone-700">
          {props.prompt.title}
        </div>
        {props.aiSpeechActive ? (
          <div className="w-fit rounded-full border border-stone-200 bg-white/80 px-2 py-0.5 text-[11px] font-bold text-stone-600">
            AI音声の再生中はスマートフォンの音声入力を一時停止しています
          </div>
        ) : null}
      </div>
      <p className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[22px] font-black leading-relaxed text-stone-950">
        {props.prompt.body}
      </p>
    </div>
  );
}

export function ConversationLog(props: {
  entries: RemoteMicConversationEntryLike[];
  totalCount: number;
  hiddenCount?: number;
  emptyText: string;
  loadingText?: string;
  loading?: boolean;
  logScrollRef?: RefObject<HTMLDivElement | null>;
  logEndRef?: RefObject<HTMLDivElement | null>;
  editable?: boolean;
  onUpdate?: (utteranceId: string, speaker: SessionSpeaker, text: string) => Promise<void>;
  onDelete?: (utteranceId: string) => Promise<void>;
}) {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-black leading-tight">会話ログ</h2>
        <span className="text-[12px] font-bold text-stone-500">
          {props.totalCount}件
        </span>
      </div>

      <div
        ref={props.logScrollRef}
        className="mt-2 h-[580px] overflow-y-auto rounded-md border border-dashed border-stone-300 bg-white px-3 py-3 lg:h-[660px]"
      >
        {props.loading && props.entries.length === 0 ? (
          <EmptyState text={props.loadingText ?? props.emptyText} />
        ) : props.entries.length === 0 ? (
          <EmptyState text={props.emptyText} />
        ) : (
          <div className="space-y-2">
            {props.hiddenCount && props.hiddenCount > 0 ? (
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-center text-[12px] font-bold text-stone-500">
                以前の発話 {props.hiddenCount} 件
              </div>
            ) : null}
            {props.entries.map((entry) => (
              <RemoteMicConversationBubble
                key={entry.key}
                entry={entry}
                editable={props.editable}
                onUpdate={props.onUpdate}
                onDelete={props.onDelete}
              />
            ))}
            <div ref={props.logEndRef} />
          </div>
        )}
      </div>
    </section>
  );
}

export function RemoteMicConversationBubble(props: {
  entry: RemoteMicConversationEntryLike;
  editable?: boolean;
  onUpdate?: (utteranceId: string, speaker: SessionSpeaker, text: string) => Promise<void>;
  onDelete?: (utteranceId: string) => Promise<void>;
}) {
  if (props.entry.kind === "live") {
    return <RemoteMicLiveSpeechBubble transcript={props.entry.transcript} />;
  }

  return (
    <SpeechBubble
      utterance={props.entry.utterance}
      editable={props.editable}
      onUpdate={props.onUpdate}
      onDelete={props.onDelete}
    />
  );
}

export function RemoteMicLiveSpeechBubble(props: { transcript: LiveTranscriptLike }) {
  const isSpeakerB = props.transcript.role === "caregiver";
  const isPartial = props.transcript.status === "partial";

  return (
    <div className={`flex ${isSpeakerB ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isSpeakerB
            ? "border-sky-200 bg-sky-50 text-sky-950"
            : "border-emerald-200 bg-emerald-50 text-stone-950"
        } ${isPartial ? "border-dashed opacity-75" : ""}`}
      >
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <div
            className={`text-[10px] font-black ${
              isSpeakerB ? "text-sky-700" : "text-emerald-700"
            }`}
          >
            {speakerLabel(props.transcript.role)}
          </div>
          {isPartial ? (
            <div
              className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                isSpeakerB
                  ? "bg-sky-100 text-sky-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
            >
              認識中
            </div>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {props.transcript.text}
        </p>
        <time
          className={`mt-1 block text-[10px] font-bold ${
            isSpeakerB ? "text-sky-500" : "text-emerald-600"
          }`}
        >
          {formatDateTime(
            props.transcript.finalizedAt ?? props.transcript.startedAt,
          )}
        </time>
      </article>
    </div>
  );
}

export function SpeechBubble(props: {
  utterance: UtteranceLike;
  editable?: boolean;
  onUpdate?: (utteranceId: string, speaker: SessionSpeaker, text: string) => Promise<void>;
  onDelete?: (utteranceId: string) => Promise<void>;
}) {
  const normalizedSpeaker = normalizeSpeaker(props.utterance.speaker);
  const isSpeakerB = normalizedSpeaker === "caregiver";
  const [isEditing, setIsEditing] = useState(false);
  const [editSpeaker, setEditSpeaker] = useState<SessionSpeaker>(normalizedSpeaker);
  const [editText, setEditText] = useState(props.utterance.text);
  const [isSaving, setIsSaving] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (isEditing) return;

    setEditSpeaker(normalizeSpeaker(props.utterance.speaker));
    setEditText(props.utterance.text);
    setErrorText("");
  }, [
    isEditing,
    props.utterance.id,
    props.utterance.speaker,
    props.utterance.text,
  ]);

  async function saveEdit() {
    if (!props.onUpdate) return;
    setIsSaving(true);
    setErrorText("");

    try {
      await props.onUpdate(props.utterance.id, editSpeaker, editText);
      setIsEditing(false);
    } catch (error) {
      setErrorText(
        error instanceof Error && error.message
          ? error.message
          : "発話を更新できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteEdit() {
    if (!props.onDelete) return;
    setIsSaving(true);
    setErrorText("");

    try {
      await props.onDelete(props.utterance.id);
      setIsEditing(false);
    } catch (error) {
      setErrorText(
        error instanceof Error && error.message
          ? error.message
          : "発話を削除できませんでした。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing && props.editable && props.onUpdate && props.onDelete) {
    return (
      <div className={`flex ${isSpeakerB ? "justify-end" : "justify-start"}`}>
        <article className="max-w-[92%] rounded-md border border-emerald-300 bg-white px-3 py-2 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <select
              value={editSpeaker}
              onChange={(event) => setEditSpeaker(event.target.value as SessionSpeaker)}
              disabled={isSaving}
              className="min-h-9 rounded-md border border-stone-300 bg-white px-2 text-[12px] font-black text-stone-700 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            >
              <option value="elder">本人</option>
              <option value="caregiver">介護者</option>
            </select>
            <textarea
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              disabled={isSaving}
              rows={3}
              className="min-h-20 resize-y rounded-md border border-stone-300 bg-white px-2 py-2 text-[13px] font-bold leading-relaxed text-stone-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-stone-100"
            />
          </div>
          {errorText ? (
            <p className="mt-2 text-[12px] font-bold text-red-700">
              {errorText}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setEditSpeaker(normalizeSpeaker(props.utterance.speaker));
                setEditText(props.utterance.text);
                setIsEditing(false);
              }}
              disabled={isSaving}
              className="min-h-8 rounded-md border border-stone-300 bg-white px-3 text-[12px] font-black text-stone-700 disabled:text-stone-400"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void deleteEdit()}
              disabled={isSaving}
              className="min-h-8 rounded-md border border-red-200 bg-red-50 px-3 text-[12px] font-black text-red-700 disabled:text-stone-400"
            >
              削除
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={isSaving || !editText.trim()}
              className="min-h-8 rounded-md bg-emerald-700 px-3 text-[12px] font-black text-white disabled:bg-stone-300"
            >
              保存
            </button>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className={`flex ${isSpeakerB ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[88%] rounded-md border px-3 py-1.5 shadow-sm ${
          isSpeakerB
            ? "border-sky-700 bg-sky-700 text-white"
            : "border-stone-200 bg-[#fffdf7] text-stone-950"
        }`}
      >
        <div className="mb-0.5 flex items-center justify-between gap-3">
          <div
            className={`text-[10px] font-black ${
              isSpeakerB ? "text-sky-100" : "text-emerald-700"
            }`}
          >
            {speakerLabel(normalizedSpeaker)}
          </div>
          {props.editable && props.onUpdate && props.onDelete ? (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className={`rounded-md px-2 py-0.5 text-[10px] font-black ${
                isSpeakerB
                  ? "bg-sky-100 text-sky-800"
                  : "bg-stone-100 text-stone-600"
              }`}
            >
              編集
            </button>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-snug">
          {props.utterance.text}
        </p>
        <time
          className={`mt-1 block text-[10px] font-bold ${
            isSpeakerB ? "text-sky-100" : "text-stone-400"
          }`}
        >
          {formatDateTime(props.utterance.created_at)}
        </time>
      </article>
    </div>
  );
}

export function ActionButton(props: {
  label: string;
  tone?: "emerald" | "blue" | "amber" | "stone";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const tone = props.tone ?? "stone";
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-100 text-emerald-900"
      : tone === "blue"
        ? "border-sky-200 bg-sky-100 text-sky-900"
        : tone === "amber"
          ? "border-amber-200 bg-amber-100 text-amber-900"
          : "border-stone-500 bg-stone-500 text-white";

  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`min-h-12 rounded-md border px-2 text-[13px] font-black leading-tight shadow-sm active:scale-[0.99] disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 ${toneClass}`}
    >
      {props.busy ? "処理中" : props.label}
    </button>
  );
}

export function RemoteMicStatus(props: {
  statuses: Record<SessionSpeaker, RemoteMicRoleStatusLike>;
}) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
      <h2 className="text-[14px] font-black">スマートフォンマイク</h2>
      <div className="mt-2 grid gap-2">
        <MicStatusRow label="本人用マイク" status={props.statuses.elder} />
        <MicStatusRow label="介護者用マイク" status={props.statuses.caregiver} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a
          href="/mic/elder"
          target="_blank"
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-[12px] font-black text-stone-700"
        >
          本人用を開く
        </a>
        <a
          href="/mic/caregiver"
          target="_blank"
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-[12px] font-black text-stone-700"
        >
          介護者用を開く
        </a>
      </div>
    </section>
  );
}

function MicStatusRow(props: { label: string; status: RemoteMicRoleStatusLike }) {
  const ready = props.status.ready;
  const captureState = props.status.captureState ?? "idle";
  const value = ready
    ? captureState === "suppressed"
      ? "AI音声中ミュート"
      : "接続済み"
    : props.status.status === "connected"
      ? "接続確認中"
      : "未接続";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <span className="text-[12px] font-bold text-stone-600">{props.label}</span>
      <span
        className={`rounded-md px-2 py-0.5 text-[11px] font-black ${
          ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function EmptyState(props: { text: string }) {
  return (
    <div className="flex min-h-full items-center justify-center rounded-md bg-white px-4 text-center text-[13px] font-bold text-stone-500">
      {props.text}
    </div>
  );
}

export function createConversationEntries<
  TUtterance extends UtteranceLike,
  TTranscript extends LiveTranscriptLike,
>(
  utterances: TUtterance[],
  liveTranscripts: TTranscript[],
): RemoteMicConversationEntryLike[] {
  const finalSourceGroupIds = new Set(
    utterances
      .map((utterance) => utterance.source_group_id?.trim())
      .filter((sourceGroupId): sourceGroupId is string => Boolean(sourceGroupId)),
  );

  return [
    ...utterances.map((utterance) => ({
      kind: "final" as const,
      key: utterance.source_group_id || utterance.id,
      createdAt: utterance.created_at,
      utterance,
    })),
    ...liveTranscripts
      .filter((transcript) => !finalSourceGroupIds.has(transcript.transcriptId))
      .map((transcript) => ({
        kind: "live" as const,
        key: transcript.key,
        createdAt:
          transcript.startedAt ??
          transcript.firstPartialAt ??
          transcript.finalizedAt ??
          new Date().toISOString(),
        transcript,
      })),
  ].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
}

export function formatDateTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function normalizeSpeaker(speaker: string): SessionSpeaker {
  return speaker === "caregiver" ? "caregiver" : "elder";
}

export function speakerLabel(speaker: SessionSpeakerWithUnknown) {
  if (speaker === "caregiver") return "介護者";
  if (speaker === "elder") return "本人";
  return "不明";
}

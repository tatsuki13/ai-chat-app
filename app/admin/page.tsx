"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type SessionSummary = {
  id: string;
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  ended_at: string | null;
  utterance_count: number;
  button_event_count: number;
  ai_suggestion_count: number;
  has_final_minutes: boolean;
};

type AdminDetail = {
  session: {
    id: string;
    participant_code: string | null;
    condition: string | null;
    started_at: string;
    ended_at: string | null;
  };
  utterances: Array<{
    id: string;
    speaker: string;
    text: string;
    created_at: string;
  }>;
  button_events: Array<{
    id: string;
    button_type: string;
    created_at: string;
  }>;
  ai_suggestions: Array<{
    id: string;
    trigger_event_id: string | null;
    suggestion_type: string;
    content: string;
    reasoning: string | null;
    target_slot: string | null;
    adopted: boolean | null;
    created_at: string;
  }>;
  slot_states: Array<{
    slot_name: string;
    status: "empty" | "partial" | "filled";
    summary: string;
    evidence_utterance: string;
    updated_at?: string;
  }>;
  final_minutes: Array<{
    id: string;
    markdown: string;
    json: unknown;
    created_at: string;
  }>;
};

export default function AdminPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AdminDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadSessions();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId]);

  const latestMinutes = detail?.final_minutes[0] ?? null;
  const finalJson = useMemo(() => {
    if (!latestMinutes) return "";
    return JSON.stringify(latestMinutes.json, null, 2);
  }, [latestMinutes]);

  async function loadSessions() {
    setLoading(true);
    setError("");

    try {
      const data = await fetchJson<{ sessions: SessionSummary[] }>("/api/admin/sessions");
      setSessions(data.sessions);
      setSelectedId((current) => current || data.sessions[0]?.id || "");
    } catch {
      setError("セッション一覧を取得できません");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true);
    setError("");

    try {
      const data = await fetchJson<AdminDetail>(`/api/admin/session/${encodeURIComponent(id)}`);
      setDetail(data);
    } catch {
      setError("セッション詳細を取得できません");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#f5f6f2] text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-[13px] font-bold text-stone-500">ACP対話支援</p>
            <h1 className="text-[24px] font-black leading-tight">実験者用admin</h1>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/session"
              className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-[15px] font-bold text-stone-700"
            >
              /session
            </a>
            <button
              type="button"
              onClick={loadSessions}
              className="rounded-lg bg-stone-950 px-4 py-3 text-[15px] font-bold text-white"
            >
              更新
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-4 px-5 py-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-[240px] rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 px-4 py-3">
            <h2 className="text-[18px] font-black">セッション一覧</h2>
          </div>
          <div className="max-h-[calc(100dvh-164px)] overflow-y-auto p-2">
            {loading ? (
              <p className="px-3 py-4 text-[15px] font-bold text-stone-500">読み込み中</p>
            ) : sessions.length === 0 ? (
              <p className="px-3 py-4 text-[15px] font-bold text-stone-500">セッションなし</p>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className={`mb-2 w-full rounded-lg border px-3 py-3 text-left active:scale-[0.995] ${
                    selectedId === session.id
                      ? "border-emerald-300 bg-emerald-50"
                      : "border-stone-200 bg-white hover:bg-stone-50"
                  }`}
                >
                  <div className="truncate text-[17px] font-black">
                    {session.participant_code ?? "参加者ID未設定"}
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] font-bold text-stone-400">
                    {session.id}
                  </div>
                  <div className="mt-1 text-[13px] font-bold text-stone-500">
                    {formatDateTime(session.started_at)}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[12px] font-black">
                    <Metric value={session.utterance_count} label="発話" />
                    <Metric value={session.button_event_count} label="ボタン" />
                    <Metric value={session.ai_suggestion_count} label="AI" />
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[15px] font-bold text-red-700">
              {error}
            </div>
          ) : null}

          {!detail || detailLoading ? (
            <div className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-center text-[16px] font-bold text-stone-500 shadow-sm">
              {detailLoading ? "詳細を読み込み中" : "セッションを選択してください"}
            </div>
          ) : (
            <>
              <Panel title="セッション">
                <div className="grid gap-3 text-[14px] font-bold text-stone-700 md:grid-cols-4">
                  <Info label="参加者ID" value={detail.session.participant_code ?? "-"} />
                  <Info label="内部ID" value={detail.session.id} />
                  <Info label="condition" value={detail.session.condition ?? "-"} />
                  <Info label="started_at" value={formatDateTime(detail.session.started_at)} />
                </div>
              </Panel>

              <Panel title="発話ログ">
                <div className="space-y-2">
                  {detail.utterances.map((utterance) => (
                    <LogRow
                      key={utterance.id}
                      time={utterance.created_at}
                      label={utterance.speaker === "elder" ? "本人" : "介護者"}
                      body={utterance.text}
                    />
                  ))}
                  {detail.utterances.length === 0 ? <EmptyLine /> : null}
                </div>
              </Panel>

              <Panel title="ボタン押下ログ">
                <div className="grid gap-2 md:grid-cols-2">
                  {detail.button_events.map((event) => (
                    <div key={event.id} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                      <div className="text-[14px] font-black">{buttonLabel(event.button_type)}</div>
                      <div className="mt-1 text-[12px] font-bold text-stone-500">
                        {formatDateTime(event.created_at)}
                      </div>
                      <div className="mt-1 truncate font-mono text-[11px] text-stone-400">{event.id}</div>
                    </div>
                  ))}
                  {detail.button_events.length === 0 ? <EmptyLine /> : null}
                </div>
              </Panel>

              <Panel title="AI提案ログ">
                <div className="space-y-3">
                  {detail.ai_suggestions.map((suggestion) => (
                    <article key={suggestion.id} className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{suggestion.suggestion_type}</Badge>
                        <Badge>{suggestion.target_slot ?? "targetなし"}</Badge>
                        <Badge>{suggestion.adopted === true ? "採用" : suggestion.adopted === false ? "不採用" : "未記録"}</Badge>
                        <span className="text-[12px] font-bold text-stone-500">
                          {formatDateTime(suggestion.created_at)}
                        </span>
                      </div>
                      <p className="mt-3 whitespace-pre-wrap text-[16px] font-bold leading-relaxed">
                        {suggestion.content}
                      </p>
                      <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                        <div className="text-[12px] font-black text-stone-500">reasoning</div>
                        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">
                          {suggestion.reasoning || "-"}
                        </p>
                      </div>
                      <div className="mt-2 truncate font-mono text-[11px] text-stone-400">
                        trigger_event_id: {suggestion.trigger_event_id ?? "-"}
                      </div>
                    </article>
                  ))}
                  {detail.ai_suggestions.length === 0 ? <EmptyLine /> : null}
                </div>
              </Panel>

              <Panel title="ACPスロット状態">
                <div className="grid gap-3 xl:grid-cols-2">
                  {detail.slot_states.map((slot) => (
                    <article key={slot.slot_name} className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-[16px] font-black leading-snug">{slot.slot_name}</h3>
                        <StatusBadge status={slot.status} />
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-stone-700">
                        {slot.summary}
                      </p>
                      <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                        <div className="text-[12px] font-black text-stone-500">evidence_utterance</div>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-700">
                          {slot.evidence_utterance || "-"}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </Panel>

              <Panel title="最終議事録 Markdown/JSON">
                {latestMinutes ? (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <OutputBlock title="Markdown" value={latestMinutes.markdown} />
                    <OutputBlock title="JSON" value={finalJson} />
                  </div>
                ) : (
                  <EmptyLine />
                )}
              </Panel>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="text-[18px] font-black">{props.title}</h2>
      </div>
      <div className="p-4">{props.children}</div>
    </section>
  );
}

function Info(props: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="text-[12px] font-black text-stone-500">{props.label}</div>
      <div className="mt-1 break-words text-[14px]">{props.value}</div>
    </div>
  );
}

function Metric(props: { value: number; label: string }) {
  return (
    <span className="rounded-md bg-stone-100 px-2 py-1 text-stone-700">
      {props.value} {props.label}
    </span>
  );
}

function LogRow(props: { time: string; label: string; body: string }) {
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{props.label}</Badge>
        <span className="text-[12px] font-bold text-stone-500">{formatDateTime(props.time)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{props.body}</p>
    </article>
  );
}

function Badge(props: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[12px] font-black text-stone-700">
      {props.children}
    </span>
  );
}

function StatusBadge(props: { status: "empty" | "partial" | "filled" }) {
  const className =
    props.status === "filled"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : props.status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-stone-200 bg-stone-100 text-stone-600";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[12px] font-black ${className}`}>
      {props.status}
    </span>
  );
}

function OutputBlock(props: { title: string; value: string }) {
  return (
    <section>
      <h3 className="mb-2 text-[14px] font-black text-stone-600">{props.title}</h3>
      <textarea
        readOnly
        value={props.value}
        rows={18}
        className="w-full resize-y rounded-lg border border-stone-300 bg-stone-50 p-3 font-mono text-[12px] leading-relaxed text-stone-800"
      />
    </section>
  );
}

function EmptyLine() {
  return <p className="text-[15px] font-bold text-stone-500">なし</p>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json() as Promise<T>;
}

function buttonLabel(type: string) {
  const labels: Record<string, string> = {
    next_question: "質問する",
    switch_topic: "話題を変える",
    check_end: "終了確認",
    update_slots: "議事録更新",
  };

  return labels[type] ?? type;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

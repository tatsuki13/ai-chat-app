"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type MinutesSession = {
  participant_code: string | null;
  condition: string | null;
  started_at: string;
  ended_at: string | null;
};

type FinalMinutesPayload = {
  id: string;
  markdown: string;
  json: unknown;
  created_at: string;
};

type MinutesApiResponse = {
  session: MinutesSession;
  final_minutes: FinalMinutesPayload | null;
};

type ACPMinutesRecord = {
  title?: string;
  recordType?: string;
  themes?: Record<string, unknown>;
  narratives?: Record<string, ThemeNarrativeRecord | undefined>;
  overall_summary?: {
    core_values?: Array<{ text?: string; source_aspects?: string[]; source_utterance_ids?: string[] }>;
    cross_theme_connections?: Array<{
      text?: string;
      source_aspects?: string[];
      related_themes?: string[];
      source_utterance_ids?: string[];
    }>;
    undecided_things?: string[];
  };
};

type GroundedTextRecord = {
  text?: string;
  sourceUtteranceIds?: string[];
  sourceAspectIds?: string[];
};

type ThemeNarrativeRecord = {
  currentThought?: GroundedTextRecord | null;
  background?: GroundedTextRecord | null;
  conditions?: GroundedTextRecord[];
  uncertainties?: GroundedTextRecord[];
  tensions?: GroundedTextRecord[];
  confirmationNeeded?: GroundedTextRecord[];
};

type EvidenceRecord = {
  themeId?: string;
  aspectId?: string;
  evidenceUtteranceId?: string;
  evidenceText?: string;
  speaker?: string;
};

type ThemeDisplay = {
  id: string;
  number: number;
  title: string;
  currentThoughts: string[];
  background: string[];
  conditions: string[];
  uncertainties: string[];
  tensions: string[];
  confirmationNeeded: string[];
  evidence: EvidenceRecord[];
};

type ThemeDisplayDefinition = {
  id: string;
  title: string;
  currentKeys: readonly string[];
  backgroundPaths?: readonly (readonly string[])[];
  conditionKeys?: readonly string[];
  uncertaintyKeys?: readonly string[];
  booleanUncertaintyKey?: string;
};

const THEME_ORDER: readonly ThemeDisplayDefinition[] = [
  {
    id: "current_life_values",
    title: "今の暮らしの中で大切にしていること",
    currentKeys: ["life_supports"],
    backgroundPaths: [
      ["reason"],
      ["background", "relationships"],
      ["background", "role"],
      ["background", "attachment"],
    ],
  },
  {
    id: "future_life_continuity",
    title: "これからも守っていきたい暮らし",
    currentKeys: ["continued_activity", "self_continuation", "not_want_to_lose"],
    backgroundPaths: [["reason"], ["important_for_continuation"]],
    conditionKeys: ["acceptable_change"],
  },
  {
    id: "selfhood",
    title: "「自分らしく暮らす」ために大切なこと",
    currentKeys: ["self_determination", "respect", "purpose_or_role", "lifestyle"],
    backgroundPaths: [
      ["other_important_things", "privacy"],
      ["other_important_things", "connection"],
      ["other_important_things", "comfort"],
    ],
  },
  {
    id: "care_support",
    title: "もし手助けが必要になったら",
    currentKeys: [
      "acceptable_support",
      "unacceptable_support",
      "self_scope",
      "support_person",
      "support_decision",
    ],
    backgroundPaths: [["anxiety"]],
    conditionKeys: ["support_condition"],
  },
  {
    id: "family_communication",
    title: "家族に伝えておきたいこと",
    currentKeys: [
      "request",
      "burden_concern",
      "feelings",
      "expected_judgement",
      "avoidance",
      "non_family_support",
    ],
    uncertaintyKeys: ["unspoken"],
  },
  {
    id: "proxy_decision_support",
    title: "もし自分で医療や介護について決めることが難しくなったら",
    currentKeys: [
      "trusted_person",
      "trust_reason",
      "values_to_share",
      "involvement",
      "multiple_people",
    ],
    uncertaintyKeys: ["hard_to_decide"],
    booleanUncertaintyKey: "not_decided",
  },
] as const;

export default function MinutesPage() {
  return (
    <Suspense fallback={<MinutesShell><StatusBlock title="読み込み中" body="議事録を読み込んでいます。" /></MinutesShell>}>
      <MinutesPageClient />
    </Suspense>
  );
}

function MinutesPageClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("sessionId")?.trim() ?? "";
  const [data, setData] = useState<MinutesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    async function load() {
      if (!sessionId) {
        setError("sessionId が指定されていません。");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/session/${sessionId}/minutes`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Failed to load minutes: ${response.status}`);
        const nextData = (await response.json()) as MinutesApiResponse;
        if (!ignore) setData(nextData);
      } catch {
        if (!ignore) setError("議事録を読み込めませんでした。");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();

    return () => {
      ignore = true;
    };
  }, [sessionId]);

  const minutesJson = data?.final_minutes?.json;
  const acpMinutes = getAcpMinutes(minutesJson);
  const themeEvidence = useMemo(() => collectThemeEvidence(minutesJson), [minutesJson]);
  const themes = useMemo(
    () => buildThemeDisplays(acpMinutes, themeEvidence),
    [acpMinutes, themeEvidence],
  );

  if (loading) {
    return <MinutesShell><StatusBlock title="読み込み中" body="議事録を読み込んでいます。" /></MinutesShell>;
  }

  if (error) {
    return <MinutesShell><StatusBlock title="議事録を表示できません" body={error} /></MinutesShell>;
  }

  if (!data?.final_minutes || !acpMinutes) {
    return (
      <MinutesShell>
        <StatusBlock
          title="議事録はまだ作成されていません"
          body="対話を終了すると議事録が作成されます。"
        />
      </MinutesShell>
    );
  }

  return (
    <MinutesShell>
      <MinutesPrintStyles />
      <div className="print-hidden mb-4 flex flex-wrap items-center justify-between gap-3">
        <a
          href={`/session?sessionId=${encodeURIComponent(sessionId)}`}
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-[13px] font-black text-stone-700"
        >
          セッションへ戻る
        </a>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-bold text-stone-500">
            印刷画面から「PDFとして保存」を選択できます。
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-stone-950 px-4 py-2 text-[13px] font-black text-white"
          >
            印刷 / PDFとして保存
          </button>
        </div>
      </div>

      <article className="rounded-md border border-stone-200 bg-white px-7 py-8 text-stone-800 shadow-sm print:border-0 print:px-0 print:py-0 print:shadow-none">
        <MinutesHeader
          session={data.session}
          createdAt={data.final_minutes.created_at}
          title={acpMinutes.title || "これからの暮らしと大切にしたいこと"}
        />
        <MinutesOverview minutes={acpMinutes} />
        <div className="mt-8 space-y-7">
          {themes.map((theme) => (
            <MinutesThemeSection key={theme.id} theme={theme} />
          ))}
        </div>
        <MinutesFooter />
      </article>
    </MinutesShell>
  );
}

function MinutesShell(props: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#f7f8f4] px-4 py-6 text-stone-950 print:bg-white print:px-0 print:py-0">
      <section className="mx-auto w-full max-w-[920px] print:max-w-none">
        {props.children}
      </section>
    </main>
  );
}

function StatusBlock(props: { title: string; body: string }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white px-5 py-4 shadow-sm">
      <h1 className="text-[18px] font-black text-stone-950">{props.title}</h1>
      <p className="mt-2 text-[14px] font-bold text-stone-600">{props.body}</p>
    </section>
  );
}

function MinutesHeader(props: {
  session: MinutesSession;
  createdAt: string;
  title: string;
}) {
  return (
    <header className="border-b border-stone-200 pb-5">
      <p className="text-[13px] font-black text-emerald-800">ACP 話し合いの記録</p>
      <h1 className="mt-2 text-[28px] font-black leading-tight text-stone-950">
        {props.title}
      </h1>
      <dl className="mt-4 grid gap-2 text-[13px] font-bold text-stone-600 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-black text-stone-500">作成日</dt>
          <dd>{formatDate(props.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-black text-stone-500">参加者ID</dt>
          <dd>{props.session.participant_code || "-"}</dd>
        </div>
      </dl>
    </header>
  );
}

function MinutesOverview(props: { minutes: ACPMinutesRecord }) {
  const items = [
    ...summaryTexts(props.minutes.overall_summary?.core_values),
    ...summaryTexts(props.minutes.overall_summary?.cross_theme_connections),
  ].slice(0, 5);

  return (
    <section className="minutes-subsection mt-6 rounded-md border border-emerald-100 bg-emerald-50 px-5 py-4">
      <h2 className="text-[17px] font-black text-stone-950">今回の話し合いから見えてきたこと</h2>
      <p className="mt-2 text-[13px] font-semibold leading-7 text-stone-700">
        この記録の「現在の考え」「背景・理由」などの文章は、話し合いで実際に語られた発言を根拠として、内容を変えない範囲で読みやすく整理しています。
        各テーマの「根拠となった発言」では、整理のもとになった実際の発言を確認できます。
        この記録だけで本人の意思を断定せず、必要に応じて本人との継続的な話し合いに活用してください。
      </p>
      {items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item} className="text-[14px] font-semibold leading-relaxed text-stone-800">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function MinutesThemeSection(props: { theme: ThemeDisplay }) {
  const hasAnyContent =
    props.theme.currentThoughts.length > 0 ||
    props.theme.background.length > 0 ||
    props.theme.conditions.length > 0 ||
    props.theme.uncertainties.length > 0 ||
    props.theme.tensions.length > 0 ||
    props.theme.confirmationNeeded.length > 0 ||
    props.theme.evidence.length > 0;

  if (!hasAnyContent) return null;

  return (
    <section className="minutes-theme border-t border-stone-200 pt-7">
      <div className="flex items-baseline gap-3">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-stone-900 px-2 text-[12px] font-black text-white">
          {props.theme.number}
        </span>
        <h2 className="text-[21px] font-black leading-snug text-stone-950">
          {props.theme.title}
        </h2>
      </div>
      <div className="mt-5 space-y-5">
        <MinutesSubsection title="現在の考え" values={props.theme.currentThoughts} />
        <MinutesSubsection title="その背景・理由" values={props.theme.background} />
        <MinutesSubsection title="条件によって変わること" values={props.theme.conditions} tone="condition" />
        <MinutesSubsection title="まだ考えている途中のこと" values={props.theme.uncertainties} tone="uncertainty" />
        <MinutesSubsection title="本人の中に同時にある思い" values={props.theme.tensions} tone="tension" />
        <MinutesSubsection title="確認しておきたいこと" values={props.theme.confirmationNeeded} tone="attention" />
        <MinutesEvidenceList evidence={props.theme.evidence} />
      </div>
    </section>
  );
}

function MinutesSubsection(props: {
  title: string;
  values: string[];
  tone?: "condition" | "uncertainty" | "tension" | "attention";
}) {
  const values = uniqueStrings(props.values);
  if (values.length === 0) return null;

  const toneClass =
    props.tone === "attention"
      ? "border-amber-200 bg-amber-50"
      : props.tone === "uncertainty"
        ? "border-sky-100 bg-sky-50"
        : props.tone === "condition"
          ? "border-stone-200 bg-stone-50"
          : props.tone === "tension"
            ? "border-rose-100 bg-rose-50"
            : "border-transparent bg-white";

  return (
    <section className={`minutes-subsection rounded-md border px-4 py-4 ${toneClass}`}>
      <h3 className="text-[15px] font-black leading-snug text-stone-950">{props.title}</h3>
      <div className="mt-3 space-y-3">
        {values.map((value) => (
          <p key={value} className="whitespace-pre-wrap text-[14px] font-semibold leading-8 text-stone-800">
            {value}
          </p>
        ))}
      </div>
    </section>
  );
}

function MinutesEvidenceList(props: { evidence: EvidenceRecord[] }) {
  const evidence = dedupeEvidenceByUtteranceId(props.evidence).filter((item) => item.evidenceText);
  if (evidence.length === 0) return null;

  return (
    <section className="minutes-subsection">
      <h3 className="text-[15px] font-black text-stone-950">根拠となった発言</h3>
      <div className="mt-3 space-y-3">
        {evidence.slice(0, 8).map((item, index) => (
          <MinutesEvidenceQuote key={`${item.evidenceUtteranceId ?? index}-${index}`} evidence={item} />
        ))}
      </div>
    </section>
  );
}

function MinutesEvidenceQuote(props: { evidence: EvidenceRecord }) {
  const speaker = speakerLabel(props.evidence.speaker);
  const target = speaker === "本人" ? "介護者" : speaker === "介護者" ? "本人" : "相手";

  return (
    <blockquote className="evidence-card rounded-md border border-stone-200 border-l-4 border-l-stone-400 bg-stone-50 px-4 py-4">
      <p className="whitespace-pre-wrap text-[14px] font-semibold leading-7 text-stone-800">
        {quoteEvidenceText(stripEvidenceSpeaker(props.evidence.evidenceText ?? ""))}
      </p>
      <footer className="mt-2 text-[12px] font-black text-stone-500">
        {speaker} → {target}
      </footer>
    </blockquote>
  );
}

function MinutesFooter() {
  return (
    <footer className="mt-8 border-t border-stone-200 pt-4 text-[12px] font-semibold leading-relaxed text-stone-500">
      この記録は、話し合い時点で確認できた内容を整理したものです。本人の考えは、体調や生活状況、家族状況によって変化することがあります。
    </footer>
  );
}

function MinutesPrintStyles() {
  return (
    <style jsx global>{`
      @media print {
        .print-hidden {
          display: none !important;
        }

        @page {
          size: A4;
          margin: 15mm;
        }

        .minutes-subsection,
        .evidence-card {
          break-inside: avoid;
        }

        h1,
        h2,
        h3 {
          break-after: avoid;
        }

        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    `}</style>
  );
}

function getAcpMinutes(value: unknown): ACPMinutesRecord | null {
  if (!value || typeof value !== "object") return null;
  const json = value as Record<string, unknown>;
  const minutes = json.acp_minutes;
  if (!minutes || typeof minutes !== "object") return null;
  const record = minutes as ACPMinutesRecord;
  return record.recordType === "acp_discussion_record" ? record : null;
}

function buildThemeDisplays(
  minutes: ACPMinutesRecord | null,
  evidenceByTheme: Map<string, EvidenceRecord[]>,
): ThemeDisplay[] {
  const themes = minutes?.themes ?? {};

  return THEME_ORDER.map((definition, index) => {
    const source = recordValue(themes, definition.id);
    const narrative = minutes?.narratives?.[definition.id];
    const hasNarrative = Boolean(narrative);
    const uncertainties = hasNarrative
      ? collectNarrativeTexts(narrative?.uncertainties)
      : [
          ...collectKeys(source, definition.uncertaintyKeys ?? []),
          ...(definition.booleanUncertaintyKey && recordValue(source, definition.booleanUncertaintyKey) === true
            ? ["今回の話し合いでは、相談してほしい人をどこまで決めているかを確認できていません。"]
            : []),
          ...collectOverallUndecided(minutes, definition.id),
        ];
    const conditions = hasNarrative
      ? collectNarrativeTexts(narrative?.conditions)
      : collectKeys(source, definition.conditionKeys ?? []);
    const currentThoughts = hasNarrative
      ? collectNarrativeTexts(narrative?.currentThought)
      : collectKeys(source, definition.currentKeys);
    const background = hasNarrative
      ? collectNarrativeTexts(narrative?.background)
      : collectPaths(source, definition.backgroundPaths ?? []);
    const tensions = hasNarrative ? collectNarrativeTexts(narrative?.tensions) : [];
    const confirmationNeeded = buildConfirmationNotes(definition.id, source);
    const narrativeConfirmation = hasNarrative
      ? collectNarrativeTexts(narrative?.confirmationNeeded)
      : [];

    return {
      id: definition.id,
      number: index + 1,
      title: definition.title,
      currentThoughts,
      background,
      conditions,
      uncertainties,
      tensions,
      confirmationNeeded: uniqueStrings([...narrativeConfirmation, ...confirmationNeeded]),
      evidence: evidenceByTheme.get(definition.id) ?? [],
    };
  });
}

function collectThemeEvidence(value: unknown) {
  const map = new Map<string, EvidenceRecord[]>();
  if (!value || typeof value !== "object") return map;
  const json = value as Record<string, unknown>;
  const themes = Array.isArray(json.themes) ? json.themes : [];

  themes.forEach((theme) => {
    if (!theme || typeof theme !== "object") return;
    const themeRecord = theme as Record<string, unknown>;
    const themeId = typeof themeRecord.theme_id === "string" ? themeRecord.theme_id : "";
    const aspects = Array.isArray(themeRecord.aspects) ? themeRecord.aspects : [];
    const evidence = aspects.flatMap((aspect) => {
      if (!aspect || typeof aspect !== "object") return [];
      const aspectRecord = aspect as Record<string, unknown>;
      const items = Array.isArray(aspectRecord.evidence) ? aspectRecord.evidence : [];
      return items
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          themeId,
          aspectId: stringValue(aspectRecord.aspect_id),
          evidenceUtteranceId: stringValue(item.evidenceUtteranceId),
          evidenceText: stringValue(item.evidenceText),
          speaker: stringValue(item.speaker),
        }));
    });
    if (themeId && evidence.length > 0) {
      map.set(themeId, evidence);
    }
  });

  return map;
}

function collectNarrativeTexts(
  value: GroundedTextRecord | GroundedTextRecord[] | null | undefined,
) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return uniqueStrings(
    items
      .filter((item) => Array.isArray(item.sourceUtteranceIds) && item.sourceUtteranceIds.length > 0)
      .map((item) => item.text?.trim() ?? "")
      .filter(Boolean),
  );
}

function dedupeEvidenceByUtteranceId(evidence: EvidenceRecord[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key =
      item.evidenceUtteranceId?.trim() ||
      [
        speakerLabel(item.speaker),
        "target",
        normalizeEvidenceDedupeText(stripEvidenceSpeaker(item.evidenceText ?? "")),
      ].join(":");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectKeys(source: unknown, keys: readonly string[]) {
  return keys.flatMap((key) => stringArray(recordValue(source, key)));
}

function collectPaths(source: unknown, paths: readonly (readonly string[])[]) {
  return paths.flatMap((path) => {
    const value = path.reduce<unknown>((current, key) => recordValue(current, key), source);
    return typeof value === "string" ? stringArray([value]) : stringArray(value);
  });
}

function collectOverallUndecided(minutes: ACPMinutesRecord | null, themeId: string) {
  if (themeId !== "proxy_decision_support") return [];
  return stringArray(minutes?.overall_summary?.undecided_things);
}

function buildTensionNotes(currentThoughts: string[], uncertainties: string[]) {
  if (currentThoughts.length === 0 || uncertainties.length === 0) return [];
  return [
    "現在の考えとして話されている内容と、まだ決めきれていない内容が同時に残っている。どちらか一方に整理せず、次回以降も本人の言葉で確認する。",
  ];
}

function buildConfirmationNotes(themeId: string, source: unknown) {
  if (themeId !== "proxy_decision_support") return [];
  const trusted = stringArray(recordValue(source, "trusted_person"));
  const notDecided = recordValue(source, "not_decided") === true;
  if (!trusted.length || !notDecided) return [];

  return [
    "相談してほしい人に関する発言がある一方で、特定の人をまだ決めていないという記録も残っている。相談相手の希望なのか、代理意思決定者までは決めていないという意味なのかは、次回の話し合いで確認する。",
  ];
}

function summaryTexts(items: Array<{ text?: string }> | undefined) {
  return (items ?? [])
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text));
}

function recordValue(source: unknown, key: string) {
  return source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? uniqueStrings(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function speakerLabel(value: unknown) {
  if (value === "elder") return "本人";
  if (value === "caregiver") return "介護者";
  return "発言者";
}

function stripEvidenceSpeaker(value: string) {
  return value.replace(/^(本人|家族|介護者|その他|elder|caregiver)\s*[:：]\s*/i, "").trim();
}

function quoteEvidenceText(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text.startsWith("「") && text.endsWith("」") ? text : `「${text}」`;
}

function normalizeEvidenceDedupeText(value: string) {
  return value.replace(/\s+/g, "").replace(/[「」『』"']/g, "").trim();
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

"use client";

import type { ReactNode } from "react";
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

type GroundedText = {
  text?: string;
  sourceUtteranceIds?: string[];
  sourceAspectIds?: string[];
};

type ThemeNarrative = {
  currentThought?: GroundedText | null;
  background?: GroundedText | null;
  conditions?: GroundedText[];
  uncertainties?: GroundedText[];
  tensions?: GroundedText[];
  confirmationNeeded?: GroundedText[];
};

type ACPMinutes = {
  title?: string;
  recordType?: string;
  narratives?: Record<string, ThemeNarrative | undefined>;
  overall_summary?: {
    core_values?: Array<{ text?: string }>;
    cross_theme_connections?: Array<{ text?: string }>;
  };
};

type MinutesJson = {
  themes?: ThemeSourceRecord[];
};

type ThemeSourceRecord = {
  theme_id?: string;
  title?: string;
  aspects?: AspectSourceRecord[];
};

type AspectSourceRecord = {
  aspect_id?: string;
  label?: string;
  status?: string;
  completion?: "none" | "partial" | "complete";
  responseState?:
    | "answered"
    | "no_response"
    | "explicit_none"
    | "not_considered"
    | "unable_to_verbalize"
    | "declined"
    | "ambiguous"
    | "conflicting";
  reasonCode?: string | null;
  canAskAgain?: boolean;
  isDeferred?: boolean;
  evidence?: EvidenceRecord[];
};

type EvidenceRecord = {
  themeId?: string;
  aspectId?: string;
  evidenceUtteranceId?: string;
  evidenceText?: string;
  speaker?: string;
};

type ThemeDefinition = {
  id: string;
  title: string;
};

type ThemeGroupDefinition = {
  id: string;
  title: string;
  description: string;
  themeIds: string[];
};

type SectionEvidenceMap = {
  currentThought: EvidenceRecord[];
  background: EvidenceRecord[];
  conditions: EvidenceRecord[];
  uncertainties: EvidenceRecord[];
  tensions: EvidenceRecord[];
  confirmationNeeded: EvidenceRecord[];
};

type ThemeForDisplay = ThemeDefinition & {
  number: number;
  currentThought: string[];
  background: string[];
  conditions: string[];
  uncertainties: string[];
  tensions: string[];
  confirmationNeeded: string[];
  evidence: EvidenceRecord[];
  evidenceBySection: SectionEvidenceMap;
};

const THEME_ORDER: readonly ThemeDefinition[] = [
  { id: "current_life_values", title: "今の暮らしの中で大切にしていること" },
  { id: "future_life_continuity", title: "これからも守っていきたい暮らし" },
  { id: "selfhood", title: "「自分らしく暮らす」ために大切なこと" },
  { id: "care_support", title: "もし手助けが必要になったら" },
  { id: "family_communication", title: "家族に伝えておきたいこと" },
  {
    id: "proxy_decision_support",
    title: "もし自分で医療や介護について決めることが難しくなったら",
  },
];

const THEME_GROUPS: readonly ThemeGroupDefinition[] = [
  {
    id: "life",
    title: "A. 大切にしている暮らし",
    description: "本人が今大切にしている生活と、これからも続けたいこと。",
    themeIds: ["current_life_values", "future_life_continuity"],
  },
  {
    id: "support",
    title: "B. 支援を受けるときに大切にしてほしいこと",
    description: "本人らしさを保つための支援の受け方や配慮。",
    themeIds: ["selfhood", "care_support"],
  },
  {
    id: "decision",
    title: "C. 家族・意思決定について",
    description: "本人・家族・専門職が意思決定するときに大切にしてほしいこと。",
    themeIds: ["family_communication", "proxy_decision_support"],
  },
];

export default function MinutesPage() {
  return (
    <Suspense
      fallback={
        <MinutesShell>
          <StatusBlock title="読み込み中" body="議事録を読み込んでいます。" />
        </MinutesShell>
      }
    >
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
        const response = await fetch(`/api/session/${encodeURIComponent(sessionId)}/minutes`, {
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
  const minutes = getACPMinutes(minutesJson);
  const evidenceByTheme = useMemo(() => collectEvidenceByTheme(minutesJson), [minutesJson]);
  const themes = useMemo(
    () => buildThemesForDisplay(minutes, evidenceByTheme),
    [minutes, evidenceByTheme],
  );
  const themeGroups = useMemo(() => buildThemeGroups(themes), [themes]);
  const overviewItems = useMemo(() => buildOverviewItems(minutes, themes), [minutes, themes]);
  const respectItems = useMemo(() => buildRespectItems(themes), [themes]);
  const followUpItems = useMemo(() => buildFollowUpItems(minutesJson), [minutesJson]);
  const hasNarrativeContent = themes.some(themeHasNarrativeText);
  const hasEvidenceOnly = !hasNarrativeContent && themes.some((theme) => theme.evidence.length > 0);

  if (loading) {
    return (
      <MinutesShell>
        <StatusBlock title="読み込み中" body="議事録を読み込んでいます。" />
      </MinutesShell>
    );
  }

  if (error) {
    return (
      <MinutesShell>
        <StatusBlock title="議事録を表示できません" body={error} />
      </MinutesShell>
    );
  }

  if (!data?.final_minutes || !minutes) {
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

      <article className="minutes-document rounded-md border border-stone-200 bg-white px-7 py-8 text-stone-850 shadow-sm print:border-0 print:px-0 print:py-0 print:shadow-none">
        <MinutesHeader
          session={data.session}
          createdAt={data.final_minutes.created_at}
          title={minutes.title || "これからの暮らしと大切にしたいこと"}
        />
        <MinutesOverview items={overviewItems} />
        <RespectPriorities items={respectItems} />
        {hasEvidenceOnly ? (
          <MissingNarrativeNotice sessionId={sessionId} />
        ) : (
          <div className="mt-10 space-y-10">
            {themeGroups.map((group) => (
              <ThemeGroup key={group.id} group={group} />
            ))}
          </div>
        )}
        <FollowUpSection items={followUpItems} />
        <MinutesFooter />
      </article>
    </MinutesShell>
  );
}

function MinutesShell(props: { children: ReactNode }) {
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

function MinutesOverview(props: { items: string[] }) {
  return (
    <section className="minutes-subsection mt-6 rounded-md border border-emerald-100 bg-emerald-50 px-5 py-5">
      <h2 className="text-[17px] font-black text-stone-950">
        今回の対話から見えた本人像
      </h2>
      {props.items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {props.items.map((item) => (
            <p key={item} className="text-[14px] font-semibold leading-8 text-stone-800">
              {item}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[14px] font-semibold leading-7 text-stone-700">
          今回の対話から確認できた本人像は、各テーマの詳細に整理されています。
        </p>
      )}
      <p className="mt-4 border-t border-emerald-100 pt-3 text-[12px] font-semibold leading-6 text-stone-600">
        各文章は、実際の発言を根拠として内容を変えない範囲で整理しています。必要な場合は、各項目の根拠発言を開いて確認できます。
      </p>
    </section>
  );
}

function RespectPriorities(props: { items: string[] }) {
  if (props.items.length === 0) return null;

  return (
    <section className="minutes-subsection mt-5 rounded-md border border-stone-200 bg-white px-5 py-5">
      <h2 className="text-[17px] font-black text-stone-950">
        医療・介護で特に尊重したいこと
      </h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {props.items.map((item) => (
          <li
            key={item}
            className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[13px] font-bold leading-6 text-stone-800"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ThemeGroup(props: { group: ThemeGroupDefinition & { themes: ThemeForDisplay[] } }) {
  const visibleThemes = props.group.themes.filter(themeHasNarrativeText);
  if (visibleThemes.length === 0) return null;

  return (
    <section className="minutes-group border-t-2 border-stone-900 pt-6">
      <div>
        <h2 className="text-[22px] font-black leading-snug text-stone-950">
          {props.group.title}
        </h2>
        <p className="mt-1 text-[13px] font-semibold leading-6 text-stone-600">
          {props.group.description}
        </p>
      </div>
      <div className="mt-6 space-y-8">
        {visibleThemes.map((theme) => (
          <ThemeSection key={theme.id} theme={theme} />
        ))}
      </div>
    </section>
  );
}

function ThemeSection(props: { theme: ThemeForDisplay }) {
  const hasContent = themeHasNarrativeText(props.theme);

  if (!hasContent) return null;

  return (
    <section className="minutes-theme rounded-md border border-stone-200 bg-white px-5 py-5">
      <div className="flex items-baseline gap-3">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-stone-900 px-2 text-[12px] font-black text-white">
          {props.theme.number}
        </span>
        <h2 className="text-[21px] font-black leading-snug text-stone-950">
          {props.theme.title}
        </h2>
      </div>

      <div className="mt-5 space-y-5">
        <TextSection
          title="現在の考え"
          values={props.theme.currentThought}
          evidence={props.theme.evidenceBySection.currentThought}
        />
        <TextSection
          title="その背景・理由"
          values={props.theme.background}
          evidence={props.theme.evidenceBySection.background}
        />
        <TextSection
          title={conditionSectionTitle(props.theme.id)}
          values={props.theme.conditions}
          evidence={props.theme.evidenceBySection.conditions}
          tone="condition"
        />
        <TextSection
          title="まだ考えている途中のこと"
          values={props.theme.uncertainties}
          evidence={props.theme.evidenceBySection.uncertainties}
          tone="uncertainty"
        />
        <TextSection
          title="本人の中に同時にある思い"
          values={props.theme.tensions}
          evidence={props.theme.evidenceBySection.tensions}
          tone="tension"
        />
        <TextSection
          title="確認しておきたいこと"
          values={props.theme.confirmationNeeded}
          evidence={props.theme.evidenceBySection.confirmationNeeded}
          tone="attention"
        />
      </div>
    </section>
  );
}

function MissingNarrativeNotice(props: { sessionId: string }) {
  return (
    <section className="mt-9 rounded-md border border-amber-200 bg-amber-50 px-5 py-5">
      <h2 className="text-[17px] font-black text-stone-950">
        議事録本文がまだ生成されていません
      </h2>
      <p className="mt-2 text-[14px] font-semibold leading-7 text-stone-700">
        この議事録データには根拠となった発言だけが保存されており、「現在の考え」や「その背景・理由」などの要約本文が入っていません。
        セッション画面に戻って、議事録をもう一度生成してください。
      </p>
      <a
        href={`/session?sessionId=${encodeURIComponent(props.sessionId)}`}
        className="mt-4 inline-flex rounded-md bg-stone-950 px-4 py-2 text-[13px] font-black text-white"
      >
        セッションへ戻る
      </a>
    </section>
  );
}

function TextSection(props: {
  title: string;
  values: string[];
  evidence?: EvidenceRecord[];
  tone?: "condition" | "uncertainty" | "tension" | "attention";
}) {
  const values = uniqueStrings(props.values);
  if (values.length === 0) return null;

  const toneClass =
    props.tone === "attention"
      ? "border-amber-200 bg-amber-50"
      : props.tone === "uncertainty"
        ? "border-sky-100 bg-sky-50"
        : props.tone === "tension"
          ? "border-rose-100 bg-rose-50"
          : props.tone === "condition"
            ? "border-stone-200 bg-stone-50"
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
      <EvidenceSection evidence={props.evidence ?? []} />
    </section>
  );
}

function EvidenceSection(props: { evidence: EvidenceRecord[] }) {
  const evidence = dedupeEvidence(props.evidence).filter((item) => item.evidenceText);
  if (evidence.length === 0) return null;

  return (
    <>
      <details className="evidence-details print-hidden mt-4 border-t border-stone-200 pt-3">
        <summary className="cursor-pointer text-[13px] font-black text-stone-700">
          根拠となった発言（{evidence.length}件）
        </summary>
        <div className="mt-3 space-y-3">
          {evidence.map((item, index) => (
            <EvidenceCard key={`${item.evidenceUtteranceId ?? index}-${index}`} evidence={item} />
          ))}
        </div>
      </details>
      <div className="hidden print:block mt-3 border-t border-stone-200 pt-2">
        <h4 className="text-[11px] font-black text-stone-600">根拠となった発言</h4>
        <div className="mt-2 space-y-1">
          {evidence.slice(0, 2).map((item, index) => (
            <p
              key={`${item.evidenceUtteranceId ?? index}-print-${index}`}
              className="text-[10px] font-semibold leading-5 text-stone-700"
            >
              {speakerLabel(item.speaker)}: {quoteText(stripSpeakerPrefix(item.evidenceText ?? ""))}
            </p>
          ))}
          {evidence.length > 2 ? (
            <p className="text-[10px] font-bold text-stone-500">
              ほか {evidence.length - 2} 件の根拠発言あり
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

function FollowUpSection(props: { items: string[] }) {
  if (props.items.length === 0) return null;

  return (
    <section className="minutes-subsection mt-10 border-t border-stone-200 pt-6">
      <h2 className="text-[19px] font-black text-stone-950">今後確認したいこと</h2>
      <p className="mt-2 text-[12px] font-semibold leading-6 text-stone-600">
        ここには、今回の対話で未確認の情報と、確認を見送った項目や保留として残した項目を整理しています。
      </p>
      <ul className="mt-4 space-y-2">
        {props.items.map((item) => (
          <li key={item} className="text-[13px] font-semibold leading-7 text-stone-800">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EvidenceCard(props: { evidence: EvidenceRecord }) {
  const speaker = speakerLabel(props.evidence.speaker);
  const target = speaker === "本人" ? "介護者" : speaker === "介護者" ? "本人" : "相手";

  return (
    <blockquote className="evidence-card rounded-md border border-stone-200 border-l-4 border-l-stone-400 bg-stone-50 px-4 py-4">
      <p className="whitespace-pre-wrap text-[14px] font-semibold leading-7 text-stone-800">
        {quoteText(stripSpeakerPrefix(props.evidence.evidenceText ?? ""))}
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
      迷いや未決定事項も含め、この記録だけで本人の意思を断定せず、今後の継続的な話し合いに活用してください。
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

        .minutes-theme {
          break-before: auto;
        }

        .evidence-card {
          break-inside: avoid;
        }

        .minutes-subsection {
          break-inside: auto;
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

function buildThemesForDisplay(
  minutes: ACPMinutes | null,
  evidenceByTheme: Map<string, EvidenceRecord[]>,
): ThemeForDisplay[] {
  return THEME_ORDER.map((definition, index) => {
    const narrative = minutes?.narratives?.[definition.id];
    const themeEvidence = evidenceByTheme.get(definition.id) ?? [];
    const evidenceBySection: SectionEvidenceMap = {
      currentThought: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.currentThought),
      ),
      background: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.background),
      ),
      conditions: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.conditions),
      ),
      uncertainties: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.uncertainties),
      ),
      tensions: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.tensions),
      ),
      confirmationNeeded: filterEvidenceBySourceIds(
        themeEvidence,
        collectSourceUtteranceIds(narrative?.confirmationNeeded),
      ),
    };

    return {
      ...definition,
      number: index + 1,
      currentThought: collectText(narrative?.currentThought),
      background: collectText(narrative?.background),
      conditions: collectText(narrative?.conditions),
      uncertainties: collectText(narrative?.uncertainties),
      tensions: collectText(narrative?.tensions),
      confirmationNeeded: collectText(narrative?.confirmationNeeded),
      evidence: themeEvidence,
      evidenceBySection,
    };
  });
}

function buildThemeGroups(themes: ThemeForDisplay[]) {
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));

  return THEME_GROUPS.map((group) => ({
    ...group,
    themes: group.themeIds
      .map((themeId) => themeById.get(themeId))
      .filter((theme): theme is ThemeForDisplay => Boolean(theme)),
  }));
}

function buildOverviewItems(minutes: ACPMinutes | null, themes: ThemeForDisplay[]) {
  const summaryItems = uniqueStrings([
    ...summaryTexts(minutes?.overall_summary?.core_values),
    ...summaryTexts(minutes?.overall_summary?.cross_theme_connections),
  ]);
  if (summaryItems.length > 0) return summaryItems.slice(0, 4);

  return uniqueStrings(
    themes.flatMap((theme) => theme.currentThought).map(firstSentence),
  ).slice(0, 4);
}

function buildRespectItems(themes: ThemeForDisplay[]) {
  const preferredOrder = [
    "current_life_values",
    "future_life_continuity",
    "selfhood",
    "care_support",
    "family_communication",
    "proxy_decision_support",
  ];
  const themeById = new Map(themes.map((theme) => [theme.id, theme]));
  const candidates = preferredOrder.flatMap((themeId) => {
    const theme = themeById.get(themeId);
    if (!theme) return [];
    return [...theme.currentThought, ...theme.conditions].map(firstSentence);
  });

  return uniqueStrings(candidates.map(toRespectItem)).filter(Boolean).slice(0, 6);
}

function buildFollowUpItems(value: unknown) {
  const json = value && typeof value === "object" ? (value as MinutesJson) : {};
  const themes = Array.isArray(json.themes) ? json.themes : [];
  const items = themes.flatMap((theme) => {
    const themeTitle = theme.title || "このテーマ";
    const aspects = Array.isArray(theme.aspects) ? theme.aspects : [];
    return aspects
      .map((aspect) => buildFollowUpItem(themeTitle, aspect))
      .filter((item): item is string => Boolean(item));
  });

  return uniqueStrings(items).slice(0, 8);
}

function buildFollowUpItem(themeTitle: string, aspect: AspectSourceRecord) {
  const label = aspect.label || "未確認の項目";
  const completion = aspect.completion;
  const responseState = aspect.responseState;
  const status = typeof aspect.status === "string" ? aspect.status : "";

  if (completion === "complete" || ["filled", "complete", "answered"].includes(status)) {
    return null;
  }

  const prefix = `${themeTitle}について、「${label}」は`;
  const evidenceText = buildFollowUpEvidenceText(aspect.evidence);
  const deferredText =
    aspect.isDeferred && aspect.canAskAgain !== false
      ? "関連する話題になったときに、自然に確認できる内容として残します。"
      : "";

  switch (responseState) {
    case "answered":
      return [
        evidenceText
          ? `${prefix}${evidenceText}という発言から一部確認できていますが、まだ部分的な確認にとどまっています。`
          : `${prefix}発言はありますが、まだ部分的な確認にとどまっています。`,
        deferredText,
      ].filter(Boolean).join("");
    case "no_response":
      return [
        `${prefix}今回の対話ではまだ話題になっていません。`,
        deferredText,
      ].filter(Boolean).join("");
    case "explicit_none":
      return `${prefix}本人から特にない、または該当するものはないとの意向が示されています。`;
    case "not_considered":
      return `${prefix}現時点ではまだ具体的には考えていない、または分からないとのことです。`;
    case "unable_to_verbalize":
      return `${prefix}今回は十分に言葉にすることが難しい状態でした。`;
    case "declined":
      return `${prefix}今回は話したくないとの意向が示されたため、それ以上の確認は行っていません。`;
    case "ambiguous":
      return [
        `${prefix}発言はありますが、今回の対話では意向を十分に明確化できていません。`,
        deferredText,
      ].filter(Boolean).join("");
    case "conflicting":
      return [
        `${prefix}複数の発言があり、現時点では考えが一つに整理されていません。`,
        deferredText,
      ].filter(Boolean).join("");
    default:
      if (status === "partial") {
        return [
          evidenceText
            ? `${prefix}${evidenceText}という発言から一部確認できていますが、まだ部分的な確認にとどまっています。`
            : `${prefix}一部確認できていますが、まだ部分的な確認にとどまっています。`,
          deferredText,
        ].filter(Boolean).join("");
      }
      if (status === "empty") {
        return [
          `${prefix}今回の対話ではまだ話題になっていません。`,
          deferredText,
        ].filter(Boolean).join("");
      }
      return null;
  }
}

function buildFollowUpEvidenceText(evidence: EvidenceRecord[] | undefined) {
  const first = evidence?.[0]?.evidenceText;
  if (!first) return "";
  const text = firstSentence(stripSpeakerPrefix(first)).replace(/[。.!?！？]$/, "");
  return text ? `「${text}」` : "";
}

function themeHasNarrativeText(theme: ThemeForDisplay) {
  return (
    theme.currentThought.length > 0 ||
    theme.background.length > 0 ||
    theme.conditions.length > 0 ||
    theme.uncertainties.length > 0 ||
    theme.tensions.length > 0 ||
    theme.confirmationNeeded.length > 0
  );
}

function conditionSectionTitle(themeId: string) {
  if (themeId === "selfhood" || themeId === "care_support") {
    return "支援や生活の中で配慮してほしいこと";
  }
  if (themeId === "future_life_continuity") return "できる範囲・条件";
  return "状況によって大切になること";
}

function getACPMinutes(value: unknown): ACPMinutes | null {
  if (!value || typeof value !== "object") return null;
  const json = value as Record<string, unknown>;
  const minutes = json.acp_minutes;
  if (!minutes || typeof minutes !== "object") return null;
  const record = minutes as ACPMinutes;
  return record.recordType === "acp_discussion_record" ? record : null;
}

function collectEvidenceByTheme(value: unknown) {
  const map = new Map<string, EvidenceRecord[]>();
  if (!value || typeof value !== "object") return map;

  const json = value as Record<string, unknown>;
  const themes = Array.isArray(json.themes) ? json.themes : [];

  themes.forEach((theme) => {
    if (!theme || typeof theme !== "object") return;
    const themeRecord = theme as Record<string, unknown>;
    const themeId = stringValue(themeRecord.theme_id);
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

    if (themeId && evidence.length > 0) map.set(themeId, evidence);
  });

  return map;
}

function collectText(value: GroundedText | GroundedText[] | string | string[] | null | undefined) {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  const items = Array.isArray(value) ? value : [value];

  return uniqueStrings(
    items
      .map((item) => (typeof item === "string" ? item.trim() : item.text?.trim() ?? ""))
      .filter(Boolean),
  );
}

function collectSourceUtteranceIds(
  value: GroundedText | GroundedText[] | string | string[] | null | undefined,
) {
  if (!value || typeof value === "string") return [];
  const items = Array.isArray(value) ? value : [value];

  return uniqueStrings(
    items.flatMap((item) =>
      typeof item === "string" ? [] : (item.sourceUtteranceIds ?? []),
    ),
  );
}

function filterEvidenceBySourceIds(evidence: EvidenceRecord[], sourceIds: string[]) {
  if (sourceIds.length === 0) return [];
  const sourceIdSet = new Set(sourceIds);

  return evidence.filter((item) =>
    item.evidenceUtteranceId ? sourceIdSet.has(item.evidenceUtteranceId) : false,
  );
}

function summaryTexts(items: Array<{ text?: string }> | undefined) {
  return (items ?? [])
    .map((item) => item.text?.trim())
    .filter((text): text is string => Boolean(text));
}

function firstSentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^.+?[。.!?！？]/);
  return (match ? match[0] : trimmed).trim();
}

function toRespectItem(value: string) {
  return value
    .replace(/^本人は、?/, "")
    .replace(/と考えている。$/, "こと")
    .replace(/を希望している。$/, "を希望している")
    .replace(/を大切にしている。$/, "を大切にしている")
    .replace(/です。$/, "")
    .trim();
}

function dedupeEvidence(evidence: EvidenceRecord[]) {
  const seen = new Set<string>();

  return evidence.filter((item) => {
    const key =
      item.evidenceUtteranceId?.trim() ||
      [speakerLabel(item.speaker), normalizeForDedupe(stripSpeakerPrefix(item.evidenceText ?? ""))].join(":");

    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function speakerLabel(value: unknown) {
  if (value === "elder") return "本人";
  if (value === "caregiver") return "介護者";
  return "発言者";
}

function stripSpeakerPrefix(value: string) {
  return value.replace(/^(本人|家族|介護者|その他|elder|caregiver)\s*[:：]\s*/i, "").trim();
}

function quoteText(value: string) {
  const text = value.trim();
  if (!text) return "";
  return text.startsWith("「") && text.endsWith("」") ? text : `「${text}」`;
}

function normalizeForDedupe(value: string) {
  return value.replace(/\s+/g, "").replace(/[「」『』"']/g, "").trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
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

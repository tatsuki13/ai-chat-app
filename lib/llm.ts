import OpenAI from "openai";
import {
  ACP_SLOT_NAMES,
  DISCUSSION_TOPIC,
  DISCUSSION_TOPICS,
  OPTIONAL_RESEARCH_THEMES,
  RESEARCH_THEMES,
  buildACPMinutesFromStructuredInput,
  buildFallbackMinutes,
  buildSlotControlDebugState,
  calculateThemeCompletenessMetrics,
  canAskAgainSubSlotState,
  canTransitionSubSlotState,
  createEmptySubSlotStates,
  getCoreResearchThemeAspects,
  getCrossTopicResearchThemeAspects,
  getOptionalResearchThemeAspects,
  getResearchThemeAspects,
  getResearchThemeEvidence,
  getResearchThemeResponseState,
  getResearchThemeSummary,
  getSlotResponseState,
  getCurrentTopicQuestionScope,
  getSlotResolution,
  getSubSlotDefinitions,
  getTopicAspects,
  getCoreAspects,
  getOptionalAspects,
  getCrossTopicAspects,
  getUnfilledSlots,
  isCaregiverSpeaker,
  isElderSpeaker,
  isDeferredSubSlotState,
  isTerminalSlotStatus,
  mergeSlotStates,
  normalizeSlotName,
  recentUtterances,
  renderACPMinutesMarkdown,
  renderTranscript,
  resolveDiscussionTopic,
  resolveSubSlotDefinition,
  resolveResearchThemeForSlot,
  validateACPMinutes,
  type ACPMinutes,
  type AcpSlotName,
  type AnswerDepth,
  type AuxiliaryMinutesItem,
  type AcpSlotState,
  type ConversationUtterance,
  type SlotClassificationResponseState,
  type SlotCompletion,
  type ScopedSlotStatus,
  type EndCheckResult,
  type FinalMinutesResult,
  type NextQuestionResult,
  type Sensitivity,
  type SlotReasonCode,
  type SlotControlDebugState,
  type StoredSubSlotState,
  type SubSlotCompletionRule,
  type SubSlotControlOverride,
  type TopicSwitchResult,
  type ThemeMinutesItem,
  type UnansweredReason,
} from "./acp-mvp";

type ConversationContext = {
  utterances: ConversationUtterance[];
  slotStates: AcpSlotState[];
  subSlotStates?: StoredSubSlotState[];
  sessionId?: string;
  participantCode?: string | null;
  currentTopic?: string;
  currentTopicTitle?: string;
  nextTopic?: string;
  nextTopicTitle?: string;
};

const NEXT_QUESTION_RECENT_UTTERANCE_COUNT = 16;
const NEXT_QUESTION_UNASSIGNED_UTTERANCE_COUNT = 16;
const NEXT_QUESTION_ALREADY_ASKED_COUNT = 12;

type ExplicitNoneResponse = {
  slotName: AcpSlotName;
  utterance: ConversationUtterance;
  index: number;
};

type UncertainResponseKind =
  | "unknown"
  | "not_considered"
  | "language_gap"
  | "knowledge_gap"
  | "emotional_load"
  | "undecided";

type UncertainResponse = {
  slotName: AcpSlotName;
  utterance: ConversationUtterance;
  index: number;
  kind: UncertainResponseKind;
};

export const AI_POLICY_VERSION = "hitl-acp-v1";

export function getOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

const COMMON_AI_POLICY = [
  "You are a third-party support assistant for a human-led family ACP conversation.",
  "Do not become a conversation partner for the elder or caregiver.",
  "Only support: question suggestion, topic transition suggestion, completion check, minutes generation, and slot state updates.",
  "Do not provide medical, caregiving, legal, moral, or value judgments.",
  "Do not infer facts that are not present in the saved utterance log.",
  "Do not invent ACP slots, topics, utterances, speakers, or slot statuses.",
  "Use only the provided acp_slots and available_topics when choosing target_slot or next_topic.",
  "A short uncertainty or deferral answer is valid ACP information; do not keep asking the same question mechanically.",
  "Return only the requested JSON shape.",
].join("\n");

const CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX = "介護者解釈に同意: ";

const SYSTEM_NEXT_QUESTION = [
  "あなたはACP対話を支援するAIです。",
  "あなたの役割は、会話を支配することではなく、介護者が自然に次の質問を行えるように、現在の文脈に最も合う質問を1つだけ生成することです。",
  "質問選択の主軸は current_topic です。ACP全体の未充足スロットは補助情報として扱ってください。",
  "通常の質問候補生成では question_scope に含まれる現在テーマのメインスロット、配下サブスロット、関連する保留項目だけを参照してください。",
  "question_scope.allSlotReferenceUsed は false である必要があります。将来テーマや現在テーマと無関係な未充足スロットを質問候補に含めないでください。",
  "研究上の評価単位は research_themes の6Themeです。available_topics は画面遷移用の話題であり、研究Themeそのものではありません。",
  "current_topic.aspects は記録整理と質問生成の補助であり、質問ノルマではありません。",
  "current_topic.core_aspectsを優先し、optional_aspectsを埋めるためだけの質問は生成しないでください。",
  "本人が未検討・不明・言語化困難・回答拒否を示した場合は有効な回答状態として扱い、追及しないでください。",
  "同じテーマで追加質問は最大1回までとし、同じ意味の質問を言い換えて繰り返さないでください。",
  "target_slot には acp_slots に含まれるACPスロットだけを指定してください。「未解決課題」は指定してはいけません。",
  "current_topic と無関係な未充足スロットへ急に移らないでください。",
  "未充足スロットを機械的に埋めるのではなく、直前の会話から自然につながる質問を選んでください。",
  "本人が「特にない」「今はない」「思いつかない」などと答えた場合、それを有効な回答として受け止め、同じ直接質問を繰り返さないでください。",
  "その話題を続ける必要がある場合は、「大切にしていることはありますか」の言い換えではなく、最近の出来事、嫌だったこと、避けたいこと、時間の使い方など具体的な別角度にしてください。",
  "質問は高齢者を責めず、答えやすく、介護者がそのまま読み上げられる日本語にしてください。",
  "重すぎる話題へ急に飛ばず、既に十分話されている内容を繰り返さないでください。",
  "next_question_input.askableSubSlots に含まれる mainSlotId/subSlotId の組み合わせだけを targetMainSlotId/targetSubSlotId に指定してください。",
  "askableSubSlots は、アプリケーション側が現在テーマ内かつ直近発話と自然に関連すると判断した候補です。askableSubSlots が空の場合は question を null、no_relevant_followup を true にしてください。",
  "未確認であることだけを理由に質問してはいけません。直近発話や会話文脈と自然につながる候補だけを質問してください。",
  "質問生成処理では次テーマへの遷移を実行・提案しないでください。関連候補がなければ追加質問なしとして返してください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  "Use next_question_input.slotBackedMemory as the stable record of what has already been captured in slots.",
  "Use next_question_input.unassignedRecentUtterances as possible conversational cues, but do not treat them as confirmed slot content unless the utterance itself clearly supports the question.",
  "When slotBackedMemory and recentUtterances conflict, prefer slotBackedMemory for coverage decisions and recentUtterances for natural wording.",
  '{"question":"... | null","transition_phrase":"...","target_slot":"...","targetMainSlotId":"...","targetSubSlotId":"...","reason":"...","sensitivity":"low | medium | high","no_relevant_followup":false}',
].join("\n");

const SYSTEM_CLASSIFY_SLOT_UTTERANCES = [
  "あなたはACP対話ログの発話を、固定されたメインスロット・サブスロット定義へ分類するAIです。",
  "あなたの役割は意味分類だけです。スロット状態の確定、保存可否、状態遷移、再質問可否はコード側が行います。",
  "提供された mainSlotId と subSlotId だけを使用してください。新しいID、スロット名、類似名、別名を作ってはいけません。",
  "発話内容を要約・正規化して正式な内容として返してはいけません。",
  "根拠は必ず conversation_log に存在する utterance.id で返してください。発話IDがない根拠は返さないでください。",
  "一つの発話につき分類は最大 maxClassificationsPerUtterance 件までにしてください。該当しない発話は unmatchedUtteranceIds に入れてください。",
  "介護者の解釈だけを本人意思にしないでください。介護者要約に本人が明確に同意した場合のみ、介護者要約発話IDと本人同意発話IDを両方 evidenceUtteranceIds に含めてください。",
  "Do not classify caregiver speech alone as the elder's preference. If caregiver speech is used as evidence, evidenceUtteranceIds must also include a nearby later elder agreement or elaboration utterance.",
  "A single elder utterance may support multiple aspects or themes. Return every supported classification, up to maxClassificationsPerUtterance, instead of forcing a single best aspect.",
  "Do not decide final slot completion or stored response state. Extract only observable evidence facts from this conversation turn.",
  "Set specificContentPresent true when the requested sub-slot content itself is clearly stated, even if reasons or conditions are not stated.",
  "Do not confuse answer depth with whether the person answered the question. A short clear preference is still specific content.",
  "Ignore currentSubSlotStates when extracting evidence. Use only the conversation_log evidence for this classification pass.",
  "For caregiver-only reports, return evidenceType caregiver_report_only, but do not treat it as confirmed elder preference.",
  'Use this output shape: {"classifications":[{"mainSlotId":"...","subSlotId":"...","relevantMentionPresent":true,"responsePresent":true,"specificContentPresent":true,"reasonPresent":false,"conditionPresent":false,"examplePresent":false,"ambiguityPresent":false,"conflictPresent":false,"responseMeaning":"preference_expressed | explicit_none | not_considered | unable_to_verbalize | declined | other_response | unknown","evidenceType":"direct_elder_statement | elder_confirmation | caregiver_report_with_elder_confirmation | caregiver_report_only | shared_statement | unknown","evidenceUtteranceIds":["..."],"classificationNote":"optional"}],"unmatchedUtteranceIds":["..."]}',
  "completion、responseState、reasonCode は出力しないでください。これらはコード側で導出します。",
  "出力はJSONのみとしてください。",
].join("\n");

const SYSTEM_END_CHECK = [
  "あなたはACP対話の終了確認を支援するAIです。",
  "会話ログとTheme単位のACPスロット状態を見て、今日の対話を終えてよいかを判定してください。",
  "終了判断の主対象は research_themes の6Themeです。optional_research_themes の未充足だけで終了不可にしないでください。",
  "すべてのAspectがfilledであることを終了条件にしてはいけません。",
  "未検討・不明・言語化困難・希望なし・回答拒否は有効なresponseStateとして扱い、単純な未回答にしないでください。",
  "任意Aspectや細かいAspectが未充足であることだけを理由に終了不可にしないでください。",
  "重要な未確認事項がある場合は、介護者が穏やかに確認できる一文を返してください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"can_end":true,"message":"...","reason":"...","remaining_slots":["..."]}',
].join("\n");

const SYSTEM_FINAL_MINUTES_FROM_STRUCTURED = [
  "あなたはACPの話し合い記録を作成するシステムです。",
  "添付PDFと同じ考え方で、短い全体概要、テーマごとの詳細、必要な整理枠、最後に根拠発言という構成を守ってください。",
  "今回の目的は情報量を減らすことではありません。ACP対話で得られた情報を、意味に応じて適切なセクションへ配置してください。",
  "入力されたslot/sub-slot/aspect情報と根拠発話だけを使用してください。入力にない事実、希望、理由、人物関係、医療判断を追加してはいけません。",
  "overall_summaryは「今回の話し合いから見えてきたこと」に表示する短い概要です。2〜4項目程度、1項目は1〜2文程度にしてください。全sub-slot、条件、迷い、未決定、根拠発話、次回確認事項をここへ詰め込まないでください。",
  "overall_summaryに書いた内容でも、各テーマの詳細から削除してはいけません。overall_summaryは入口であり、theme sectionが正式な記録です。",
  "各テーマでは、取得済みのslot/sub-slot/aspectを参照し、以下へ分けて記録してください: currentThought, background, conditions, uncertainties, tensions, confirmationNeeded。",
  "currentThoughtは、そのテーマの中心的内容です。主にcore sub-slot、本人の明確な希望、大切にしていること、避けたいこと、比較的明確に語られている考えを2〜5文程度で書いてください。テーマ内の情報すべてをcurrentThoughtへ押し込まないでください。",
  "backgroundは、本人がなぜそう考えているか、生活歴、人との関係、感情、これまでの経験が語られている場合に書いてください。根拠がなければnullにしてください。",
  "conditionsは、できる間はしたい、重い作業は難しい、状況による、全部今まで通りでなくてもよい等、条件によって変わる内容を書いてください。",
  "uncertaintiesは、まだ考えていない、まだ決めていない、今は分からない、状況による、その時にならないと分からない等を、欠損ではなく本人の意思形成状態として書いてください。",
  "tensionsは、本人の中にAを大切にしたい一方でBも気になる、という複数の思いがある場合に書いてください。一方へ統合しないでください。",
  "confirmationNeededは、発言同士の意味が一致しない、slotと発言が一致しない、本人の発言だけでは複数解釈可能、今回だけでは確定できない、相談相手と代理意思決定者が混在している場合に書いてください。本人の葛藤と記録上の確認事項を混同しないでください。",
  "会話の冗長表現は整理して構いませんが、具体的な生活行動、人との関係、本人の理由、避けたいこと、条件、迷い、未決定、家族への配慮、支援への考え、意思決定についての考えを削除してはいけません。",
  "現在の考え、背景・理由、条件、未決定、同時にある思い、確認事項は、発言原文をそのまま並べず、医療・介護従事者が読みやすい第三者記録文として書いてください。",
  "各生成文章には必ずsourceUtteranceIdsを付与してください。sourceUtteranceIdsで指定した発話から直接支持できない内容は書かないでください。",
  "根拠がない場合は、文章を作らずnullまたは空配列にしてください。",
  "JSON以外の文章を出力しないでください。",
  "あなたの役割は、ACP対話を浅く要約することではありません。slot / sub-slot / evidenceを材料に、医療・介護従事者が後から内容を理解できる記録文へ整理してください。",
  "sub-slot名や分類名を本文にそのまま書かないでください。「本人はこのテーマについて考えを話している」のような抽象的な説明文も禁止です。実際に本人が何を話したのかを書いてください。",
  "currentThoughtには、本人の現在の希望、大切にしていること、続けたいこと、避けたいこと、支援に関する比較的明確な考えを入れてください。",
  "backgroundには、なぜそう考えるのか、生活歴、人との関係、地域とのつながり、寂しさ、不安、負担感など、理由や背景として語られた内容を入れてください。",
  "conditionsには、できる範囲、重い作業は難しい、全部今まで通りでなくてもよい、必要なら支援を受けるなど、条件によって変わる内容を入れてください。",
  "uncertaintiesには、本人が実際に、まだ考えていない、まだ決めていない、分からない、その時にならないと分からない、と話した内容だけを入れてください。slotが未充足という理由だけで作らないでください。",
  "tensionsには、本人自身の発言から複数の思いが確認できる場合だけ入れてください。Aを大切にしたい一方でBも気になる、という双方を支えるsourceUtteranceIdsが必要です。単一sub-slotがcompleteであることだけを理由に作らないでください。",
  "confirmationNeededには、本人の葛藤ではなく、記録上の不整合、本人発言とslot状態の不一致、相談相手と代理意思決定者の混在、今回の発言だけでは確定できない事項を入れてください。",
  "not_decidedというslot状態だけを根拠に、本人が決めていないと本文化しないでください。本人の直接発言または本人確認のあるevidenceが必要です。",
  "同じutteranceが複数sub-slotに関係していても、根拠発言カードでは1回だけ表示されます。本文では、そのutteranceがどのsectionを支えるかsourceUtteranceIdsで追跡できるようにしてください。",
  "Narrative writing process: before writing each narrative field, internally convert each evidence utterance into meaning units that are directly confirmable from that utterance, then integrate compatible meaning units into natural Japanese clinical record text.",
  "narrative.text is not an excerpt area. The original utterances will be shown separately through sourceUtteranceIds, so never put the raw utterance text itself into narrative.text.",
  "Do not quote the original utterances in order, lightly rewrite each utterance one by one, or chain phrases such as 「〜と話している」「〜と述べている」. Your role is to express the confirmed meaning, not to reproduce the transcript.",
  "Do not create one sentence per source utterance. Do not try to reflect every sourceUtteranceId in the body text. Choose the minimum sufficient utterance IDs for the meaning you actually wrote.",
  "You may rephrase for readability, but you must not add intentions, emotions, values, reasons, causal links, medical judgments, or future preferences that are not directly supported by the evidence.",
  "When the utterance contains uncertainty or conditions such as 「できれば」「今のところ」「家族が大丈夫なら」「体が動くうちは」, preserve that strength and condition. Do not make the preference stronger or more definite than the utterance.",
  "If multiple utterances point in the same direction, integrate them into one meaning cluster. If the relationship between utterances is unclear, use confirmationNeeded rather than inventing a causal or emotional connection.",
  "For every narrative field, sourceUtteranceIds must include only the utterances that directly support the final written text for that field. Do not use theme-level evidence IDs just because they are related to the theme.",
  "Field boundary rule: currentThought is for what the person currently values, hopes for, or wants to maintain. background is only for directly stated reasons, life history, relationships, or meaning behind that currentThought. conditions is only for explicit conditions or limits. uncertainties is only for explicit not-knowing or undecided statements. tensions is only for genuinely different wishes or concerns coexisting in the person; related wishes pointing in the same direction are not tensions. confirmationNeeded is for record-level ambiguity or missing interpretive conditions, not the person's psychological conflict.",
  "Bad currentThought example: 「本人は『できれば家がいい』と話しており、『病院にずっといるのは嫌』と話している。」 This is only a quote list.",
  "Good currentThought example: 「本人は、可能であれば自宅で家族と普段通りに過ごすことを希望している。長期間病院で過ごすことには抵抗を示している。」 with sourceUtteranceIds limited to the utterances that directly support those meanings.",
  "Garden example: utterances about seeing garden flowers, caring for flowers, talking with neighbors, and preferring ordinary days should be integrated as 「本人は、庭の花を見たり世話をしたり、近所の人と会話したりする、これまで通りの日常生活を大切にしている。特別なことよりも、普段通りの暮らしを続けられることを望んでいる。」 Do not list the utterances themselves.",
  "Garden background example: long-term flower growing, long-term neighborhood relationships, and feeling that flower care and neighbor conversations mean ordinary life can continue should be background, not separate currentThought items.",
  "Garden condition example: 「できる間は庭のことは自分でやりたい」 should become a conditions item such as 「本人は、身体的に可能な範囲では、庭の世話を自分で続けたいと考えている。」",
  "Garden tension rule: garden flowers, neighbor conversation, and ordinary daily life all point in the same direction, so tensions must be empty unless a separate conflicting concern is directly stated.",
  "Over-interpretation example to avoid: from 「家がいいかな」「家族と一緒がいい」, do not write 「家族に介護してもらいながら自宅で最期を迎えることを希望している」 because care by family and final place of death were not stated.",
  "currentThought-specific rule: do not copy or list the user's utterances. Write 1 to 3 natural Japanese record sentences that communicate the person's current wishes, values, priorities, things they want to continue, things they want to avoid, or relatively clear views about support/decision-making.",
  "currentThought-specific rule: include only content directly supported by the person's own utterances. Do not treat a clinician question, caregiver interpretation, or general ACP value as the person's value.",
  "currentThought-specific rule: sourceUtteranceIds must contain only the utterance IDs that directly support the generated currentThought sentence. Do not include every utterance in the theme, utterances used for background/conditions/uncertainties/tensions/confirmationNeeded, or question-only utterances.",
  "currentThought-specific rule: if the best output would be the same as an evidence quote, a simple concatenation of quotes, or an unsupported inference, return currentThought as null.",
  "Return JSON only with this shape: {\"narratives\":{\"current_life_values\":{\"currentThought\":{\"text\":\"...\",\"sourceUtteranceIds\":[\"...\"],\"sourceAspectIds\":[\"...\"]},\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]},\"future_life_continuity\":{\"currentThought\":null,\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]},\"selfhood\":{\"currentThought\":null,\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]},\"care_support\":{\"currentThought\":null,\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]},\"family_communication\":{\"currentThought\":null,\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]},\"proxy_decision_support\":{\"currentThought\":null,\"background\":null,\"conditions\":[],\"uncertainties\":[],\"tensions\":[],\"confirmationNeeded\":[]}},\"overall_summary\":{\"core_values\":[{\"text\":\"...\",\"source_aspects\":[\"...\"],\"source_utterance_ids\":[\"...\"]}],\"cross_theme_connections\":[{\"text\":\"...\",\"source_aspects\":[\"...\"],\"related_themes\":[\"...\"],\"source_utterance_ids\":[\"...\"]}],\"undecided_things\":[]}}.",
].join("\n");

const SYSTEM_SLOT_CONTROL_DEBUG = [
  "あなたはACP対話ログを読み、開発確認用にサブスロットの状態を意味判定するAIです。",
  "テーマ名・サブスロット名は変更せず、提供された topic_id と aspect_id だけを使ってください。",
  "語彙の完全一致ではなく、本人発話の意味から該当するサブスロットを判断してください。",
  "ACPの考え方に沿って、本人の価値観・希望・不安・拒否・保留を尊重し、無理に埋めるための判定はしないでください。",
  "本人発話を最優先してください。ただし、介護者が本人の発言を要約・解釈し、その直後または近接する本人発話で「はい」「そう」「それでいい」「うん」など明確に同意している場合は、本人の意思として扱えます。",
  "介護者の要約・解釈への本人同意を根拠にする場合は、evidence_utterance の先頭に必ず「介護者解釈に同意: 」を付け、介護者の要約発話と本人の同意発話の両方を短く含めてください。",
  "本人の同意がない介護者だけの推測・代弁・解釈は answered / partially_answered にしないでください。",
  "ただし、根拠発話がないもの、会話ログに存在しない根拠、推測だけの内容は answered / partially_answered / not_applicable / declined / unable_to_verbalize にしないでください。",
  "非unansweredにする場合は、必ず会話ログ中の本人発話、または介護者要約と本人同意の短い抜粋を evidence_utterance に入れてください。",
  "本人が「特にない」「該当しない」と明確に答えた場合は not_applicable、話したくない場合は declined、言語化できない場合は unable_to_verbalize としてください。",
  "意味的にそのサブスロットの話として認識できるが、理由・条件・具体性が足りない場合は needs_follow_up または partially_answered としてください。",
  "根拠が弱いが関連発話がある場合は partially_answered、ACP上それ以上深掘りすべき曖昧さがある場合は needs_follow_up、十分に具体的な根拠がある場合だけ answered としてください。",
  "出力はJSONのみとしてください。",
  "",
  "出力形式:",
  '{"main_slots":[{"topic_id":"...","sub_slots":[{"id":"...","status":"unanswered | partially_answered | answered | not_applicable | declined | unable_to_verbalize | needs_follow_up | deferred","summary":"...","evidence_utterance":"...","unanswered_reason":"not_discussed | time_limit | topic_changed | declined | unable_to_verbalize | needs_follow_up"}]}]}',
].join("\n");

const SLOT_KEYWORDS: Record<AcpSlotName, string[]> = {
  今の生活で大切にしていること: ["大事", "大切", "好き", "楽しみ", "日課", "趣味", "役割", "地域"],
  これからも続けたいこと: ["続けたい", "これから", "今後", "暮らし", "生活", "自宅", "環境", "失いたくない"],
  自分らしく暮らすために大切なこと: ["自分らし", "決めたい", "尊重", "プライバシー", "生きがい", "役割"],
  手助けが必要になったときの希望: ["介護", "手伝", "支援", "世話", "訪問", "ヘルパー", "助け", "不安"],
  家族に伝えておきたいこと: ["家族", "伝えたい", "言っておきたい", "ありがとう", "お願い", "負担", "迷惑"],
  自分で決められないときに相談してほしい人: ["決めて", "判断", "相談", "任せ", "代理", "信頼", "娘", "息子", "妻", "夫"],
};

const FALLBACK_QUESTIONS: Record<AcpSlotName, string> = {
  今の生活で大切にしていること:
    "今の暮らしの中で、大切にしていることや楽しみにしていることはありますか？",
  これからも続けたいこと:
    "これから先も、できるだけ続けていきたいことはありますか？",
  自分らしく暮らすために大切なこと:
    "これからも自分らしく暮らすために、大切にしたいことは何ですか？",
  手助けが必要になったときの希望:
    "将来、生活の中で手助けが必要になったとしたら、どのような助け方なら受け入れやすいと思いますか？",
  家族に伝えておきたいこと:
    "将来の暮らしや支援について、家族に伝えておきたいことはありますか？",
  自分で決められないときに相談してほしい人:
    "もし自分で医療や介護について決めることが難しくなったとき、誰に相談してほしいと思いますか？",
};

const UNCERTAINTY_REASON_PROMPT =
  "\u4eca\u3059\u3050\u7b54\u3048\u3092\u6c7a\u3081\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u308f\u304b\u3089\u306a\u3044\u611f\u3058\u306f\u3001\u8003\u3048\u305f\u3053\u3068\u304c\u306a\u3044\u304b\u3089\u8fd1\u3044\u3067\u3059\u304b\u3001\u305d\u308c\u3068\u3082\u8a00\u8449\u306b\u3059\u308b\u306e\u304c\u96e3\u3057\u3044\u611f\u3058\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_MOVE_ON_PROMPT =
  "\u7b54\u3048\u3092\u6025\u304c\u306a\u304f\u3066\u5927\u4e08\u592b\u3067\u3059\u3002\u4eca\u306f\u8a00\u8449\u306b\u3057\u306b\u304f\u3044\u3053\u3068\u3068\u3057\u3066\u53d7\u3051\u6b62\u3081\u307e\u3059\u3002\u3044\u3063\u305f\u3093\u5225\u306e\u8a71\u984c\u306b\u79fb\u3063\u3066\u3082\u3088\u308d\u3057\u3044\u3067\u3059\u304b\uff1f";
const UNCERTAINTY_REASON =
  "\u4e0d\u660e\u30fb\u4fdd\u7559\u306e\u7406\u7531\u3092\u78ba\u8a8d\u3059\u308b\u305f\u3081";
const UNCERTAINTY_SWITCH_REASON =
  "\u540c\u3058\u8cea\u554f\u3092\u91cd\u306d\u305a\u3001\u4fdd\u7559\u3068\u3057\u3066\u6271\u3063\u3066\u6b21\u306e\u8a71\u984c\u3078\u79fb\u308b\u305f\u3081";

let client: OpenAI | null = null;

type SlotClassificationResult = {
  classifications?: SlotClassification[];
  unmatchedUtteranceIds?: string[];
  __requestMeta?: JsonRequestMeta;
};

type JsonRequestMeta = {
  source: "openai" | "fallback" | "error";
  llmSucceeded: boolean;
  failureReason?: "missing_api_key" | "api_error" | "parse_error";
  errorMessage?: string;
  rawResponse?: string;
};

type SlotResponseMeaning =
  | "preference_expressed"
  | "explicit_none"
  | "not_considered"
  | "unable_to_verbalize"
  | "declined"
  | "other_response"
  | "unknown";

type SlotEvidenceType =
  | "direct_elder_statement"
  | "elder_confirmation"
  | "caregiver_report_with_elder_confirmation"
  | "caregiver_report_only"
  | "shared_statement"
  | "unknown";

type SlotClassification = {
  mainSlotId?: string;
  subSlotId?: string;
  relevantMentionPresent?: boolean;
  responsePresent?: boolean;
  specificContentPresent?: boolean;
  reasonPresent?: boolean;
  conditionPresent?: boolean;
  examplePresent?: boolean;
  ambiguityPresent?: boolean;
  conflictPresent?: boolean;
  responseMeaning?: string;
  evidenceType?: string;
  evidenceUtteranceIds?: unknown;
  classificationNote?: string;
};

type DerivedSlotClassificationState = {
  completion: SlotCompletion;
  responseState: SlotClassificationResponseState;
  reasonCode: SlotReasonCode | null;
  depth: AnswerDepth;
  needsOptionalFollowUp: boolean;
};

type SlotCandidateValidationResult =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "unknown_main_slot"
        | "unknown_sub_slot"
        | "invalid_sub_slot_parent"
        | "invalid_response_meaning"
        | "invalid_evidence_type"
        | "missing_evidence"
        | "unknown_evidence_utterance"
        | "non_elder_evidence"
        | "invalid_transition";
    };

type SlotStateBundle = {
  slotStates: AcpSlotState[];
  subSlotStates: StoredSubSlotState[];
  debug: {
    candidates: SlotClassification[];
    accepted: SlotClassification[];
    rejected: Array<{
      candidate: SlotClassification;
      reason: Exclude<SlotCandidateValidationResult, { accepted: true }>["reason"];
      utteranceIds: string[];
    }>;
    unmatchedUtteranceIds: string[];
    summary: {
      source: "openai" | "fallback" | "error";
      llmSucceeded: boolean;
      candidateCount: number;
      llmCandidateCount: number;
      acceptedCount: number;
      rejectedCount: number;
      rejectionReasons: Record<string, number>;
      unmatchedUtteranceCount: number;
      derivedStateCount: number;
      transitionBlockedCount: number;
    };
  };
};

export async function updateSlotStateBundleFromConversation(
  context: ConversationContext,
): Promise<SlotStateBundle> {
  const fallbackSubSlotStates = context.subSlotStates?.length
    ? context.subSlotStates
    : createEmptySubSlotStates();
  const fallbackSlotStates = deriveMainSlotStatesFromSubSlots(
    context.slotStates,
    fallbackSubSlotStates,
    context.utterances,
  );
  const utterancesWithIds = context.utterances.filter((utterance) => utterance.id);

  if (utterancesWithIds.length === 0) {
    return {
      slotStates: fallbackSlotStates,
      subSlotStates: fallbackSubSlotStates,
      debug: {
        candidates: [],
        accepted: [],
        rejected: [],
        unmatchedUtteranceIds: [],
        summary: createSlotClassificationDebugSummary([], [], [], {
          source: "fallback",
          llmSucceeded: false,
          unmatchedUtteranceCount: 0,
        }),
      },
    };
  }

  const result = await requestJson<SlotClassificationResult>(
    SYSTEM_CLASSIFY_SLOT_UTTERANCES,
    buildSlotClassificationPayload(context, fallbackSubSlotStates),
    { classifications: [], unmatchedUtteranceIds: [] },
  );
  const applied = applySlotClassifications({
    result,
    utterances: context.utterances,
    currentStates: fallbackSubSlotStates,
    currentTopic: context.currentTopic,
    sessionId: context.sessionId,
  });
  const slotStates = deriveMainSlotStatesFromSubSlots(
    context.slotStates,
    applied.subSlotStates,
    context.utterances,
  );

  return {
    slotStates,
    subSlotStates: applied.subSlotStates,
    debug: applied.debug,
  };
}

function buildSlotClassificationPayload(
  context: ConversationContext,
  _subSlotStates: StoredSubSlotState[],
) {
  const currentTopic = resolveDiscussionTopic(context.currentTopic);
  const topicsForClassification = DISCUSSION_TOPICS;

  return {
    session: getSessionMetadata(context),
    currentTopic,
    slotDefinitions: topicsForClassification.map((topic) => ({
      mainSlotId: topic.id,
      mainSlotLabel: topic.title,
      subSlots: getSubSlotDefinitions()
        .filter((definition) => definition.mainSlotId === topic.id)
        .map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          completeCriteria: definition.completeCriteria,
          partialCriteria: definition.partialCriteria,
          exclusionCriteria: definition.exclusionCriteria,
          completionRule: definition.completionRule,
        })),
    })),
    conversation_log: context.utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => ({
        id: utterance.id,
        speaker: isCaregiverSpeaker(utterance.speaker) ? "caregiver" : "elder",
        text: utterance.text,
        created_at: utterance.created_at ?? utterance.createdAt ?? null,
      })),
    maxClassificationsPerUtterance: 8,
  };
}

function applySlotClassifications(input: {
  result: SlotClassificationResult;
  utterances: ConversationUtterance[];
  currentStates: StoredSubSlotState[];
  currentTopic?: string;
  sessionId?: string;
}) {
  const utteranceIds = new Set(
    input.utterances.map((utterance) => utterance.id).filter(Boolean) as string[],
  );
  const byKey = new Map(
    input.currentStates.map((state) => [
      `${state.mainSlotId}:${state.subSlotId}`,
      state,
    ]),
  );
  const accepted: SlotClassification[] = [];
  const rejected: SlotStateBundle["debug"]["rejected"] = [];
  const perEvidenceCount = new Map<string, number>();
  const now = new Date().toISOString();
  const currentTopicId = resolveDiscussionTopic(input.currentTopic).id;

  for (const candidate of input.result.classifications ?? []) {
    const evidenceIds = normalizeEvidenceIds(candidate.evidenceUtteranceIds);
    const validation = validateSlotClassificationCandidate(
      candidate,
      evidenceIds,
      utteranceIds,
      input.utterances,
    );

    if (validation.accepted === false) {
      rejected.push({
        candidate,
        reason: validation.reason,
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, validation.reason, evidenceIds, input.sessionId);
      continue;
    }

    const primaryEvidenceId = evidenceIds[0];
    const currentCount = perEvidenceCount.get(primaryEvidenceId) ?? 0;
    if (currentCount >= 8) {
      rejected.push({
        candidate,
        reason: "missing_evidence",
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, "missing_evidence", evidenceIds, input.sessionId);
      continue;
    }
    perEvidenceCount.set(primaryEvidenceId, currentCount + 1);

    const mainSlotId = candidate.mainSlotId as string;
    const subSlotId = candidate.subSlotId as string;
    const key = `${mainSlotId}:${subSlotId}`;
    const current = byKey.get(key);
    const definition = resolveSubSlotDefinition(mainSlotId, subSlotId);
    if (!definition) {
      rejected.push({
        candidate,
        reason: "invalid_sub_slot_parent",
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, "invalid_sub_slot_parent", evidenceIds, input.sessionId);
      continue;
    }
    const derived = deriveStoredSlotState(candidate, definition.completionRule);
    const nextBase = {
      mainSlotId,
      subSlotId,
      completion: derived.completion,
      responseState: derived.responseState,
      reasonCode: derived.reasonCode,
      evidenceUtteranceIds: mergeEvidenceIds(
        current?.evidenceUtteranceIds ?? [],
        evidenceIds,
      ),
      depth: derived.depth,
      needsOptionalFollowUp: derived.needsOptionalFollowUp,
      hasConflict: derived.responseState === "conflicting",
      lastUpdatedTopicId: currentTopicId,
      updatedAt: now,
    };
    const nextState: StoredSubSlotState = {
      ...nextBase,
      canAskAgain: canAskAgainSubSlotState(nextBase),
      isDeferred: isDeferredSubSlotState(nextBase),
    };

    if (!canTransitionSubSlotState(current, nextState)) {
      rejected.push({
        candidate,
        reason: "invalid_transition",
        utteranceIds: evidenceIds,
      });
      logRejectedSlotCandidate(candidate, "invalid_transition", evidenceIds, input.sessionId);
      continue;
    }

    byKey.set(key, mergeSubSlotState(current, nextState));
    accepted.push(candidate);
  }

  return {
    subSlotStates: [...byKey.values()],
    debug: {
      candidates: input.result.classifications ?? [],
      accepted,
      rejected,
      unmatchedUtteranceIds: normalizeEvidenceIds(input.result.unmatchedUtteranceIds),
      summary: createSlotClassificationDebugSummary(
        input.result.classifications ?? [],
        accepted,
        rejected,
        {
          source: input.result.__requestMeta?.source ?? "fallback",
          llmSucceeded: input.result.__requestMeta?.llmSucceeded === true,
          unmatchedUtteranceCount: normalizeEvidenceIds(input.result.unmatchedUtteranceIds).length,
        },
      ),
    },
  };
}

function createSlotClassificationDebugSummary(
  candidates: SlotClassification[],
  accepted: SlotClassification[],
  rejected: SlotStateBundle["debug"]["rejected"],
  meta: {
    source?: "openai" | "fallback" | "error";
    llmSucceeded?: boolean;
    unmatchedUtteranceCount?: number;
  } = {},
) {
  const rejectionReasons = rejected.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.reason] = (accumulator[item.reason] ?? 0) + 1;
    return accumulator;
  }, {});

  return {
    source: meta.source ?? "fallback",
    llmSucceeded: meta.llmSucceeded === true,
    candidateCount: candidates.length,
    llmCandidateCount: candidates.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    rejectionReasons,
    unmatchedUtteranceCount: meta.unmatchedUtteranceCount ?? 0,
    derivedStateCount: accepted.length,
    transitionBlockedCount: rejectionReasons.invalid_transition ?? 0,
  };
}

function validateSlotClassificationCandidate(
  candidate: SlotClassification,
  evidenceIds: string[],
  utteranceIds: Set<string>,
  utterances: ConversationUtterance[],
): SlotCandidateValidationResult {
  const mainSlotId = typeof candidate.mainSlotId === "string" ? candidate.mainSlotId : "";
  const subSlotId = typeof candidate.subSlotId === "string" ? candidate.subSlotId : "";
  const knownMainSlot = DISCUSSION_TOPICS.some((topic) => topic.id === mainSlotId);

  if (!knownMainSlot) return { accepted: false, reason: "unknown_main_slot" };
  if (!subSlotId) return { accepted: false, reason: "unknown_sub_slot" };

  const anySubSlot = getSubSlotDefinitions().some(
    (definition) => definition.id === subSlotId,
  );
  if (!anySubSlot) return { accepted: false, reason: "unknown_sub_slot" };
  if (!resolveSubSlotDefinition(mainSlotId, subSlotId)) {
    return { accepted: false, reason: "invalid_sub_slot_parent" };
  }
  if (!isSlotResponseMeaning(candidate.responseMeaning)) {
    return { accepted: false, reason: "invalid_response_meaning" };
  }
  if (!isSlotEvidenceType(candidate.evidenceType)) {
    return { accepted: false, reason: "invalid_evidence_type" };
  }
  if (
    (candidate.relevantMentionPresent ||
      candidate.responsePresent ||
      candidate.responseMeaning !== "unknown") &&
    evidenceIds.length === 0
  ) {
    return { accepted: false, reason: "missing_evidence" };
  }
  if (evidenceIds.some((id) => !utteranceIds.has(id))) {
    return { accepted: false, reason: "unknown_evidence_utterance" };
  }
  if (candidate.evidenceType === "caregiver_report_only") {
    return { accepted: false, reason: "non_elder_evidence" };
  }
  if (!evidenceIdsHaveValidSpeakerConsent(evidenceIds, utterances)) {
    return { accepted: false, reason: "non_elder_evidence" };
  }

  return { accepted: true };
}

function deriveStoredSlotState(
  classification: SlotClassification,
  rule: SubSlotCompletionRule,
): DerivedSlotClassificationState {
  const responseMeaning = normalizeResponseMeaning(classification.responseMeaning);
  const responsePresent = classification.responsePresent === true;
  const depth = deriveAnswerDepth(classification);

  if (!classification.relevantMentionPresent) {
    return buildDerivedSlotState("none", "no_response", "not_discussed", depth);
  }

  if (responseMeaning === "declined") {
    return buildDerivedSlotState("none", "declined", "declined", depth);
  }

  if (responseMeaning === "unable_to_verbalize") {
    return buildDerivedSlotState(
      "none",
      "unable_to_verbalize",
      "unable_to_verbalize",
      depth,
    );
  }

  if (responseMeaning === "not_considered") {
    return buildDerivedSlotState("none", "not_considered", "not_considered", depth);
  }

  if (responseMeaning === "explicit_none") {
    return buildDerivedSlotState("none", "explicit_none", "explicit_none", depth);
  }

  if (classification.conflictPresent) {
    return buildDerivedSlotState("partial", "conflicting", "conflicting", depth);
  }

  if (classification.ambiguityPresent) {
    return buildDerivedSlotState("partial", "ambiguous", "ambiguous", depth);
  }

  if (!responsePresent) {
    return buildDerivedSlotState("none", "no_response", "not_discussed", depth);
  }

  const completed = classification.specificContentPresent === true;

  if (completed) {
    return buildDerivedSlotState("complete", "answered", null, depth);
  }

  return buildDerivedSlotState(
    "partial",
    "answered",
    "insufficient_detail",
    depth,
  );
}

function buildDerivedSlotState(
  completion: SlotCompletion,
  responseState: SlotClassificationResponseState,
  reasonCode: SlotReasonCode | null,
  depth: AnswerDepth,
): DerivedSlotClassificationState {
  return {
    completion,
    responseState,
    reasonCode,
    depth,
    needsOptionalFollowUp:
      completion === "complete" &&
      depth === "minimal" &&
      ![
        "explicit_none",
        "not_considered",
        "unable_to_verbalize",
        "declined",
      ].includes(responseState),
  };
}

function deriveAnswerDepth(classification: SlotClassification): AnswerDepth {
  if (!classification.responsePresent) return "none";
  if (
    classification.reasonPresent ||
    classification.conditionPresent ||
    classification.examplePresent
  ) {
    return "elaborated";
  }
  return "minimal";
}

function isSlotResponseMeaning(value: unknown): value is SlotResponseMeaning {
  return (
    value === "preference_expressed" ||
    value === "explicit_none" ||
    value === "not_considered" ||
    value === "unable_to_verbalize" ||
    value === "declined" ||
    value === "other_response" ||
    value === "unknown"
  );
}

function normalizeResponseMeaning(value: unknown): SlotResponseMeaning {
  return isSlotResponseMeaning(value) ? value : "unknown";
}

function isSlotEvidenceType(value: unknown): value is SlotEvidenceType {
  return (
    value === "direct_elder_statement" ||
    value === "elder_confirmation" ||
    value === "caregiver_report_with_elder_confirmation" ||
    value === "caregiver_report_only" ||
    value === "shared_statement" ||
    value === "unknown"
  );
}

function evidenceIdsHaveValidSpeakerConsent(
  evidenceIds: string[],
  utterances: ConversationUtterance[],
) {
  if (evidenceIds.length === 0) return true;

  const evidenceIdSet = new Set(evidenceIds);
  const indexedEvidence = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => utterance.id && evidenceIdSet.has(utterance.id));

  if (indexedEvidence.every(({ utterance }) => isElderSpeaker(utterance.speaker))) {
    return true;
  }

  return indexedEvidence.every(({ utterance, index }) => {
    if (isElderSpeaker(utterance.speaker)) return true;
    if (!isCaregiverSpeaker(utterance.speaker)) return false;

    return indexedEvidence.some(({ utterance: candidate, index: candidateIndex }) => {
      if (!isElderSpeaker(candidate.speaker)) return false;
      if (candidateIndex <= index || candidateIndex - index > 4) return false;

      return isAgreementUtterance(candidate.text) || hasSubstantiveElderEvidence(candidate.text);
    });
  });
}

function mergeSubSlotState(
  current: StoredSubSlotState | undefined,
  next: StoredSubSlotState,
): StoredSubSlotState {
  if (!current) return next;
  if (current.completion === "complete" && next.completion !== "complete") {
    return {
      ...current,
      evidenceUtteranceIds: mergeEvidenceIds(
        current.evidenceUtteranceIds,
        next.evidenceUtteranceIds,
      ),
      hasConflict:
        current.hasConflict === true || next.responseState === "conflicting",
      needsOptionalFollowUp:
        current.needsOptionalFollowUp === true ||
        next.responseState === "conflicting",
      updatedAt: next.updatedAt,
    };
  }

  return {
    ...next,
    evidenceUtteranceIds: mergeEvidenceIds(
      current.evidenceUtteranceIds,
      next.evidenceUtteranceIds,
    ),
  };
}

function deriveMainSlotStatesFromSubSlots(
  currentSlots: AcpSlotState[],
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
): AcpSlotState[] {
  const utteranceById = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );
  const currentByName = new Map(currentSlots.map((slot) => [slot.slot_name, slot]));

  return DISCUSSION_TOPICS.map((topic) => {
    const topicStates = subSlotStates.filter((state) => state.mainSlotId === topic.id);
    const strongest = getMainSlotStatusFromSubSlots(topicStates);
    const evidenceIds = mergeEvidenceIds(
      [],
      topicStates.flatMap((state) => state.evidenceUtteranceIds),
    );
    const evidenceText = evidenceIds
      .map((id) => utteranceById.get(id))
      .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
      .map((utterance) => formatSpeakerEvidence(utterance))
      .join("\n");
    const hasCaregiverEvidence = evidenceIds.some((id) => {
      const utterance = utteranceById.get(id);
      return utterance ? isCaregiverSpeaker(utterance.speaker) : false;
    });
    const evidenceWithContext =
      hasCaregiverEvidence && evidenceText
        ? `${CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX}${evidenceText}`
        : evidenceText;
    const summary =
      evidenceWithContext || currentByName.get(topic.slot_name)?.summary || "Unconfirmed";

    return {
      slot_name: topic.slot_name,
      status: strongest,
      summary,
      evidence_utterance: evidenceWithContext,
      updated_at:
        topicStates
          .map((state) => state.updatedAt)
          .sort()
          .at(-1) ?? currentByName.get(topic.slot_name)?.updated_at,
    };
  });
}

function getMainSlotStatusFromSubSlots(
  states: StoredSubSlotState[],
): AcpSlotState["status"] {
  if (states.some((state) => state.responseState === "declined")) {
    return "prefer_not_to_answer";
  }
  if (states.some((state) => state.responseState === "explicit_none")) {
    return "no_preference";
  }
  if (states.some((state) => state.responseState === "unable_to_verbalize")) {
    return "cannot_verbalize";
  }
  if (states.some((state) => state.responseState === "not_considered")) {
    return "not_considered";
  }
  if (states.some((state) => state.completion === "complete")) {
    return "answered";
  }
  if (
    states.some(
      (state) =>
        state.completion === "partial" ||
        state.responseState === "ambiguous" ||
        state.responseState === "conflicting",
    )
  ) {
    return "partial";
  }

  return "unanswered";
}

function normalizeEvidenceIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

function mergeEvidenceIds(left: string[], right: string[]) {
  return [...new Set([...left, ...right].map((item) => item.trim()).filter(Boolean))];
}

function logRejectedSlotCandidate(
  candidate: SlotClassification,
  reason: Exclude<SlotCandidateValidationResult, { accepted: true }>["reason"],
  utteranceIds: string[],
  sessionId?: string,
) {
  console.warn("Rejected slot classification", {
    candidate,
    reason,
    utteranceIds,
    sessionId,
    occurredAt: new Date().toISOString(),
  });
}

export async function generateNextQuestion(
  context: ConversationContext,
): Promise<NextQuestionResult> {
  const fallback = fallbackNextQuestion(
    context.utterances,
    context.slotStates,
    context.currentTopic,
    context.subSlotStates,
  );
  const result = await requestJson<Partial<NextQuestionResult>>(
    SYSTEM_NEXT_QUESTION,
    await buildQuestionPayload(context),
    fallback,
  );

  const output = normalizeNextQuestionResult(result, fallback, context);

  return isLegacyDialogueMode()
    ? output
    : applyUncertaintyNextQuestionPolicy(context, output);
}

export async function generateTopicSwitch(
  context: ConversationContext,
): Promise<TopicSwitchResult> {
  return fallbackTopicSwitch(context);
}

export async function checkConversationEnd(
  context: ConversationContext,
): Promise<EndCheckResult> {
  const fallback = fallbackEndCheck(context.slotStates);
  const result = await requestJson<Partial<EndCheckResult>>(
    SYSTEM_END_CHECK,
    buildConversationPayload(context),
    fallback,
  );

  const output = {
    can_end: typeof result.can_end === "boolean" ? result.can_end : fallback.can_end,
    message: nonEmpty(result.message, fallback.message),
    reason: nonEmpty(result.reason, fallback.reason),
    remaining_slots: normalizeRemainingSlots(result.remaining_slots, fallback.remaining_slots),
  };

  return output;
}

export async function generateFinalMinutes(
  context: ConversationContext,
): Promise<FinalMinutesResult> {
  const fallback = buildFallbackMinutes(
    context.utterances,
    context.slotStates,
    getSessionMetadata(context),
    context.subSlotStates ?? [],
  );
  const baseMinutes =
    fallback.json.acp_minutes ??
    buildACPMinutesFromStructuredInput(fallback.json.acp_minutes_llm_input ?? {
      title: "これからの暮らしと大切にしたいこと",
      recordType: "acp_discussion_record_input",
      themes: [],
    });
  const result = await requestJson<{
    overall_summary?: unknown;
    narratives?: unknown;
    __requestMeta?: JsonRequestMeta;
  }>(
    SYSTEM_FINAL_MINUTES_FROM_STRUCTURED,
    buildStructuredMinutesPayload(fallback),
    {},
    { type: "json_object" },
    {
      timeoutMs: Number(process.env.FINAL_MINUTES_OPENAI_TIMEOUT_MS || 90000),
    },
  );
  const requestMeta = result.__requestMeta ?? {
    source: "fallback",
    llmSucceeded: false,
  };
  const llmReturnedNarratives = hasNarrativeObject(result.narratives);
  const validatedMinutes =
    requestMeta.source === "openai" && llmReturnedNarratives
      ? validateACPMinutes({
          ...baseMinutes,
          overall_summary: result.overall_summary,
          narratives: result.narratives,
        }, fallback.json.acp_minutes_llm_input) ?? baseMinutes
      : baseMinutes;
  const narrativeStatus = getNarrativeGenerationStatus(requestMeta, llmReturnedNarratives);
  const markdown = renderACPMinutesMarkdown(
    validatedMinutes,
    fallback.json.generated_at,
  );

  return ensureFinalMinutesIncludeTopic(
    {
      markdown,
      json: {
        ...fallback.json,
        acp_minutes: validatedMinutes,
        acp_minutes_llm_meta: {
          ...requestMeta,
          narrativeGenerationStatus: narrativeStatus,
          fallbackUsed: validatedMinutes === baseMinutes,
        },
        acp_minutes_narrative_debug: buildFinalMinutesNarrativeDebug({
          input: fallback.json.acp_minutes_llm_input,
          rawResponse: result,
          normalizedMinutes: validatedMinutes,
          requestMeta,
          narrativeStatus,
          fallbackUsed: validatedMinutes === baseMinutes,
        }),
      },
    },
    context,
  );
}

type NarrativeGenerationStatus =
  | "success"
  | "no_supported_content"
  | "api_error"
  | "parse_error"
  | "fallback";

function getNarrativeGenerationStatus(
  meta: JsonRequestMeta,
  llmReturnedNarratives: boolean,
): NarrativeGenerationStatus {
  if (meta.source === "openai" && llmReturnedNarratives) return "success";
  if (meta.failureReason === "parse_error") return "parse_error";
  if (meta.failureReason === "api_error" || meta.failureReason === "missing_api_key") {
    return "api_error";
  }
  if (meta.source === "openai" && !llmReturnedNarratives) return "no_supported_content";
  return "fallback";
}

function buildFinalMinutesNarrativeDebug(input: {
  input?: FinalMinutesResult["json"]["acp_minutes_llm_input"];
  rawResponse: { overall_summary?: unknown; narratives?: unknown; __requestMeta?: JsonRequestMeta };
  normalizedMinutes?: ACPMinutes;
  requestMeta: JsonRequestMeta;
  narrativeStatus: NarrativeGenerationStatus;
  fallbackUsed: boolean;
}) {
  const themes = input.input?.themes ?? [];
  const rawResponseText = input.requestMeta.rawResponse;
  const parsedRawResponse = rawResponseText ? parseJson(rawResponseText) : null;
  return {
    status: input.narrativeStatus,
    llmAttempted: input.requestMeta.failureReason !== "missing_api_key",
    llmSucceeded: input.requestMeta.source === "openai",
    rawResponseAvailable: Boolean(input.requestMeta.rawResponse),
    parseSucceeded: input.requestMeta.source === "openai",
    schemaSucceeded: hasNarrativeObject(input.rawResponse.narratives),
    fallbackUsed: input.fallbackUsed,
    failureReason: input.requestMeta.failureReason,
    errorMessage: input.requestMeta.errorMessage,
    rawResponse: input.requestMeta.rawResponse,
    parsedResponse: parsedRawResponse,
    normalizedNarratives: input.normalizedMinutes?.narratives ?? null,
    themes: themes.map((theme) => ({
      themeId: theme.theme_id,
      inputEvidenceCount: theme.aspects.reduce((count, aspect) => count + aspect.evidence.length, 0),
      inputEvidenceIds: uniqueStringsForDebug(
        theme.aspects.flatMap((aspect) =>
          aspect.evidence.map((evidence) => evidence.sourceUtteranceId ?? ""),
        ),
      ),
      generatedCurrentThought: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "currentThought"),
      generatedBackground: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "background"),
      generatedConditions: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "conditions"),
      generatedUncertainties: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "uncertainties"),
      generatedTensions: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "tensions"),
      generatedConfirmationNeeded: hasGeneratedSection(input.rawResponse.narratives, theme.theme_id, "confirmationNeeded"),
    })),
  };
}

function hasGeneratedSection(
  narratives: unknown,
  themeId: string,
  section: string,
) {
  if (!narratives || typeof narratives !== "object" || Array.isArray(narratives)) return false;
  const theme = (narratives as Record<string, unknown>)[themeId];
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return false;
  return hasNarrativeText((theme as Record<string, unknown>)[section]);
}

function uniqueStringsForDebug(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasNarrativeObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some((theme) => {
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) return false;
    return Object.values(theme as Record<string, unknown>).some((section) => hasNarrativeText(section));
  });
}

function hasNarrativeText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasNarrativeText(item));
  if (!value || typeof value !== "object") return false;
  const text = (value as Record<string, unknown>).text;
  return typeof text === "string" && text.trim().length > 0;
}

function buildStructuredMinutesPayload(minutes: FinalMinutesResult) {
  return {
    generated_at: minutes.json.generated_at,
    acp_minutes_input: minutes.json.acp_minutes_llm_input,
    writing_process: [
      "各evidenceを逐語引用ではなく、発言から直接確認できる意味単位に変換する。",
      "同じ方向性の意味単位を統合し、医療・介護従事者が読める自然な記録文にする。",
      "原発言にない意思、感情、価値観、理由、因果関係は追加しない。",
      "各sectionのsourceUtteranceIdsは、そのsectionの本文を直接支える発言IDだけに限定する。",
      "sourceUtteranceIdsに含めた全発言を本文へ反映しようとせず、本文と根拠発言の役割を分離する。",
    ],
    section_guide: {
      currentThought:
        "本人の現在の希望、価値観、大切にしていること、続けたいこと、避けたいこと、望んでいる生活。単なる行動の羅列ではなく、複数の具体的行動の背後に共通する意味が確認できる場合は統合する。発言のコピーや列挙ではなく、医療従事者が共有しやすい1〜3文の記録文にする。sourceUtteranceIdsはその文章を直接裏づける最小十分な本人発言だけに限定する。",
      background:
        "currentThoughtがなぜ本人にとって大切なのかについて、本人発言から直接確認できる背景、生活歴、理由、意味づけ。単なる別の希望をbackgroundへ入れない。",
      conditions:
        "本人の希望に明示的な条件や制約がある場合だけ。できる範囲、身体が動くうちは、家族が大丈夫なら、必要になれば、今は以前ほどできない等。",
      uncertainties:
        "本人が直接、まだ考えていない、まだ決めていない、分からない、その時にならないと分からない、と話した内容。",
      tensions:
        "本人自身の複数の発言から、異なる方向性を持つ希望・価値・懸念が同時に存在すると確認できる場合だけ。庭の花、近所との交流、普段通りの生活のように同じ方向の内容はtensionsではない。",
      confirmationNeeded:
        "記録上の不整合、slotと発言の不一致、相談相手と代理意思決定者の混在、今回の記録だけでは確定できない事項。",
    },
    theme_evidence: buildMinutesEvidenceGuide(minutes.json.acp_minutes_llm_input),
  };
}

function buildMinutesEvidenceGuide(input: FinalMinutesResult["json"]["acp_minutes_llm_input"]) {
  return (input?.themes ?? []).map((theme) => ({
    themeId: theme.theme_id,
    title: theme.title,
    evidence: uniqueStringsForDebug(
      theme.aspects.flatMap((aspect) =>
        aspect.evidence.map((evidence) => evidence.sourceUtteranceId ?? ""),
      ),
    ),
    aspects: theme.aspects.map((aspect) => ({
      aspectId: aspect.aspect_id,
      label: aspect.label,
      priority: aspect.priority,
      status: aspect.status,
      evidence: aspect.evidence.map((evidence) => ({
        sourceUtteranceId: evidence.sourceUtteranceId,
        speaker: evidence.speaker,
        certainty: evidence.certainty,
        condition: evidence.condition,
        value: evidence.value,
        text: evidence.evidence,
      })),
    })),
  }));
}

function summarizeStructuredThemes(themes: ThemeMinutesItem[] = []) {
  return themes.map((theme) => ({
    title: theme.title,
    level: theme.level,
    summary: theme.summary,
    aspects: theme.aspects.map((aspect) => ({
      label: aspect.label,
      priority: aspect.priority,
      status: aspect.status,
      evidence: aspect.evidence.map((evidence) => ({
        speaker: evidence.speaker,
        text: evidence.evidenceText,
        source_topic_id: evidence.sourceTopicId,
      })),
    })),
  }));
}

type SemanticSlotControlResult = {
  main_slots?: Array<{
    topic_id?: string;
    sub_slots?: Array<{
      id?: string;
      status?: string;
      summary?: string;
      evidence_utterance?: string;
      unanswered_reason?: string;
    }>;
  }>;
};

export async function buildSemanticSlotControlDebugState(input: {
  utterances: ConversationUtterance[];
  slots: AcpSlotState[];
  currentTopic?: string;
  includeBeforeSessionEnd?: boolean;
}): Promise<SlotControlDebugState> {
  const fallback = buildSlotControlDebugState({
    slots: input.slots,
    currentTopic: input.currentTopic,
    includeBeforeSessionEnd: input.includeBeforeSessionEnd,
  });

  if (input.utterances.length === 0) return fallback;

  const result = await requestJson<SemanticSlotControlResult>(
    SYSTEM_SLOT_CONTROL_DEBUG,
    {
      current_topic: input.currentTopic,
      topics: DISCUSSION_TOPICS.map((topic) => ({
        topic_id: topic.id,
        main_slot: topic.slot_name,
        title: topic.title,
        sub_slots: topic.aspects.map((aspect) => ({
          id: aspect.id,
          label: aspect.label,
          priority: aspect.priority,
        })),
      })),
      slot_states: input.slots,
      conversation_log: renderTranscript(input.utterances),
    },
    { main_slots: [] },
  );
  const overrides = normalizeSemanticSlotOverrides(
    result,
    input.utterances,
  );

  return buildSlotControlDebugState({
    slots: input.slots,
    currentTopic: input.currentTopic,
    includeBeforeSessionEnd: input.includeBeforeSessionEnd,
    subSlotOverrides: overrides,
  });
}

function normalizeSemanticSlotOverrides(
  result: SemanticSlotControlResult,
  utterances: ConversationUtterance[],
): SubSlotControlOverride[] {
  const validTopicIds = new Set<string>(DISCUSSION_TOPICS.map((topic) => topic.id));
  const aspectIdsByTopic = new Map<string, Set<string>>(
    DISCUSSION_TOPICS.map((topic) => [
      topic.id,
      new Set(topic.aspects.map((aspect) => aspect.id)),
    ]),
  );
  const overrides: SubSlotControlOverride[] = [];

  for (const mainSlot of result.main_slots ?? []) {
    const topicId = typeof mainSlot.topic_id === "string" ? mainSlot.topic_id : "";
    if (!validTopicIds.has(topicId)) continue;

    const validAspectIds = aspectIdsByTopic.get(topicId);
    if (!validAspectIds) continue;

    for (const subSlot of mainSlot.sub_slots ?? []) {
      const subSlotId = typeof subSlot.id === "string" ? subSlot.id : "";
      if (!validAspectIds.has(subSlotId)) continue;

      const status = normalizeScopedSlotStatus(subSlot.status);
      const evidence = normalizeEvidenceText(subSlot.evidence_utterance);
      const requiresEvidence = status !== "unanswered" && status !== "deferred";

      if (requiresEvidence && !evidenceMatchesTranscript(evidence, utterances)) {
        continue;
      }

      overrides.push({
        topicId,
        subSlotId,
        status,
        value: evidence || nonEmpty(subSlot.summary, ""),
        unansweredReason: normalizeUnansweredReason(subSlot.unanswered_reason, status),
        lastUpdatedTopicId: topicId,
      });
    }
  }

  return overrides;
}

function normalizeScopedSlotStatus(value: unknown): ScopedSlotStatus {
  switch (value) {
    case "answered":
    case "partially_answered":
    case "not_applicable":
    case "declined":
    case "unable_to_verbalize":
    case "needs_follow_up":
    case "deferred":
      return value;
    default:
      return "unanswered";
  }
}

function normalizeUnansweredReason(
  value: unknown,
  status: ScopedSlotStatus,
): UnansweredReason | undefined {
  switch (value) {
    case "not_discussed":
    case "time_limit":
    case "topic_changed":
    case "declined":
    case "unable_to_verbalize":
    case "needs_follow_up":
      return value;
    default:
      if (status === "declined") return "declined";
      if (status === "unable_to_verbalize") return "unable_to_verbalize";
      if (status === "partially_answered" || status === "needs_follow_up") {
        return "needs_follow_up";
      }
      if (status === "unanswered") return "not_discussed";
      return undefined;
  }
}

function normalizeEvidenceText(value: unknown) {
  if (typeof value !== "string") return "";

  const text = value.trim();

  if (text.startsWith(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX)) {
    return text;
  }

  return text.replace(/^(本人|高齢者役|elder|介護者|caregiver)\s*[:：]\s*/i, "").trim();
}

function evidenceMatchesTranscript(
  evidence: string,
  utterances: ConversationUtterance[],
) {
  if (evidence.startsWith(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX)) {
    return caregiverAgreementEvidenceMatchesTranscript(evidence, utterances);
  }

  const normalizedEvidence = normalizeForEvidenceMatch(evidence);
  if (normalizedEvidence.length < 4) return false;

  return utterances.some((utterance) => {
    if (!isElderSpeaker(utterance.speaker)) return false;

    const normalizedUtterance = normalizeForEvidenceMatch(utterance.text);
    if (!normalizedUtterance) return false;

    return (
      normalizedUtterance.includes(normalizedEvidence) ||
      normalizedEvidence.includes(normalizedUtterance)
    );
  });
}

function caregiverAgreementEvidenceMatchesTranscript(
  evidence: string,
  utterances: ConversationUtterance[],
) {
  const evidenceBody = evidence
    .slice(CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX.length)
    .trim();
  const evidencePieces = extractEvidencePieces(evidenceBody);
  const caregiverIndexes = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => isCaregiverSpeaker(utterance.speaker));
  const elderIndexes = utterances
    .map((utterance, index) => ({ utterance, index }))
    .filter(({ utterance }) => isElderSpeaker(utterance.speaker));

  const caregiverMatch = caregiverIndexes.find(({ utterance }) =>
    evidencePieces.some((piece) => evidencePieceMatchesUtterance(piece, utterance.text)),
  );
  const elderMatch = elderIndexes.find(({ utterance, index }) => {
    if (!caregiverMatch || index <= caregiverMatch.index || index - caregiverMatch.index > 4) {
      return false;
    }

    return (
      evidencePieces.some((piece) => evidencePieceMatchesUtterance(piece, utterance.text)) ||
      isAgreementUtterance(utterance.text)
    );
  });

  return Boolean(caregiverMatch && elderMatch);
}

function extractEvidencePieces(value: string) {
  return value
    .split(/(?:本人|高齢者役|elder|介護者|caregiver)\s*[:：]|[／/|｜\n]/i)
    .map((piece) => piece.trim())
    .filter((piece) => normalizeForEvidenceMatch(piece).length >= 2);
}

function evidencePieceMatchesUtterance(piece: string, utteranceText: string) {
  const normalizedPiece = normalizeForEvidenceMatch(piece);
  const normalizedUtterance = normalizeForEvidenceMatch(utteranceText);

  if (normalizedPiece.length < 2 || normalizedUtterance.length < 2) return false;

  return (
    normalizedUtterance.includes(normalizedPiece) ||
    normalizedPiece.includes(normalizedUtterance)
  );
}

function isAgreementUtterance(text: string) {
  const normalized = normalizeForEvidenceMatch(text);

  return /^(?:\u306f\u3044|\u3046\u3093|\u305d\u3046|\u305d\u3046\u3067\u3059|\u305d\u308c\u3067\u3044\u3044|\u305d\u308c\u3067\u5927\u4e08\u592b|\u305d\u306e\u901a\u308a|\u5408\u3063\u3066\u3044\u307e\u3059|\u5408\u3063\u3066\u307e\u3059|\u9593\u9055\u3044\u306a\u3044|\u3044\u3044\u3067\u3059|\u5927\u4e08\u592b\u3067\u3059)$/.test(normalized);
}

function hasSubstantiveElderEvidence(text: string) {
  return normalizeForEvidenceMatch(text).length >= 6;
}

function normalizeForEvidenceMatch(value: string) {
  return value
    .replace(/[「」『』"'\s、。,.，．]/g, "")
    .toLowerCase();
}

async function requestJson<T>(
  systemPrompt: string,
  payload: unknown,
  fallback: T,
  responseFormat: unknown = { type: "json_object" },
  options: { throwOnFailure?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    if (options.throwOnFailure) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    return attachJsonRequestMeta(fallback, {
      source: "fallback",
      llmSucceeded: false,
      failureReason: "missing_api_key",
      errorMessage: "OPENAI_API_KEY is not configured",
    });
  }

  try {
    const openai = options.timeoutMs
      ? new OpenAI({ apiKey, timeout: options.timeoutMs })
      : getClient(apiKey);
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel(),
      messages: [
        { role: "system", content: `${COMMON_AI_POLICY}\n\n${systemPrompt}` },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      response_format: responseFormat as never,
    });
    const content = completion.choices[0]?.message?.content;
    const parsed = parseJson(content);

    return parsed
      ? attachJsonRequestMeta({ ...fallback, ...parsed } as T, {
          source: "openai",
          llmSucceeded: true,
          rawResponse: content ?? "",
        })
      : handleJsonRequestFailure(fallback, options, "LLM returned invalid JSON", {
          failureReason: "parse_error",
          rawResponse: content ?? "",
        });
  } catch (error) {
    const detail = describeLlmError(error);
    console.error("LLM request failed", detail);
    if (options.throwOnFailure) {
      throw error instanceof Error ? error : new Error("LLM request failed");
    }
    return attachJsonRequestMeta(fallback, {
      source: "error",
      llmSucceeded: false,
      failureReason: "api_error",
      errorMessage: detail.message ?? "LLM request failed",
    });
  }
}

function handleJsonRequestFailure<T>(
  fallback: T,
  options: { throwOnFailure?: boolean },
  message: string,
  meta: Pick<JsonRequestMeta, "failureReason" | "rawResponse">,
): T {
  if (options.throwOnFailure) {
    throw new Error(message);
  }

  return attachJsonRequestMeta(fallback, {
    source: "error",
    llmSucceeded: false,
    failureReason: meta.failureReason,
    errorMessage: message,
    rawResponse: meta.rawResponse,
  });
}

function attachJsonRequestMeta<T>(value: T, meta: JsonRequestMeta): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ...(value as Record<string, unknown>),
      __requestMeta: meta,
    } as T;
  }

  return value;
}

function describeLlmError(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const record = error as Record<string, unknown>;
  const cause = record.cause;
  const causeRecord =
    cause && typeof cause === "object" ? (cause as Record<string, unknown>) : null;

  return {
    name: typeof record.name === "string" ? record.name : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    status: record.status,
    code: record.code,
    type: record.type,
    requestID: record.requestID,
    cause:
      causeRecord
        ? {
            name: typeof causeRecord.name === "string" ? causeRecord.name : undefined,
            message:
              typeof causeRecord.message === "string"
                ? causeRecord.message
                : undefined,
            code: causeRecord.code,
          }
        : undefined,
  };
}

function getClient(apiKey: string) {
  if (!client) {
    client = new OpenAI({
      apiKey,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || 20000),
    });
  }

  return client;
}

function normalizeNextQuestionResult(
  result: Partial<NextQuestionResult>,
  fallback: NextQuestionResult,
  context: ConversationContext,
): NextQuestionResult {
  const currentTopic = resolveTopic(context.currentTopic);
  const currentSlot = findSlotState(context.slotStates, currentTopic.slot_name);
  const followUpCount = countPromptsForSlot(
    context.utterances,
    currentTopic.slot_name as AcpSlotName,
  );

  if (followUpCount >= currentTopic.maxFollowUpQuestions) {
    return noRelevantFollowUpResult(
      currentTopic.slot_name as AcpSlotName,
      "この話題の追加質問上限に達したため、追加質問を停止しました。",
    );
  }

  const shouldPreferFallbackDepthQuestion =
    isTerminalSlotStatus(currentSlot?.status) &&
    looksLikeMoveOnQuestion(result.question);
  const nextResult = shouldPreferFallbackDepthQuestion ? fallback : result;

  const targetSlot = normalizeAcpTargetSlot(nextResult.target_slot, fallback.target_slot);
  const targetMainSlotId =
    typeof nextResult.targetMainSlotId === "string" ? nextResult.targetMainSlotId : "";
  const targetSubSlotId =
    typeof nextResult.targetSubSlotId === "string" ? nextResult.targetSubSlotId : "";
  const askableSubSlots = buildRelevantAskableSubSlotsForQuestionPayload(
    buildSlotControlDebugState({
      slots: filterAcpSlotStates(context.slotStates),
      currentTopic: currentTopic.slot_name,
      subSlotStates: context.subSlotStates,
    }),
    context.subSlotStates ?? [],
    context.utterances,
  );

  if (askableSubSlots.length === 0) {
    return noRelevantFollowUpResult(
      currentTopic.slot_name as AcpSlotName,
      "直近発話と自然につながる追加質問候補が現在テーマ内にないため、質問生成を停止しました。",
    );
  }

  const hasValidTargetSubSlot =
    !targetMainSlotId && !targetSubSlotId
      ? false
      : askableSubSlots.some(
          (slot) =>
            slot.mainSlotId === targetMainSlotId &&
            slot.subSlotId === targetSubSlotId,
        );
  const question = nonEmptyNullable(nextResult.question, fallback.question);
  const shouldUseFallbackQuestion =
    (question ? isRepeatedQuestion(context.utterances, question, targetSlot) : false) ||
    !isQuestionRelevantToCurrentTopic(context, targetSlot) ||
    !hasValidTargetSubSlot;

  return {
    question: shouldUseFallbackQuestion ? fallback.question : question,
    transition_phrase: question
      ? nonEmpty(nextResult.transition_phrase, fallback.transition_phrase)
      : "",
    target_slot: shouldUseFallbackQuestion ? fallback.target_slot : targetSlot,
    targetMainSlotId: shouldUseFallbackQuestion ? undefined : targetMainSlotId || undefined,
    targetSubSlotId: shouldUseFallbackQuestion ? undefined : targetSubSlotId || undefined,
    reason: nonEmpty(nextResult.reason, fallback.reason),
    sensitivity: normalizeSensitivity(nextResult.sensitivity, fallback.sensitivity),
    no_relevant_followup:
      shouldUseFallbackQuestion
        ? fallback.no_relevant_followup
        : nextResult.no_relevant_followup === true || !question,
  };
}

function looksLikeMoveOnQuestion(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /次の話題|移っても|話題転換|終了確認|終えて/.test(text);
}

function noRelevantFollowUpResult(
  targetSlot: AcpSlotName,
  reason: string,
): NextQuestionResult {
  return {
    question: null,
    transition_phrase: "",
    target_slot: targetSlot,
    reason,
    sensitivity: getSlotSensitivity(targetSlot),
    no_relevant_followup: true,
  };
}

function buildConversationPayload(context: ConversationContext) {
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  const acpSlotStates = filterAcpSlotStates(context.slotStates);
  const currentSlotState = findSlotState(acpSlotStates, currentTopic.slot_name);
  const currentResearchTheme = resolveResearchThemeForSlot(currentTopic.slot_name);
  const utteranceById = new Map(
    context.utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );
  const subSlotStates = context.subSlotStates ?? [];

  return {
    discussion_topic: DISCUSSION_TOPIC,
    session: getSessionMetadata(context),
    current_research_theme: {
      id: currentResearchTheme.id,
      level: currentResearchTheme.level,
      title: currentResearchTheme.title,
      opening_question: currentResearchTheme.openingQuestion,
      source_slot_names: currentResearchTheme.sourceSlotNames,
      aspects: getResearchThemeAspects(currentResearchTheme),
      core_aspects: getCoreResearchThemeAspects(currentResearchTheme),
      optional_aspects: getOptionalResearchThemeAspects(currentResearchTheme),
      cross_topic_aspects: getCrossTopicResearchThemeAspects(currentResearchTheme),
      max_follow_up_questions: currentResearchTheme.maxFollowUpQuestions,
      response_state: getResearchThemeResponseState(
        currentResearchTheme,
        acpSlotStates,
      ),
      summary: getResearchThemeSummary(currentResearchTheme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(
        currentResearchTheme,
        acpSlotStates,
      ),
    },
    current_topic: {
      id: currentTopic.id,
      level: currentTopic.level,
      slot_name: currentTopic.slot_name,
      title: context.currentTopicTitle || currentTopic.title,
      opening_question: currentTopic.openingQuestion,
      core_slots: currentTopic.coreSlots,
      optional_slots: currentTopic.optionalSlots,
      cross_topic_slots: currentTopic.crossTopicSlots,
      aspects: getTopicAspects(currentTopic),
      core_aspects: getCoreAspects(currentTopic),
      optional_aspects: getOptionalAspects(currentTopic),
      cross_topic_aspects: getCrossTopicAspects(currentTopic),
      max_follow_up_questions: currentTopic.maxFollowUpQuestions,
      status: currentSlotState?.status ?? "unanswered",
      response_state: getSlotResponseState(currentSlotState),
      summary: currentSlotState?.summary ?? "",
      evidence_utterance: currentSlotState?.evidence_utterance ?? "",
    },
    next_topic: nextTopic
      ? {
          id: nextTopic.id,
          level: nextTopic.level,
          slot_name: nextTopic.slot_name,
          title: context.nextTopicTitle || nextTopic.title,
          opening_question: nextTopic.openingQuestion,
        }
      : null,
    available_topics: DISCUSSION_TOPICS.map((topic) => ({
      id: topic.id,
      level: topic.level,
      slot_name: topic.slot_name,
      title: topic.title,
      opening_question: topic.openingQuestion,
      opening_prompt: topic.opening_prompt,
      core_slots: topic.coreSlots,
      optional_slots: topic.optionalSlots,
      cross_topic_slots: topic.crossTopicSlots,
      aspects: getTopicAspects(topic),
      core_aspects: getCoreAspects(topic),
      optional_aspects: getOptionalAspects(topic),
      cross_topic_aspects: getCrossTopicAspects(topic),
      max_follow_up_questions: topic.maxFollowUpQuestions,
    })),
    research_themes: RESEARCH_THEMES.map((theme) => ({
      id: theme.id,
      level: theme.level,
      title: theme.title,
      opening_question: theme.openingQuestion,
      source_slot_names: theme.sourceSlotNames,
      aspects: getResearchThemeAspects(theme),
      core_aspects: getCoreResearchThemeAspects(theme),
      optional_aspects: getOptionalResearchThemeAspects(theme),
      cross_topic_aspects: getCrossTopicResearchThemeAspects(theme),
      max_follow_up_questions: theme.maxFollowUpQuestions,
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
    })),
    optional_research_themes: OPTIONAL_RESEARCH_THEMES.map((theme) => ({
      id: theme.id,
      level: theme.level,
      title: theme.title,
      opening_question: theme.openingQuestion,
      source_slot_names: theme.sourceSlotNames,
      aspects: getResearchThemeAspects(theme),
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
    })),
    current_topic_transcript: renderTranscript(getTopicRelatedUtterances(context)),
    all_conversation_log: renderTranscript(context.utterances),
    recent_5_turns: renderTranscript(recentUtterances(context.utterances, 5)),
    slot_states: acpSlotStates,
    sub_slot_states: subSlotStates.map((state) => ({
      ...state,
      evidenceUtterances: state.evidenceUtteranceIds
        .map((id) => utteranceById.get(id))
        .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
        .map((utterance) => ({
          id: utterance.id,
          speaker: utterance.speaker,
          text: utterance.text,
          created_at: utterance.created_at ?? utterance.createdAt ?? null,
        })),
    })),
    theme_metrics: calculateThemeCompletenessMetrics(acpSlotStates),
    unfilled_slots: getUnfilledSlots(acpSlotStates).map((slot) => ({
      slot_name: slot.slot_name,
      status: slot.status,
      response_state: getSlotResponseState(slot),
      summary: slot.summary,
    })),
    theme_states: RESEARCH_THEMES.map((theme) => ({
      theme_id: theme.id,
      title: theme.title,
      level: theme.level,
      source_slot_names: theme.sourceSlotNames,
      response_state: getResearchThemeResponseState(theme, acpSlotStates),
      summary: getResearchThemeSummary(theme, acpSlotStates),
      evidence_utterance: getResearchThemeEvidence(theme, acpSlotStates),
    })),
    explicit_none_answers: detectExplicitNoneResponses(context).map((response) => ({
      slot_name: response.slotName,
      evidence_utterance: formatSpeakerEvidence(response.utterance),
    })),
    uncertainty_answers: isLegacyDialogueMode()
      ? []
      : detectUncertainResponses(context).map((response) => ({
          slot_name: response.slotName,
          kind: response.kind,
          evidence_utterance: formatSpeakerEvidence(response.utterance),
          policy:
            "Treat this as meaningful ACP information, not as missing data. Ask one gentle reason-check question at most, then allow moving to another topic.",
        })),
    dialogue_policy: isLegacyDialogueMode()
      ? { mode: "legacy" }
      : {
          policy_version: AI_POLICY_VERSION,
          mode: "uncertainty_aware",
          unknown_is_valid_answer: true,
          avoid_repeating_unclear_questions: true,
          use_partial_status_for_deferral: true,
          prefer_reason_check_or_topic_switch: true,
        },
    last_utterance: context.utterances.at(-1) ?? null,
    acp_slots: ACP_SLOT_NAMES,
  };
}

async function buildQuestionPayload(context: ConversationContext) {
  const payload = buildConversationPayload(context);
  const currentTopic = resolveTopic(context.currentTopic);
  const scopedSlots = filterAcpSlotStates(context.slotStates);
  const currentSlotState = findSlotState(scopedSlots, currentTopic.slot_name);
  const fallbackQuestionScope = getCurrentTopicQuestionScope({
    slots: scopedSlots,
    currentTopic: currentTopic.slot_name,
    subSlotStates: context.subSlotStates,
  });
  const slotControl = buildSlotControlDebugState({
    slots: scopedSlots,
    currentTopic: currentTopic.slot_name,
    subSlotStates: context.subSlotStates,
  });
  const questionScope = buildQuestionScopeFromSlotControl(
    slotControl,
    fallbackQuestionScope,
  );
  const askableSubSlots = buildRelevantAskableSubSlotsForQuestionPayload(
    slotControl,
    context.subSlotStates ?? [],
    context.utterances,
  );
  const slotBackedMemory = buildSlotBackedQuestionMemory(
    currentTopic.id,
    context.subSlotStates ?? [],
    context.utterances,
  );
  const unassignedRecentUtterances = buildUnassignedRecentUtterances(
    context.utterances,
    context.subSlotStates ?? [],
    NEXT_QUESTION_UNASSIGNED_UTTERANCE_COUNT,
  );

  return {
    ...payload,
    available_topics: payload.available_topics.filter(
      (topic) => topic.slot_name === currentTopic.slot_name,
    ),
    slot_states: currentSlotState ? [currentSlotState] : [],
    unfilled_slots:
      currentSlotState && !isTerminalSlotStatus(currentSlotState.status)
        ? [
            {
              slot_name: currentSlotState.slot_name,
              status: currentSlotState.status,
              response_state: getSlotResponseState(currentSlotState),
              summary: currentSlotState.summary,
            },
          ]
        : [],
    question_scope: questionScope,
    next_question_input: {
      currentTopic: {
        id: currentTopic.id,
        title: currentTopic.title,
      },
      askableSubSlots,
      slotBackedMemory,
      unassignedRecentUtterances,
      recentUtterances: recentUtterances(
        context.utterances,
        NEXT_QUESTION_RECENT_UTTERANCE_COUNT,
      ).map(toQuestionUtterancePayload),
      alreadyAskedQuestions: context.utterances
        .filter((utterance) => !isElderSpeaker(utterance.speaker))
        .map((utterance) => utterance.text)
        .slice(-NEXT_QUESTION_ALREADY_ASKED_COUNT),
      remainingQuestionCount: Math.max(
        0,
        currentTopic.maxFollowUpQuestions -
          countPromptsForSlot(context.utterances, currentTopic.slot_name as AcpSlotName),
      ),
    },
    control_debug: {
      currentTopicId: questionScope.currentTopicId,
      currentMainSlot: questionScope.currentMainSlot,
      referencedSubSlots: questionScope.referencedSubSlots.map((slot) => slot.label),
      selectionReason:
        "質問生成payloadでは現在テーマのスロットと関連保留項目のみを参照対象にしています。",
      deferredSlotQueue: questionScope.relatedDeferredItems,
      allSlotReferenceUsed: false,
    },
  };
}

function buildAskableSubSlotsForQuestionPayload(
  debugState: SlotControlDebugState,
  subSlotStates: StoredSubSlotState[],
) {
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);
  if (!currentMainSlot) return [];

  return currentMainSlot.subSlots
    .filter((slot) => slot.canAskAgain)
    .map((slot) => {
      const definition = resolveSubSlotDefinition(currentMainSlot.topicId, slot.id);
      const stored = subSlotStates.find(
        (state) =>
          state.mainSlotId === currentMainSlot.topicId &&
          state.subSlotId === slot.id,
      );

      return {
        mainSlotId: currentMainSlot.topicId,
        subSlotId: slot.id,
        label: slot.label,
        description: definition?.description ?? slot.label,
        completion: stored?.completion ?? "none",
        responseState: stored?.responseState ?? "no_response",
      };
    });
}

function buildRelevantAskableSubSlotsForQuestionPayload(
  debugState: SlotControlDebugState,
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
) {
  const candidates = buildAskableSubSlotsForQuestionPayload(debugState, subSlotStates);
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);
  if (!currentMainSlot) return [];

  const latestElderText = latestElderUtteranceText(utterances);
  const recentText = recentUtterances(utterances, 5)
    .map((utterance) => utterance.text)
    .join("\n");
  const latestIsUncertain = Boolean(classifyUncertainResponse(latestElderText));
  const statesBySubSlotId = new Map(
    subSlotStates
      .filter((state) => state.mainSlotId === currentMainSlot.topicId)
      .map((state) => [state.subSlotId, state]),
  );

  const scored = currentMainSlot.subSlots
    .map((slot) => {
      const baseCandidate = candidates.find((candidate) => candidate.subSlotId === slot.id);
      const stored = statesBySubSlotId.get(slot.id);
      if (!baseCandidate && !canAskOptionalSubSlot(slot.priority, stored)) return null;

      const score = scoreSubSlotRelevance({
        id: slot.id,
        label: slot.label,
        latestText: latestElderText,
        recentText,
      });
      const threshold = latestIsUncertain ? 3 : 2;
      if (score < threshold) return null;

      return {
        ...(baseCandidate ?? {
          mainSlotId: currentMainSlot.topicId,
          subSlotId: slot.id,
          label: slot.label,
          description:
            resolveSubSlotDefinition(currentMainSlot.topicId, slot.id)?.description ??
            slot.label,
          completion: stored?.completion ?? "none",
          responseState: stored?.responseState ?? "no_response",
        }),
        priority: slot.priority,
        relevanceScore: score,
        relevanceReason: `直近発話と「${slot.label}」の関連性から候補にしました。`,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }

      return priorityRank(left.priority) - priorityRank(right.priority);
    });

  return scored.slice(0, 3);
}

function canAskOptionalSubSlot(
  priority: string,
  state: StoredSubSlotState | undefined,
) {
  if (priority === "core") return false;
  if (!state) return true;
  if (state.completion === "complete") return false;

  return ![
    "explicit_none",
    "declined",
    "not_considered",
    "unable_to_verbalize",
  ].includes(state.responseState);
}

function priorityRank(priority: string) {
  if (priority === "core") return 0;
  if (priority === "optional") return 1;
  return 2;
}

function latestElderUtteranceText(utterances: ConversationUtterance[]) {
  return [...utterances].reverse().find((utterance) => isElderSpeaker(utterance.speaker))?.text ?? "";
}

function scoreSubSlotRelevance(input: {
  id: string;
  label: string;
  latestText: string;
  recentText: string;
}) {
  const text = `${input.latestText}\n${input.recentText}`;
  const normalized = normalizeAnswerText(text);
  if (!normalized) return 0;

  let score = 0;
  for (const keyword of relevanceKeywordsForSubSlot(input.id, input.label)) {
    if (normalized.includes(normalizeAnswerText(keyword))) score += 2;
  }

  if (input.label && normalized.includes(normalizeAnswerText(input.label))) score += 3;
  if (input.latestText && hasKeyword(input.latestText, relevanceKeywordsForSubSlot(input.id, input.label))) {
    score += 1;
  }

  return score;
}

function relevanceKeywordsForSubSlot(id: string, label: string) {
  const base = label
    .split(/[、・\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const byId: Record<string, string[]> = {
    valued_routine: ["散歩", "毎朝", "毎日", "日課", "習慣", "庭", "手入れ", "畑"],
    hobby_or_joy: ["楽し", "趣味", "好き", "散歩", "庭", "花", "会う", "話", "うれしい"],
    relationships: ["近所", "人", "友", "家族", "会う", "話", "交流", "つながり"],
    role: ["役割", "仕事", "手伝", "頼ら", "任され"],
    attachment: ["自宅", "家", "地域", "近所", "庭", "住み慣れ"],
    reason: ["大切", "理由", "なぜ", "支え", "意味", "安心", "楽し"],
    continued_activity: ["続け", "散歩", "庭", "手入れ", "活動", "趣味"],
    continued_relationship: ["続け", "近所", "人", "友", "家族", "会う", "交流"],
    preferred_environment: ["自宅", "家", "地域", "近所", "暮らし"],
    not_want_to_lose: ["失いたく", "続け", "大切", "できれば", "自宅"],
    acceptable_support: ["手助け", "支援", "助け", "受け入れ"],
    unacceptable_support: ["嫌", "避け", "不安", "心配", "受け入れにくい"],
    support_person: ["誰", "家族", "娘", "息子", "近所", "頼み"],
    request: ["家族", "お願い", "伝え", "頼み"],
    burden_concern: ["負担", "迷惑", "心配", "家族"],
    trusted_person: ["信頼", "相談", "任せ", "家族", "娘", "息子"],
    trust_reason: ["理由", "なぜ", "信頼", "安心"],
    values_to_share: ["知って", "価値観", "大切", "伝え"],
  };

  return [...new Set([...base, ...(byId[id] ?? [])])];
}

function buildSlotBackedQuestionMemory(
  currentMainSlotId: string,
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
) {
  const utteranceById = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );

  return subSlotStates
    .filter((state) => state.mainSlotId === currentMainSlotId)
    .map((state) => {
      const definition = resolveSubSlotDefinition(state.mainSlotId, state.subSlotId);
      const evidenceUtterances = state.evidenceUtteranceIds
        .map((id) => utteranceById.get(id))
        .filter((utterance): utterance is ConversationUtterance => Boolean(utterance))
        .map(toQuestionUtterancePayload);

      return {
        mainSlotId: state.mainSlotId,
        subSlotId: state.subSlotId,
        label: definition?.label ?? state.subSlotId,
        description: definition?.description ?? "",
        completion: state.completion,
        responseState: state.responseState,
        reasonCode: state.reasonCode,
        canAskAgain: state.canAskAgain,
        evidenceUtterances,
      };
    })
    .filter(
      (state) =>
        state.completion !== "none" ||
        state.responseState !== "no_response" ||
        state.evidenceUtterances.length > 0,
    );
}

function buildUnassignedRecentUtterances(
  utterances: ConversationUtterance[],
  subSlotStates: StoredSubSlotState[],
  count: number,
) {
  const assignedUtteranceIds = new Set(
    subSlotStates.flatMap((state) => state.evidenceUtteranceIds),
  );

  return recentUtterances(
    utterances.filter(
      (utterance) => !utterance.id || !assignedUtteranceIds.has(utterance.id),
    ),
    count,
  ).map(toQuestionUtterancePayload);
}

function toQuestionUtterancePayload(utterance: ConversationUtterance) {
  return {
    id: utterance.id,
    speaker: utterance.speaker,
    text: utterance.text,
    created_at: utterance.created_at ?? utterance.createdAt ?? null,
  };
}
function buildQuestionScopeFromSlotControl(
  debugState: SlotControlDebugState,
  fallback: ReturnType<typeof getCurrentTopicQuestionScope>,
) {
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);

  if (!currentMainSlot) return fallback;

  return {
    currentTopicId: debugState.currentTopicId,
    currentMainSlot: debugState.currentMainSlot,
    referencedSubSlots: currentMainSlot.subSlots
      .filter((slot) => slot.canAskAgain)
      .map((slot) => ({
        id: slot.id,
        label: slot.label,
        status: slot.status,
        unansweredReason: slot.unansweredReason,
      })),
    relatedDeferredItems: debugState.deferredSlotQueue.filter(
      (item) => item.suggestedTiming === "related_topic",
    ),
    allSlotReferenceUsed: false,
  };
}

function ensureFinalMinutesIncludeTopic(
  minutes: FinalMinutesResult,
  context: ConversationContext,
): FinalMinutesResult {
  const fallback = buildFallbackMinutes(
    context.utterances,
    context.slotStates,
    getSessionMetadata(context),
    context.subSlotStates ?? [],
  );
  const rawJson =
    minutes.json && typeof minutes.json === "object"
      ? (minutes.json as Record<string, unknown>)
      : {};
  const minutesInput =
    rawJson.acp_minutes_llm_input && typeof rawJson.acp_minutes_llm_input === "object"
      ? (rawJson.acp_minutes_llm_input as FinalMinutesResult["json"]["acp_minutes_llm_input"])
      : fallback.json.acp_minutes_llm_input;

  return {
    markdown: minutes.markdown,
    json: {
      generated_at:
        typeof rawJson.generated_at === "string"
          ? rawJson.generated_at
          : new Date().toISOString(),
      session: getSessionMetadata(context),
      discussion_topic: DISCUSSION_TOPIC,
      utterances: context.utterances,
      slots: filterAcpSlotStates(context.slotStates),
      acp_minutes: validateACPMinutes(rawJson.acp_minutes, minutesInput) ?? fallback.json.acp_minutes,
      acp_minutes_llm_input: minutesInput,
      acp_minutes_llm_meta:
        rawJson.acp_minutes_llm_meta && typeof rawJson.acp_minutes_llm_meta === "object"
          ? (rawJson.acp_minutes_llm_meta as FinalMinutesResult["json"]["acp_minutes_llm_meta"])
          : fallback.json.acp_minutes_llm_meta,
      acp_minutes_narrative_debug:
        rawJson.acp_minutes_narrative_debug && typeof rawJson.acp_minutes_narrative_debug === "object"
          ? (rawJson.acp_minutes_narrative_debug as FinalMinutesResult["json"]["acp_minutes_narrative_debug"])
          : fallback.json.acp_minutes_narrative_debug,
      themes: Array.isArray(rawJson.themes)
        ? (rawJson.themes as FinalMinutesResult["json"]["themes"])
        : fallback.json.themes,
      optional_themes: Array.isArray(rawJson.optional_themes)
        ? (rawJson.optional_themes as FinalMinutesResult["json"]["optional_themes"])
        : fallback.json.optional_themes,
      theme_metrics:
        rawJson.theme_metrics && typeof rawJson.theme_metrics === "object"
          ? (rawJson.theme_metrics as FinalMinutesResult["json"]["theme_metrics"])
          : fallback.json.theme_metrics,
      auxiliary_items: Array.isArray(rawJson.auxiliary_items)
        ? (rawJson.auxiliary_items as AuxiliaryMinutesItem[])
        : fallback.json.auxiliary_items,
      summary:
        typeof rawJson.summary === "string"
          ? rawJson.summary
          : "会話ログとACPスロット状態から生成した議事録です。",
    },
  };
}

function getSessionMetadata(context: ConversationContext) {
  return {
    id: context.sessionId,
    participant_code: context.participantCode ?? null,
  };
}

function applyUncertaintyNextQuestionPolicy(
  context: ConversationContext,
  result: NextQuestionResult,
): NextQuestionResult {
  if (result.no_relevant_followup || !result.question) return result;

  const response = getLatestUncertainResponse(context);
  if (!response) return result;

  const promptCount = countPromptsForSlot(context.utterances, response.slotName);
  const targetSlot = normalizeAcpTargetSlot(response.slotName, result.target_slot);

  if (promptCount <= 1) {
    return {
      ...result,
      question: UNCERTAINTY_REASON_PROMPT,
      transition_phrase: "",
      target_slot: targetSlot,
      reason: UNCERTAINTY_REASON,
      sensitivity: getSlotSensitivity(targetSlot as AcpSlotName),
    };
  }

  return {
    ...result,
    question: UNCERTAINTY_MOVE_ON_PROMPT,
    transition_phrase: "",
    target_slot: targetSlot,
    reason: UNCERTAINTY_SWITCH_REASON,
    sensitivity: getSlotSensitivity(targetSlot as AcpSlotName),
  };
}

function fallbackNextQuestion(
  utterances: ConversationUtterance[],
  slotStates: AcpSlotState[],
  currentTopic?: string,
  subSlotStates: StoredSubSlotState[] = [],
): NextQuestionResult {
  const recentText = recentUtterances(utterances, 5)
    .map((utterance) => utterance.text)
    .join(" ");
  const preferredTopic = resolveTopic(currentTopic);
  const preferredSlot = preferredTopic.slot_name as AcpSlotName;
  const preferredState = findSlotState(slotStates, preferredSlot);
  const followUpCount = countPromptsForSlot(utterances, preferredSlot);
  const followUpSubSlot = findFallbackFollowUpSubSlot(
    preferredTopic.id,
    subSlotStates,
    utterances,
    slotStates,
  );
  const canCompletePreferredTheme = followUpCount >= preferredTopic.maxFollowUpQuestions;

  if (canCompletePreferredTheme) {
    return noRelevantFollowUpResult(
      preferredSlot,
      "この話題の追加質問上限に達したため、追加質問を停止しました。",
    );
  }

  if (followUpSubSlot) {
    return {
      question: questionForSubSlotFollowUp(followUpSubSlot.label),
      transition_phrase: recentText ? "今のお話に関連して、" : "",
      target_slot: preferredSlot,
      targetMainSlotId: preferredTopic.id,
      targetSubSlotId: followUpSubSlot.id,
      reason: `現在テーマのcore項目「${followUpSubSlot.label}」をもう少し確認します。`,
      sensitivity: getSlotSensitivity(preferredSlot),
    };
  }

  if (getSlotResponseState(preferredState)) {
    return noRelevantFollowUpResult(
      preferredSlot,
      "現在テーマは回答済みで、直近発話と自然につながる追加質問候補がありません。",
    );
  }

  const contextualSlot = ACP_SLOT_NAMES.find((slotName) =>
    hasKeyword(recentText, SLOT_KEYWORDS[slotName]),
  );
  const selected =
    !isTerminalSlotStatus(preferredState?.status) ? preferredSlot :
    contextualSlot === preferredSlot ? contextualSlot :
    preferredSlot;
  const targetSlot = ACP_SLOT_NAMES.includes(selected as AcpSlotName)
    ? (selected as AcpSlotName)
    : preferredSlot;

  return {
    question: FALLBACK_QUESTIONS[targetSlot],
    transition_phrase: recentText ? "今のお話に関連して、" : "",
    target_slot: targetSlot,
    reason: "直近の会話と未充足スロットの状態から、自然につながりやすい確認項目として選びました。",
    sensitivity: getSlotSensitivity(targetSlot),
  };
}

function findFallbackFollowUpSubSlot(
  mainSlotId: string,
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
  slotStates: AcpSlotState[],
) {
  const topic = DISCUSSION_TOPICS.find((item) => item.id === mainSlotId);
  if (!topic) return null;

  const debugState = buildSlotControlDebugState({
    slots: filterAcpSlotStates(slotStates),
    currentTopic: topic.slot_name,
    subSlotStates,
  });
  const [candidate] = buildRelevantAskableSubSlotsForQuestionPayload(
    debugState,
    subSlotStates,
    utterances,
  );
  if (!candidate) return null;

  return topic.aspects.find((aspect) => aspect.id === candidate.subSlotId) ?? null;
}

function questionForSubSlotFollowUp(label: string) {
  if (/理由|なぜ/.test(label)) {
    return "それがご本人にとって大切な理由や、そう感じる背景をもう少し聞いてもよいですか。";
  }

  if (/不安|負担|避け|受け入れにくい|失いたくない|してほしくない/.test(label)) {
    return "反対に、できれば避けたいことや心配なことはありますか。";
  }

  if (/誰|人|家族|信頼|相談/.test(label)) {
    return "そのことで関わってほしい人や、伝えておきたい相手はいますか。";
  }

  return `今のお話に関連して、「${label}」についてもう少し聞いてもよいですか。`;
}

function fallbackTopicSwitch(context: ConversationContext): TopicSwitchResult {
  const currentTopic = resolveTopic(context.currentTopic);
  const nextTopic = context.nextTopic ? resolveTopic(context.nextTopic) : null;
  const currentSlot = currentTopic.slot_name as AcpSlotName;
  const currentState = findSlotState(context.slotStates, currentSlot);
  const followUpCount = countPromptsForSlot(context.utterances, currentSlot);
  const canSwitch =
    Boolean(nextTopic) &&
    (Boolean(getSlotResponseState(currentState)) ||
      followUpCount >= currentTopic.maxFollowUpQuestions);

  if (canSwitch && nextTopic) {
    const nextSlot = nextTopic.slot_name as AcpSlotName;

    return {
      should_switch: true,
      message: `ここまでのお話を大切にしながら、次に「${nextTopic.title}」について少し伺ってもよいですか。\n${nextTopic.opening_prompt}`,
      target_slot: nextSlot,
      next_topic: nextTopic.slot_name,
      reason: "現在の話題はある程度確認できているため、次の話題へ自然に移る判断をしました。",
      sensitivity: getSlotSensitivity(nextSlot),
    };
  }

  const question =
    FALLBACK_QUESTIONS[currentSlot] ??
    FALLBACK_QUESTIONS["今の生活で大切にしていること"];

  return {
    should_switch: false,
    message: `今の話題をもう少しだけ確認してもよいですか。\n${question}`,
    target_slot: currentSlot,
    next_topic: currentTopic.slot_name,
    reason: "現在の話題にまだ未確認または部分的な内容が残っているため、同じ話題で追加確認する判断をしました。",
    sensitivity: getSlotSensitivity(currentSlot),
  };
}

function fallbackEndCheck(slotStates: AcpSlotState[]): EndCheckResult {
  const remaining = RESEARCH_THEMES.filter(
    (theme) => !getResearchThemeResponseState(theme, slotStates),
  ).map((theme) => theme.title);
  const metrics = calculateThemeCompletenessMetrics(slotStates);
  const canEnd = remaining.length <= 1 || metrics.responseStateCoverage >= 0.8;

  return {
    can_end: canEnd,
    message: canEnd
      ? "今日のところは大切なお話がかなり確認できています。最後に、言い残したことがないかだけ確認して終えてもよさそうです。"
      : "まだ大切な確認が少し残っています。無理のない範囲で、もう一つだけ確認してから終えると安心です。",
    reason: canEnd
      ? "Theme単位で本人の回答状態または根拠発話が概ね確認できています。Aspect未充足は終了不可の理由にしていません。"
      : "Theme単位で本人の回答状態が未確認の項目が残っています。",
    remaining_slots: remaining,
  };
}

function resolveTopic(value: string | undefined) {
  return resolveDiscussionTopic(value);
}

function findSlotState(slotStates: AcpSlotState[], slotName: string) {
  return slotStates.find((slot) => slot.slot_name === slotName);
}

function filterAcpSlotStates(slots: AcpSlotState[]) {
  return slots.filter((slot) =>
    ACP_SLOT_NAMES.includes(slot.slot_name as AcpSlotName),
  );
}

function normalizeAcpTargetSlot(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";
  const normalizedText = normalizeSlotName(text);
  const normalizedFallback = normalizeSlotName(fallback);

  if (normalizedText) return normalizedText;
  if (normalizedFallback) return normalizedFallback;

  return ACP_SLOT_NAMES[0];
}

function normalizeRemainingSlots(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;

  const slots = value
    .map(String)
    .map((slotName) => normalizeSlotName(slotName))
    .filter((slotName): slotName is AcpSlotName => Boolean(slotName));

  return slots.length > 0 || fallback.length === 0 ? slots : fallback;
}

function isRepeatedQuestion(
  utterances: ConversationUtterance[],
  question: string,
  targetSlot: string,
) {
  const normalizedQuestion = normalizeAnswerText(question);
  if (!normalizedQuestion) return true;

  return recentUtterances(utterances, 8).some((utterance) => {
    if (isElderSpeaker(utterance.speaker)) return false;

    const sameSlot = findPromptedSlotFromText(utterance.text) === targetSlot;
    const sameText = normalizeAnswerText(utterance.text) === normalizedQuestion;

    return sameSlot && sameText;
  });
}

function isQuestionRelevantToCurrentTopic(
  context: ConversationContext,
  targetSlot: string,
) {
  const currentTopic = resolveTopic(context.currentTopic);
  if (targetSlot === currentTopic.slot_name) return true;

  const currentState = findSlotState(context.slotStates, currentTopic.slot_name);
  if (isTerminalSlotStatus(currentState?.status)) return true;

  return false;
}

function detectExplicitNoneResponses(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
): ExplicitNoneResponse[] {
  const currentTopic = context.currentTopic
    ? normalizeSlotName(context.currentTopic)
    : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, ExplicitNoneResponse>();

  context.utterances.forEach((utterance, index) => {
    if (!isElderSpeaker(utterance.speaker) || !isExplicitNoneAnswer(utterance.text)) {
      return;
    }

    const promptedSlot =
      findPromptedSlotBeforeAnswer(context.utterances, index) ??
      (index === latestIndex ? currentTopic : null);

    if (!promptedSlot) return;

    responsesBySlot.set(promptedSlot, {
      slotName: promptedSlot,
      utterance,
      index,
    });
  });

  return [...responsesBySlot.values()];
}

function detectUncertainResponses(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
): UncertainResponse[] {
  const currentTopic = context.currentTopic
    ? normalizeSlotName(context.currentTopic)
    : null;
  const latestIndex = context.utterances.length - 1;
  const responsesBySlot = new Map<AcpSlotName, UncertainResponse>();

  context.utterances.forEach((utterance, index) => {
    if (!isElderSpeaker(utterance.speaker) || isExplicitNoneAnswer(utterance.text)) {
      return;
    }

    const kind = classifyUncertainResponse(utterance.text);
    if (!kind) return;

    const promptedSlot =
      findPromptedSlotBeforeAnswer(context.utterances, index) ??
      (index === latestIndex ? currentTopic : null);

    if (!promptedSlot) return;

    responsesBySlot.set(promptedSlot, {
      slotName: promptedSlot,
      utterance,
      index,
      kind,
    });
  });

  return [...responsesBySlot.values()];
}

function getLatestUncertainResponse(
  context: Pick<ConversationContext, "utterances" | "slotStates" | "currentTopic">,
) {
  const latest = detectUncertainResponses(context).sort(
    (left, right) => right.index - left.index,
  )[0];
  if (!latest) return undefined;

  const hasNewerElderUtterance = context.utterances
    .slice(latest.index + 1)
    .some((utterance) => isElderSpeaker(utterance.speaker));

  return hasNewerElderUtterance ? undefined : latest;
}

function findPromptedSlotBeforeAnswer(
  utterances: ConversationUtterance[],
  answerIndex: number,
) {
  for (let index = answerIndex - 1; index >= Math.max(0, answerIndex - 4); index -= 1) {
    const utterance = utterances[index];
    if (!utterance || isElderSpeaker(utterance.speaker)) continue;

    const slotName = findPromptedSlotFromText(utterance.text);
    if (slotName) return slotName;
  }

  return null;
}

function findPromptedSlotFromText(text: string) {
  const [best] = ACP_SLOT_NAMES.map((slotName) => ({
    slotName,
    score: getSlotPromptScore(text, slotName),
  })).sort((left, right) => right.score - left.score);

  return best && best.score > 0 ? best.slotName : null;
}

function getSlotPromptScore(text: string, slotName: AcpSlotName) {
  const keywords = SLOT_KEYWORDS[slotName] ?? [];
  const keywordScore = keywords.filter((keyword) => text.includes(keyword)).length;
  const questionScore = FALLBACK_QUESTIONS[slotName] === text ? 4 : 0;
  const slotNameScore = text.includes(slotName) ? 3 : 0;

  return keywordScore + questionScore + slotNameScore;
}

function classifyUncertainResponse(text: string): UncertainResponseKind | null {
  const normalized = normalizeAnswerText(text);
  if (!normalized || normalized.length > 80) return null;

  if (
    /(?:\u8a00\u8449|\u3053\u3068\u3070).*(?:\u96e3\u3057\u3044|\u3067\u304d\u306a\u3044|\u51fa\u306a\u3044)|(?:\u3046\u307e\u304f|\u4e0a\u624b\u304f).*\u8a00\u3048|\u8868\u73fe.*\u96e3\u3057\u3044/.test(
      normalized,
    )
  ) {
    return "language_gap";
  }

  if (
    /\u8003\u3048\u305f\u3053\u3068(?:\u304c|\u306f)?\u306a\u3044|\u8003\u3048\u3066\u306a|\u307e\u3060.*\u8003\u3048/.test(
      normalized,
    )
  ) {
    return "not_considered";
  }

  if (
    /\u77e5\u8b58.*\u306a\u3044|\u77e5\u3089\u306a\u3044|\u8aac\u660e.*(?:\u308f\u304b\u3089|\u5206\u304b\u3089)|\u60c5\u5831.*\u306a\u3044/.test(
      normalized,
    )
  ) {
    return "knowledge_gap";
  }

  if (
    /\u6016\u3044|\u4e0d\u5b89|\u3064\u3089\u3044|\u8f9b\u3044|\u3057\u3093\u3069\u3044|\u8003\u3048\u305f\u304f\u306a\u3044/.test(
      normalized,
    )
  ) {
    return "emotional_load";
  }

  if (
    /\u6c7a\u3081\u3089\u308c\u306a\u3044|\u8ff7\u3063\u3066|\u307e\u3060.*\u6c7a\u3081|\u3069\u3061\u3089\u3068\u3082|\u306a\u3093\u3068\u3082|\u4f55\u3068\u3082/.test(
      normalized,
    )
  ) {
    return "undecided";
  }

  if (/(?:\u308f\u304b\u3089|\u5206\u304b\u3089|\u5206\u304b\u3093|\u8a00\u3048\u306a\u3044|\u601d\u3044\u3064\u304b\u306a\u3044|\u6d6e\u304b\u3070\u306a\u3044)/.test(normalized)) {
    return "unknown";
  }

  return null;
}

function isExplicitNoneAnswer(text: string) {
  const normalized = normalizeAnswerText(text);
  if (!normalized || normalized.length > 24) return false;
  if (!isLegacyDialogueMode() && isUncertaintyOnlyAnswer(normalized)) return false;

  return (
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに|別に|あまり)?(?:ない|ありません|ないです|なし|思いつかない|浮かばない|わからない|分からない|言えない|いえない)(?:な|かな|ですね|です|と思う)?$/.test(
      normalized,
    ) ||
    /^(?:今は|今のところ|現時点では)?(?:特に|とくに).*(?:ない|ありません|なし|思いつかない|浮かばない|わからない|分からない|言えない|いえない)$/.test(
      normalized,
    )
  );
}

function isUncertaintyOnlyAnswer(normalized: string) {
  return /わからない|分からない|分かんない|言えない|いえない|思いつかない|浮かばない|決められない|迷って/.test(
    normalized,
  );
}

function normalizeAnswerText(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s　。、．.！!？?「」『』"'`]/g, "");
}

function countPromptsForSlot(
  utterances: ConversationUtterance[],
  slotName: AcpSlotName,
) {
  return utterances.filter((utterance) => {
    if (isElderSpeaker(utterance.speaker)) return false;
    return findPromptedSlotFromText(utterance.text) === slotName;
  }).length;
}

function isLegacyDialogueMode() {
  return process.env.ACP_DIALOGUE_MODE === "legacy";
}

function formatSpeakerEvidence(utterance: ConversationUtterance) {
  const speaker = isCaregiverSpeaker(utterance.speaker) ? "介護者" : "本人";

  return `${speaker}: ${truncate(utterance.text, 160)}`;
}

function getTopicRelatedUtterances(context: ConversationContext) {
  const topic = resolveTopic(context.currentTopic);
  const keywords = SLOT_KEYWORDS[topic.slot_name as AcpSlotName] ?? [];
  const related = context.utterances.filter((utterance) =>
    hasKeyword(utterance.text, keywords),
  );

  return related.length > 0
    ? related.slice(-12)
    : recentUtterances(context.utterances, 8);
}

function getSlotSensitivity(slotName: AcpSlotName): Sensitivity {
  if (slotName === "自分で決められないときに相談してほしい人") {
    return "high";
  }

  if (
    slotName === "手助けが必要になったときの希望" ||
    slotName === "家族に伝えておきたいこと"
  ) {
    return "medium";
  }

  return "low";
}

function parseJson(content: string | null | undefined) {
  if (!content) return null;

  const cleaned = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    return null;
  }
}

function normalizeSensitivity(value: unknown, fallback: Sensitivity): Sensitivity {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function nonEmpty(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.trim() : "";

  return text || fallback;
}

function nonEmptyNullable(value: unknown, fallback: string | null) {
  const text = typeof value === "string" ? value.trim() : "";

  return text || fallback;
}

function hasKeyword(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function truncate(text: string, maxLength: number) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

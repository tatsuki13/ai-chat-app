import type OpenAI from "openai";
import {
  QUESTION_POLICY_VERSION, buildDialogueGuards, currentParticipantUtterances,
  participantSpeaker, repeatsQuestion, QuestionGenerationError, responseBarrier,
  type QuestionHistoryItem,
} from "./ai/question-policy";
import { buildAnonymizedAIUserContent } from "./ai/anonymized-input";
import {
  createOpenAIClient,
  getDialogueOpenAIModel,
  getDefaultOpenAITimeoutMs,
  getMinutesOpenAIModel,
} from "./ai/client";
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
  isTerminalValidResponseState,
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
  type FinalMinutesResult,
  type NextQuestionResult,
  type QuestionPurpose,
  type QuestionPolicyMetadata,
  type Sensitivity,
  type SlotReasonCode,
  type SlotControlDebugState,
  type StoredSubSlotState,
  type SubSlotCompletionRule,
  type SubSlotControlOverride,
  type ThemeMinutesItem,
  type UnansweredReason,
} from "./acp-mvp";

type ConversationContext = {
  utterances: ConversationUtterance[];
  utterancesToClassify?: ConversationUtterance[];
  slotStates: AcpSlotState[];
  subSlotStates?: StoredSubSlotState[];
  aiQuestionHistory?: QuestionHistoryItem[];
  currentTopicQuestionCount?: number;
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
const DEFAULT_TOPIC_AI_QUESTION_LIMIT = 2;
const INSUFFICIENT_TOPIC_AI_QUESTION_LIMIT = 3;
const AI_QUESTION_LLM_MAX_ATTEMPTS = 2;

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

const COMMON_AI_POLICY = [
  "あなたは、人間主導の家族ACP対話を支援する第三者的な補助AIです。",
  "本人や介護者の会話相手にはならず、会話の主体は人間に残してください。",
  "支援範囲は、質問候補、話題遷移候補、終了確認、議事録生成、slot状態更新に限ります。",
  "医療、介護、法律、倫理、価値観について判断や助言をしないでください。",
  "保存済みの発話ログに存在しない事実を推測しないでください。",
  "ACP slot、topic、utterance、speaker、slot statusを新しく作らないでください。",
  "target_slotやnext_topicを選ぶ場合は、必ず提供されたacp_slotsとavailable_topicsだけを使用してください。",
  "短い不明・保留の回答も有効なACP情報です。同じ質問を機械的に繰り返さないでください。",
  "指定されたJSON構造だけを返してください。",
].join("\n");

const CAREGIVER_INTERPRETATION_AGREEMENT_PREFIX = "介護者解釈に同意: ";

const SYSTEM_CLASSIFY_SLOT_UTTERANCES = [
 "あなたはACP対話ログの発話を、提供された固定のメインスロット・サブスロットへ意味分類するAIです。",
  "【役割】",
  "conversation_logから観察できるevidence事実だけを抽出してください。",
  "slot completion、responseState、reasonCode、保存可否、状態遷移、再質問可否はコード側で決定するため、出力しないでください。",
  "発話を要約・正規化し、正式なslot内容として返してはいけません。",
  "evidence抽出ではcurrentSubSlotStatesを無視し、conversation_logだけを根拠にしてください。",
  "【分類】",
  "提供されたmainSlotIdとsubSlotIdだけを使用し、新しいID、スロット名、類似名、別名を作らないでください。",
  "1発話当たりの分類は最大maxClassificationsPerUtterance件です。複数のaspectやthemeを支える場合は、この上限内ですべて返してください。",
  "分類できない発話はunmatchedUtteranceIdsに入れてください。",
  "根拠にはconversation_logに存在するutterance.idだけを使用し、evidenceUtteranceIdsに含めてください。",
  "【内容の判定】",
  "対象sub-slotの内容が明示されていれば、理由や条件がなくてもspecificContentPresentをtrueにしてください。",
  "回答の深さと回答の有無を区別し、短くても明確な希望はspecific contentとして扱ってください。",
  "【介護者発話】",
  "介護者の解釈や発話だけを本人の意思・希望として分類しないでください。",
  "介護者発話だけによる報告はevidenceTypeをcaregiver_report_onlyとし、本人の確定した希望として扱わないでください。",
  "介護者発話を本人の意思のevidenceに使えるのは、近接する本人の明確な同意または補足がある場合だけです。その場合は介護者発話と本人発話の両IDをevidenceUtteranceIdsに含めてください。",
  "次のJSON形式のみを返してください。",
  '{"classifications":[{"mainSlotId":"...","subSlotId":"...","relevantMentionPresent":true,"responsePresent":true,"specificContentPresent":true,"reasonPresent":false,"conditionPresent":false,"examplePresent":false,"ambiguityPresent":false,"conflictPresent":false,"responseMeaning":"preference_expressed | explicit_none | not_considered | unable_to_verbalize | declined | other_response | unknown","evidenceType":"direct_elder_statement | elder_confirmation | caregiver_report_with_elder_confirmation | caregiver_report_only | shared_statement | unknown","evidenceUtteranceIds":["..."],"classificationNote":"optional"}],"unmatchedUtteranceIds":["..."]}',
].join("\n");

const SYSTEM_AI_QUESTION_WITH_SLOT_UPDATES = [
  "あなたは家族間プレACP対話の補助AIです。家族が主体であり、スロット充足率の最大化や意思決定が目的ではありません。ボタンが押された今回だけを支援してください。",
  "発話分類slot_updatesとnext_actionを同じJSONで返してください。分類は全sub_slot_definitionsを対象とし、質問候補candidate_slotsの最大2件に制限しないでください。",
  "分類の根拠はunprocessed_utterancesだけです。各未処理発話を分類するかunmatchedUtteranceIdsに入れてください。recent_contextやevidence_memoryは質問の背景であり新たな分類根拠にしないでください。",
  "分類フィールド: mainSlotId,subSlotId,relevantMentionPresent,responsePresent,specificContentPresent,reasonPresent,conditionPresent,examplePresent,ambiguityPresent,conflictPresent,responseMeaning,evidenceType,evidenceUtteranceIds。responseMeaningはpreference_expressed/explicit_none/not_considered/unable_to_verbalize/declined/other_response/unknown、evidenceTypeはdirect_elder_statement/elder_confirmation/caregiver_report_with_elder_confirmation/caregiver_report_only/shared_statement/unknown。既存状態を進行発話で上書きしないでください。家族の推測を本人の意思にせず、根拠発話IDを必ず示してください。",
  "優先順位: (1)本人が語った経験・希望・価値観の自然な深掘り (2)回答困難への簡単な経験想起 (3)現在テーマと発言に関連する未探索の観点 (4)適切な質問がなければadvance_topic。3種類を順番に消化する意味ではありません。",
  "question_typeは主目的でexperience(現在・過去の経験の想起)、values(本人が語った内容の理由・意味)、perspective(現在テーマに関連する未探索の観点)の一つ。質問は一つの問いだけにしてください。",
  "スロットは補助情報です。selected_slot_idはcandidate_slotsのIDまたはnull。スロットなしでも実際の発言から自然な質問を作れます。対応しないIDを無理に割り当てないでください。",
  "source_typeはutterance/slot/both。utteranceは発言起点、slotは探索項目起点、bothは両方。utteranceではselected_slot_idをnull、slot/bothでは候補IDを設定してください。すべての質問に今回提供した参加者発話のevidence_utterance_idsを付け、現在テーマの発話を少なくとも1件含めてください。",
  "本人の明示的希望は家族の推測より優先します。家族の発言だけを本人の希望と断定しないでください。未発言の事実、経験、感情、価値観、将来状況、家族負担への配慮を補完せず、医療・介護の選択や確定した意思決定を迫らないでください。",
  "opening_question,previous_ai_questions,発話,スロット根拠を参照し、意味が同じ質問や十分回答されたことを言い換えて繰り返さないでください。『散歩のどこが好きか』と『散歩を楽しみにする理由』も同じ内容なら重複です。",
  "dialogue_guardsのblockedEvidence/blockedSlots、明示的な拒否・保留の話題は追及しないでください。isDeferredは本人の保留と同義ではありません。未検討・言語化困難は拒否ではなく、未支援の場合のみexperienceで現在・過去に戻る簡単な質問を1回許可します。そのときsupport_for_utterance_idにdifficultyのIDを指定してください。支援済みの観点は追及しないでください。",
  "反映transition_phraseは必要な場合だけ短く、明示された内容だけを使い、本人が言っていない感情や希望を補完しないでください。",
  "候補が残っていても適切な質問がなければadvance_topicを返してください。候補0件でも発言起点の質問を検討してください。テーマを自動変更・終了しないでください。",
  "next_actionの形式: {type:'ask_question'|'advance_topic',current_topic_id,selected_slot_id:string|null,question_type:'experience'|'values'|'perspective'|null,source_type:'utterance'|'slot'|'both'|null,evidence_utterance_ids:string[],support_for_utterance_id:string|null,transition_phrase:string,question:string|null,decision_reason:'question_generated'|'no_useful_question'|'no_eligible_candidate',model_reported_reason:string}。advance_topicではquestionとselected_slot_idをnullにしてください。model_reported_reasonはモデルが出力する短い理由であり完全な内部判断過程の説明ではありません。",
  "厳密なJSONオブジェクト{slot_updates:[],unmatchedUtteranceIds:[],next_action:{...}}のみを返してください。",
].join("\n");

const SYSTEM_FINAL_MINUTES_FROM_STRUCTURED = [
  "あなたは、ACP対話のslot、sub-slot、aspect、根拠発話から、医療・介護従事者が後から理解できる話し合い記録を作成するAIです。",
  "添付PDFと同じ考え方で、短い全体概要、テーマ別詳細、整理項目、根拠発言の構成を守ってください。",
  "目的は情報を減らすことではなく、得られた情報を意味に応じたsectionへ整理することです。",
  "【根拠】",
  "入力されたslot、sub-slot、aspectと根拠発話だけを使用し、入力にない事実、希望、理由、感情、人物関係、因果関係、医療判断を追加しないでください。",
  "各narrativeには、その本文を直接支える最小限のsourceUtteranceIdsを付けてください。themeに関連するだけの発話、質問だけの発話、他sectionだけを支える発話は含めないでください。",
  "根拠がなければ文章を作らず、fieldに応じてnullまたは空配列にしてください。",
  "not_decidedや未充足というslot状態だけから、未決定や不明を本文化してはいけません。本人の直接発話または本人確認済みのevidenceが必要です。",
  "本人自身の発話に直接支持されない介護者の解釈、一般的なACP価値、医療者の質問を、本人の考えとして扱わないでください。",
  "【文章化】",
  "発話を内部的に意味単位へ分け、矛盾しない内容を自然な第三者記録文として統合してください。",
  "narrative.textは発話の抜粋欄ではありません。発話原文のコピー、時系列での列挙、発話ごとの言い換え、「〜と話している」「〜と述べている」の反復を避けてください。",
  "同じ方向の複数発話は1つの意味まとまりに統合してください。発話間の関係が不明なら、因果関係を推測せずconfirmationNeededへ整理してください。",
  "具体的な生活行動、人間関係、理由、避けたいこと、条件、迷い、未決定、家族への配慮、支援や意思決定への考えを削除しないでください。",
  "「できれば」「今のところ」「家族が大丈夫なら」「体が動くうちは」などの条件や確信の強さを保ち、発話より断定的にしないでください。",
  "sub-slot名や分類名、または「本人はこのテーマについて考えを話している」のような抽象的説明を本文に書かず、確認できた具体的内容を書いてください。",
  "【overall_summary】",
  "overall_summaryは「今回の話し合いから見えてきたこと」に表示する入口の概要です。2〜4項目、各1〜2文程度にしてください。",
  "全sub-slot、条件、迷い、未決定、根拠発話、次回確認事項を詰め込まないでください。",
  "overall_summaryに含めた内容も、正式な記録である各theme sectionから削除しないでください。",
  "【テーマ別section】",
  "各テーマの情報をcurrentThought、background、conditions、uncertainties、tensions、confirmationNeededへ意味に応じて分けてください。すべてをcurrentThoughtへ集約しないでください。",
  "currentThought: 本人が現在大切にしていること、希望、優先事項、続けたいこと、避けたいこと、支援や意思決定について比較的明確に述べた考えです。主にcore sub-slotを用い、自然な記録文1〜3文に統合してください。引用・単純連結または根拠のない推論しか作れない場合はnullにしてください。",
  "background: 本人が直接語った理由、生活歴、経験、人間関係、地域とのつながり、感情、寂しさ、不安、負担感など、currentThoughtの背景です。根拠がなければnullにしてください。",
  "conditions: 「できる間」「状況による」「重い作業は難しい」「全部今まで通りでなくてもよい」「必要なら支援を受ける」など、明示された条件、限界、状況による変化です。",
  "uncertainties: 本人が明示した「まだ考えていない」「決めていない」「分からない」「その時にならないと分からない」などの意思形成状態です。欠損や未充足だけを理由に作らないでください。",
  "tensions: 本人の中に、異なる希望や懸念が併存していることを双方の発話から直接確認できる場合に限ります。同じ方向の関連希望や単一sub-slotのcompleteだけを理由に作らないでください。",
  "confirmationNeeded: 発言間または発言とslotの不一致、複数解釈、判断条件の不足、今回だけでは確定できない事項、相談相手と代理意思決定者の混在など、記録上の確認事項です。本人の心理的葛藤と混同しないでください。",
  "【統合例】",
  "庭の花を見る、世話をする、近所の人と話す、普段通り過ごしたいという同方向の発話は、日常生活を大切にしているというcurrentThoughtへ統合してください。長年の花栽培や近所づきあいはbackground、身体的に可能な間は自分で世話したいという内容はconditionsです。相反する懸念がなければtensionsには入れません。",
  "「家がいい」「家族と一緒がいい」だけから、家族の介護を受けて自宅で最期を迎えたいと解釈してはいけません。",
  "【追跡可能性】",
  "同じutteranceが複数sub-slotに関係しても根拠発言カードには1回だけ表示されます。本文ではsourceUtteranceIdsにより、各発話がどのsectionを支えるか追跡可能にしてください。",
  "すべてのnarrative fieldで、sourceUtteranceIdsには実際に文章化した意味を直接支える発話だけを含めてください。",
  "出力は指定されたJSON構造のみとし、JSON以外の文章を出力しないでください。",
  "",
  "Return exactly this top-level JSON shape. Do not add title, recordType, generatedAt, themes, themeId, or any other top-level key.",
  '{"overall_summary":{"core_values":[{"text":"...","sourceUtteranceIds":["..."],"sourceAspectIds":["..."]}],"cross_theme_connections":[{"text":"...","sourceUtteranceIds":["..."],"sourceAspectIds":["..."],"relatedThemes":["current_life_values","future_life_continuity"]}],"undecided_things":[{"text":"...","sourceUtteranceIds":["..."],"sourceAspectIds":["..."]}]},"narratives":{"current_life_values":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]},"future_life_continuity":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]},"selfhood":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]},"care_support":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]},"family_communication":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]},"proxy_decision_support":{"currentThought":null,"background":null,"conditions":[],"uncertainties":[],"tensions":[],"confirmationNeeded":[]}}}',
].join("\n");

const FINAL_MINUTES_THEME_IDS = [
  "current_life_values",
  "future_life_continuity",
  "selfhood",
  "care_support",
  "family_communication",
  "proxy_decision_support",
] as const;

const groundedTextSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "sourceUtteranceIds", "sourceAspectIds"],
  properties: {
    text: { type: "string" },
    sourceUtteranceIds: {
      type: "array",
      items: { type: "string" },
    },
    sourceAspectIds: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const groundedTextOrNullSchema = {
  anyOf: [groundedTextSchema, { type: "null" }],
} as const;

const narrativeSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currentThought",
    "background",
    "conditions",
    "uncertainties",
    "tensions",
    "confirmationNeeded",
  ],
  properties: {
    currentThought: groundedTextOrNullSchema,
    background: groundedTextOrNullSchema,
    conditions: { type: "array", items: groundedTextSchema },
    uncertainties: { type: "array", items: groundedTextSchema },
    tensions: { type: "array", items: groundedTextSchema },
    confirmationNeeded: { type: "array", items: groundedTextSchema },
  },
} as const;

const finalMinutesResponseFormat = {
  type: "json_schema",
  json_schema: {
    name: "final_minutes_narratives",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["overall_summary", "narratives"],
      properties: {
        overall_summary: {
          type: "object",
          additionalProperties: false,
          required: [
            "core_values",
            "cross_theme_connections",
            "undecided_things",
          ],
          properties: {
            core_values: { type: "array", items: groundedTextSchema },
            cross_theme_connections: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "text",
                  "sourceUtteranceIds",
                  "sourceAspectIds",
                  "relatedThemes",
                ],
                properties: {
                  text: { type: "string" },
                  sourceUtteranceIds: {
                    type: "array",
                    items: { type: "string" },
                  },
                  sourceAspectIds: {
                    type: "array",
                    items: { type: "string" },
                  },
                  relatedThemes: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: [...FINAL_MINUTES_THEME_IDS],
                    },
                  },
                },
              },
            },
            undecided_things: { type: "array", items: groundedTextSchema },
          },
        },
        narratives: {
          type: "object",
          additionalProperties: false,
          required: [...FINAL_MINUTES_THEME_IDS],
          properties: Object.fromEntries(
            FINAL_MINUTES_THEME_IDS.map((themeId) => [themeId, narrativeSchema]),
          ),
        },
      },
    },
  },
} as const;

const SYSTEM_SLOT_CONTROL_DEBUG = [
  "あなたはACP対話ログから、開発確認用にサブスロットの状態を意味判定するAIです。",
  "名称を変更せず、提供されたtopic_idとaspect_idだけを使用してください。",
  "語彙の一致ではなく本人発話の意味で分類し、価値観、希望、不安、拒否、保留を尊重して、無理にslotを埋めないでください。",
  "【根拠】",
  "本人発話を最優先してください。",
  "介護者の要約・解釈は、直後または近接する本人発話で明確な同意がある場合のみ、本人の意思として扱えます。",
  "その場合、evidence_utteranceを「介護者解釈に同意: 」で始め、介護者の要約と本人の同意を短く含めてください。",
  "本人の同意がない介護者だけの推測、代弁、解釈をansweredまたはpartially_answeredにしないでください。",
  "会話ログに根拠がない、または推測だけの場合はunansweredとしてください。",
  "unanswered以外にする場合は、本人発話、または介護者要約と本人同意の短い抜粋をevidence_utteranceに必ず入れてください。",
  "【状態判定】",
  "明確な「特にない」「該当しない」はnot_applicable、話したくない場合はdeclined、言語化できない場合はunable_to_verbalizeとしてください。",
  "関連発話はあるが根拠が弱い、または理由・条件・具体性が不足している場合はpartially_answeredとしてください。",
  "意味は該当するが、ACP上さらに確認すべき曖昧さがある場合はneeds_follow_upとしてください。",
  "十分に具体的な根拠がある場合だけansweredとしてください。",
  "出力は次の構造のJSONのみとしてください。",
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

type AiQuestionWithSlotUpdatesResult = {
  slot_updates?: SlotClassification[];
  unmatchedUtteranceIds?: string[];
  next_action?: {
    type?: "ask_question" | "advance_topic";
    current_topic_id?: string;
    selected_slot_id?: string | null;
    question_type?: "experience" | "values" | "perspective";
    source_type?: "utterance" | "slot" | "both";
    evidence_utterance_ids?: string[];
    support_for_utterance_id?: string | null;
    transition_phrase?: string | null;
    question?: string | null;
    decision_reason?: string;
    model_reported_reason?: string;
  };
  __requestMeta?: JsonRequestMeta;
};

type QuestionCandidate = {
  mainSlotId: string;
  subSlotId: string;
  label: string;
  description: string;
  completion: SlotCompletion;
  responseState: SlotClassificationResponseState;
  minutesReadiness: "insufficient" | "basic" | "rich";
  followUpNeed: "required" | "helpful" | "none";
  questionStage: "current_thought" | "background_reason" | "conditions_specificity";
  questionPurpose: QuestionPurpose;
  reasonForSelection: string;
  priority: string;
  priorityScore: number;
  relevanceScore: number;
};

type JsonRequestMeta = {
  source: "openai" | "fallback" | "error";
  llmSucceeded: boolean;
  failureReason?: "missing_api_key" | "api_error" | "parse_error";
  errorMessage?: string;
  rawResponse?: string;
};

class AiQuestionValidationError extends Error {
  constructor(
    public readonly reason: string,
    message = reason,
  ) {
    super(message);
    this.name = "AiQuestionValidationError";
  }
}

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
      | "invalid_evidence_topic"
      | "progress_only_evidence"
      | "non_elder_evidence"
      | "invalid_transition";
    };

type SlotStateBundle = {
  slotStates: AcpSlotState[];
  subSlotStates: StoredSubSlotState[];
  debug: {
    classifiedUtteranceIds: string[];
    skippedClassification: boolean;
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
      fallbackUsed: boolean;
      fallbackSucceeded: boolean;
      resultSource: "llm" | "fallback";
      processingSucceeded: boolean;
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
  const utterancesToClassify = (
    context.utterancesToClassify ?? context.utterances
  ).filter((utterance) => utterance.id);

  if (utterancesToClassify.length === 0) {
    return {
      slotStates: fallbackSlotStates,
      subSlotStates: fallbackSubSlotStates,
      debug: {
        classifiedUtteranceIds: [],
        skippedClassification: true,
        candidates: [],
        accepted: [],
        rejected: [],
        unmatchedUtteranceIds: [],
        summary: createSlotClassificationDebugSummary([], [], [], {
          source: "fallback",
          llmSucceeded: false,
          fallbackUsed: true,
          fallbackSucceeded: true,
          resultSource: "fallback",
          processingSucceeded: true,
          unmatchedUtteranceCount: 0,
        }),
      },
    };
  }

  const result = await requestJson<SlotClassificationResult>(
    SYSTEM_CLASSIFY_SLOT_UTTERANCES,
    buildSlotClassificationPayload(
      {
        ...context,
        utterances: utterancesToClassify,
      },
      fallbackSubSlotStates,
    ),
    { classifications: [], unmatchedUtteranceIds: [] },
  );
  const applied = applySlotClassifications({
    result,
    utterances: utterancesToClassify,
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
    debug: {
      ...applied.debug,
      classifiedUtteranceIds: [...new Set([
        ...applied.debug.accepted.flatMap((item) => normalizeEvidenceIds(item.evidenceUtteranceIds)),
        ...normalizeEvidenceIds(result.unmatchedUtteranceIds).filter((id) => utterancesToClassify.some((item) => item.id === id)),
      ])].filter((id) => !applied.debug.rejected.some((item) => item.utteranceIds.includes(id))),
      skippedClassification: false,
    },
  };
}

export async function updateSlotsAndGenerateNextQuestionAction(context: ConversationContext) {
  const subSlotStates = context.subSlotStates?.length ? context.subSlotStates : createEmptySubSlotStates();
  const topic = resolveDiscussionTopic(context.currentTopic);
  const pending = (context.utterancesToClassify ?? []).filter((item) => item.id);
  const slotStates = deriveMainSlotStatesFromSubSlots(context.slotStates, subSlotStates, context.utterances);
  const current = { ...context, slotStates, subSlotStates };
  // The legacy full-pool decision determines the existing 2/3 limit, before shortlisting.
  const limitDecision = getNextQuestionCandidateDecision(current);
  const guards = buildDialogueGuards(context.utterances, context.aiQuestionHistory ?? [], topic.id, subSlotStates);
  const candidates = selectQuestionCandidates(current, guards);
  const policy: QuestionPolicyMetadata = {
    question_type: null, decision: "advance_topic", decision_reason: "question_limit_reached",
    source_type: null, candidate_slot_ids: candidates.map((item) => ({ topic_id: topic.id, slot_id: item.subSlotId })),
    selected_slot_id: null, evidence_utterance_ids: [], model_reported_reason: null,
    policy_version: QUESTION_POLICY_VERSION, llm_call_count: 0, result_source: "server",
    question_count: limitDecision.questionCount, question_limit: limitDecision.limit,
    support_for_utterance_id: null, support_key: null, validation_failures: [],
  };
  const early = (reason: "no_topic_utterances" | "question_limit_reached") => {
    policy.decision_reason = reason;
    policy.decision = reason === "no_topic_utterances" ? "opening_question" : "advance_topic";
    policy.result_source = reason === "no_topic_utterances" ? "fixed_fallback" : "server";
    const nextQuestion: NextQuestionResult = {
      ...noRelevantFollowUpResult(topic.slot_name, reason), policy,
      no_relevant_followup: reason !== "no_topic_utterances",
    };
    const debug = applySlotClassifications({ result: { classifications: [], unmatchedUtteranceIds: [] }, utterances: [], currentStates: subSlotStates, currentTopic: topic.id }).debug;
    return { slotStates, subSlotStates, debug: { ...debug, summary: { ...debug.summary, processingSucceeded: true, fallbackUsed: policy.result_source === "fixed_fallback", fallbackSucceeded: policy.result_source === "fixed_fallback" }, classifiedUtteranceIds: [], skippedClassification: true }, nextQuestion,
      nextActionDebug: { llmActionType: null, llmTargetSubSlotId: null, acceptedActionType: policy.decision === "opening_question" ? "opening_question" as const : "advance_topic" as const, reason } };
  };
  if (!currentParticipantUtterances(context.utterances, topic.id).length) return early("no_topic_utterances");
  if (limitDecision.limitReached) return early("question_limit_reached");

  const payload = buildAiQuestionWithSlotUpdatesPayload(current, subSlotStates, slotStates, candidates);
  let lastFailure = "invalid_result";
  for (let attempt = 1; attempt <= AI_QUESTION_LLM_MAX_ATTEMPTS; attempt += 1) {
    const result = await requestJson<AiQuestionWithSlotUpdatesResult>(SYSTEM_AI_QUESTION_WITH_SLOT_UPDATES,
      { ...payload, ...(attempt > 1 ? { retry_after_validation_failure: { reason: lastFailure, instruction: "Correct the invalid fields. A grounded slotless question or advance_topic is allowed; never force a question." } } : {}) },
      {}, { type: "json_object" }, { disableRetries: true, onCall: () => { policy.llm_call_count += 1; } });
    try {
      if (!result.__requestMeta?.llmSucceeded) throw new AiQuestionValidationError(result.__requestMeta?.failureReason ?? "llm_failed");
      if (!Array.isArray(result.slot_updates) || !Array.isArray(result.unmatchedUtteranceIds)) throw new AiQuestionValidationError("invalid_classification_shape");
      const applied = applySlotClassifications({ result: { classifications: result.slot_updates, unmatchedUtteranceIds: result.unmatchedUtteranceIds, __requestMeta: result.__requestMeta }, utterances: pending, currentStates: subSlotStates, currentTopic: topic.id, sessionId: context.sessionId });
      const updatedSlots = deriveMainSlotStatesFromSubSlots(slotStates, applied.subSlotStates, context.utterances);
      const nextQuestion = normalizeCombinedNextQuestionAction({ result, context: { ...current, slotStates: updatedSlots, subSlotStates: applied.subSlotStates }, currentTopic: topic, candidates, policy, guards: buildDialogueGuards(context.utterances, context.aiQuestionHistory ?? [], topic.id, applied.subSlotStates), payload });
      const pendingIds = new Set(pending.map((item) => item.id));
      const rejectedIds = new Set(applied.debug.rejected.flatMap((item) => item.utteranceIds));
      const classifiedIds = [...new Set([
        ...applied.debug.accepted.flatMap((item) => normalizeEvidenceIds(item.evidenceUtteranceIds)),
        ...result.unmatchedUtteranceIds.filter((id) => typeof id === "string" && pendingIds.has(id)),
      ])].filter((id) => !rejectedIds.has(id));
      return { slotStates: updatedSlots, subSlotStates: applied.subSlotStates,
        debug: { ...applied.debug, classifiedUtteranceIds: classifiedIds, skippedClassification: pending.length === 0 }, nextQuestion,
        nextActionDebug: { llmActionType: result.next_action?.type ?? null, llmTargetSubSlotId: result.next_action?.selected_slot_id ?? null,
          acceptedActionType: nextQuestion.no_relevant_followup ? "advance_topic" as const : "ask_question" as const, reason: nextQuestion.reason } };
    } catch (error) {
      lastFailure = error instanceof AiQuestionValidationError ? error.reason : "invalid_result";
      policy.validation_failures.push(lastFailure);
      if (lastFailure === "missing_api_key") break;
    }
  }
  // Technical failures stay errors. Do not manufacture an unvalidated question or a no-useful-question decision.
  throw new QuestionGenerationError(lastFailure, { ...policy, decision: "error", decision_reason: "technical_error", result_source: "server" });
}

function selectQuestionCandidates(context: ConversationContext, guards: ReturnType<typeof buildDialogueGuards>) {
  const topic = resolveDiscussionTopic(context.currentTopic);
  const control = buildSlotControlDebugState({ slots: context.slotStates, currentTopic: topic.id, subSlotStates: context.subSlotStates });
  return buildRelevantAskableSubSlotsForQuestionPayload(control, context.subSlotStates ?? [], context.utterances)
    .filter((candidate) => !guards.blockedSlots.includes(candidate.subSlotId))
    .map((candidate) => {
      const state = context.subSlotStates?.find((item) => item.mainSlotId === topic.id && item.subSlotId === candidate.subSlotId);
      const evidence = (state?.evidenceUtteranceIds ?? []).filter((id) => !guards.blockedEvidence.includes(id));
      return { candidate, connected: evidence.length > 0 || candidate.relevanceScore >= 2,
        score: evidence.length * 10 + candidate.relevanceScore + (candidate.responseState === "ambiguous" ? 3 : 0) - scoreQuestionHistoryPenalty(candidate, context.aiQuestionHistory ?? []) };
    })
    .filter((item) => item.connected && item.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.subSlotId.localeCompare(b.candidate.subSlotId, "en"))
    .slice(0, 2).map((item) => item.candidate);
}

function buildSlotClassificationPayload(
  context: ConversationContext,
  subSlotStates: StoredSubSlotState[],
) {
  const currentTopic = resolveDiscussionTopic(context.currentTopic);
  const topicsForClassification = [currentTopic];
  const topicSubSlotStates = subSlotStates.filter(
    (state) => state.mainSlotId === currentTopic.id,
  );

  return {
    session: getSessionMetadata(context),
    currentTopic,
    currentSubSlotStates: topicSubSlotStates.map((state) => ({
      mainSlotId: state.mainSlotId,
      subSlotId: state.subSlotId,
      completion: state.completion,
      responseState: state.responseState,
      reasonCode: state.reasonCode,
      evidenceUtteranceIds: state.evidenceUtteranceIds,
      depth: state.depth,
      canAskAgain: state.canAskAgain,
      isDeferred: state.isDeferred,
    })),
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
        start_ms: utterance.start_ms ?? null,
        end_ms: utterance.end_ms ?? null,
        created_at: utterance.created_at ?? utterance.createdAt ?? null,
      })),
    maxClassificationsPerUtterance: 8,
  };
}

function buildAiQuestionWithSlotUpdatesPayload(
  context: ConversationContext,
  subSlotStates: StoredSubSlotState[],
  slotStates: AcpSlotState[],
  candidates: QuestionCandidate[],
) {
  const currentTopic = resolveDiscussionTopic(context.currentTopic);
  const topicSubSlotStates = subSlotStates.filter(
    (state) => state.mainSlotId === currentTopic.id,
  );
  const slotControl = buildSlotControlDebugState({
    slots: slotStates,
    currentTopic: currentTopic.slot_name,
    subSlotStates,
  });


  return {
    session: getSessionMetadata(context),
    opening_question: currentTopic.openingQuestion,
    dialogue_guards: buildDialogueGuards(context.utterances, context.aiQuestionHistory ?? [], currentTopic.id, subSlotStates),
    evidence_memory: buildSlotBackedQuestionMemory(currentTopic.id, subSlotStates, context.utterances),
    current_topic: {
      id: currentTopic.id,
      slot_name: currentTopic.slot_name,
      title: currentTopic.title,
    },
    sub_slot_definitions: getSubSlotDefinitions()
      .filter((definition) => definition.mainSlotId === currentTopic.id)
      .map((definition) => ({
        id: definition.id,
        label: definition.label,
        description: definition.description,
        completeCriteria: definition.completeCriteria,
        partialCriteria: definition.partialCriteria,
        exclusionCriteria: definition.exclusionCriteria,
        completionRule: definition.completionRule,
      })),
    current_sub_slot_states: topicSubSlotStates.map((state) => ({
      mainSlotId: state.mainSlotId,
      subSlotId: state.subSlotId,
      completion: state.completion,
      responseState: state.responseState,
      reasonCode: state.reasonCode,
      evidenceUtteranceIds: state.evidenceUtteranceIds,
      depth: state.depth,
      canAskAgain: state.canAskAgain,
      isDeferred: state.isDeferred,
    })),
    unprocessed_utterances: (context.utterancesToClassify ?? [])
      .filter((utterance) => utterance.id)
      .map(toQuestionUtterancePayload),
    current_topic_context: currentParticipantUtterances(context.utterances, currentTopic.id).slice(-16).map(toQuestionUtterancePayload),
    recent_context: recentUtterances(
      context.utterances,
      NEXT_QUESTION_RECENT_UTTERANCE_COUNT,
    ).map(toQuestionUtterancePayload),
    previous_ai_questions: (context.aiQuestionHistory ?? [])
      .slice(-NEXT_QUESTION_ALREADY_ASKED_COUNT),
    candidate_slots: candidates.map((slot) => ({
      mainSlotId: slot.mainSlotId,
      subSlotId: slot.subSlotId,
      label: slot.label,
      description: slot.description,
      completion: slot.completion,
      responseState: slot.responseState,
      minutesReadiness: slot.minutesReadiness,
      followUpNeed: slot.followUpNeed,
      questionPurpose: slot.questionPurpose,
      reasonForSelection: slot.reasonForSelection,
    })),
    rules: {
      slot_updates_evidence_source: "unprocessed_utterances_only",
      recent_context_is_not_evidence: true,
      next_action_types: ["ask_question", "advance_topic"],
      max_question_count: 1,
      avoid_repeated_questions: true,
      elder_voice_priority: true,
    },
  };
}

function normalizeCombinedNextQuestionAction(input: {
  result: AiQuestionWithSlotUpdatesResult; context: ConversationContext;
  currentTopic: (typeof DISCUSSION_TOPICS)[number]; candidates: QuestionCandidate[];
  policy: QuestionPolicyMetadata; guards: ReturnType<typeof buildDialogueGuards>;
  payload: ReturnType<typeof buildAiQuestionWithSlotUpdatesPayload>;
}): NextQuestionResult {
  const { result, context, currentTopic: topic, candidates, guards } = input;
  const action = result.next_action;
  if (!action || action.current_topic_id !== topic.id) throw new AiQuestionValidationError("invalid_current_topic");
  if (typeof action.model_reported_reason !== "string" || !action.model_reported_reason.trim()) throw new AiQuestionValidationError("missing_model_reported_reason");
  const policy = { ...input.policy, result_source: "llm" as const, model_reported_reason: action.model_reported_reason.trim() };
  if (action.type === "advance_topic") {
    if (action.question != null || action.selected_slot_id != null) throw new AiQuestionValidationError("invalid_advance_question");
    if (!["no_useful_question", "no_eligible_candidate"].includes(action.decision_reason ?? "")) throw new AiQuestionValidationError("invalid_advance_reason");
    if (action.decision_reason === "no_eligible_candidate" && candidates.length) throw new AiQuestionValidationError("candidates_exist");
    policy.decision = "advance_topic";
    policy.decision_reason = action.decision_reason as "no_useful_question" | "no_eligible_candidate";
    return { ...noRelevantFollowUpResult(topic.slot_name, policy.decision_reason), policy };
  }
  if (action.type !== "ask_question") throw new AiQuestionValidationError("invalid_action_type");
  if (!["experience", "values", "perspective"].includes(action.question_type ?? "")) throw new AiQuestionValidationError("invalid_question_type");
  if (!["utterance", "slot", "both"].includes(action.source_type ?? "")) throw new AiQuestionValidationError("invalid_source_type");
  const question = typeof action.question === "string" ? action.question.trim() : "";
  if (!question || looksLikeMultipleQuestions(question)) throw new AiQuestionValidationError("invalid_question_text");
  if (repeatsQuestion(question, [topic.openingQuestion, ...(context.aiQuestionHistory ?? []).map((item) => item.content)]) || isRepeatedQuestion(context.utterances, question, topic.slot_name)) throw new AiQuestionValidationError("repeated_question");
  if (input.policy.question_count >= input.policy.question_limit) throw new AiQuestionValidationError("question_limit_reached");
  const selected = action.selected_slot_id;
  if (selected !== null && typeof selected !== "string") throw new AiQuestionValidationError("invalid_selected_slot");
  const candidate = candidates.find((item) => item.subSlotId === selected);
  if (selected !== null && !candidate) throw new AiQuestionValidationError("slot_outside_candidates");
  if ((selected === null && action.source_type !== "utterance") || (selected !== null && action.source_type === "utterance")) throw new AiQuestionValidationError("source_slot_mismatch");
  if (selected) {
    const state = context.subSlotStates?.find((item) => item.mainSlotId === topic.id && item.subSlotId === selected);
    if (state && !canAskAgainSubSlotState(state)) throw new AiQuestionValidationError("slot_no_longer_eligible");
    if (guards.blockedSlots.includes(selected)) throw new AiQuestionValidationError("protected_slot");
  }
  const evidence = action.evidence_utterance_ids;
  if (!Array.isArray(evidence) || !evidence.length || evidence.some((id) => typeof id !== "string")) throw new AiQuestionValidationError("missing_question_evidence");
  const suppliedIds = new Set([
    ...input.payload.unprocessed_utterances, ...input.payload.recent_context, ...input.payload.current_topic_context,
    ...input.payload.evidence_memory.flatMap((item) => item.evidenceUtterances),
  ].map((item) => item.id));
  const byId = new Map(context.utterances.map((item) => [item.id, item]));
  if (evidence.some((id) => !suppliedIds.has(id) || !byId.has(id) || !participantSpeaker(byId.get(id)!.original_speaker ?? byId.get(id)!.speaker))) throw new AiQuestionValidationError("invalid_question_evidence");
  if (!evidence.some((id) => byId.get(id)?.topic_id === topic.id)) throw new AiQuestionValidationError("missing_current_topic_evidence");
  if (evidence.some((id) => guards.blockedEvidence.includes(id) || ["declined", "held"].includes(responseBarrier(byId.get(id)!.text) ?? ""))) throw new AiQuestionValidationError("protected_evidence");
  const repeatedSubject = (context.aiQuestionHistory ?? []).some((item) =>
    item.questionType === action.question_type && (item.targetSubSlotId ?? null) === selected &&
    (item.evidenceUtteranceIds ?? []).some((id) => evidence.includes(id)));
  if (repeatedSubject) throw new AiQuestionValidationError("repeated_question_subject");
  const supportId = action.support_for_utterance_id ?? null;
  const difficulty = guards.difficulties.find((item) => item.utteranceId === supportId);
  if (supportId && (!difficulty || difficulty.supported || action.question_type !== "experience" || !evidence.includes(supportId))) throw new AiQuestionValidationError("invalid_difficulty_support");
  if (guards.difficulties.some((item) => evidence.includes(item.utteranceId) && (item.supported || supportId !== item.utteranceId))) throw new AiQuestionValidationError("difficulty_requires_single_support");
  // Saved terminal responses also constrain slotless questions; never bypass them by omitting a slot ID.
  for (const state of context.subSlotStates ?? []) {
    if (state.mainSlotId !== topic.id || !isTerminalValidResponseState(state.responseState)) continue;
    if (!state.evidenceUtteranceIds.some((id) => evidence.includes(id))) continue;
    if (state.responseState === "declined" || state.responseState === "explicit_none" || !difficulty || !state.evidenceUtteranceIds.includes(difficulty.utteranceId)) throw new AiQuestionValidationError("terminal_response_evidence");
  }
  policy.question_type = action.question_type!;
  policy.source_type = action.source_type!;
  policy.decision = "next_question";
  policy.decision_reason = "question_generated";
  policy.selected_slot_id = selected ? { topic_id: topic.id, slot_id: selected } : null;
  policy.evidence_utterance_ids = [...new Set(evidence)];
  policy.support_for_utterance_id = supportId;
  policy.support_key = difficulty?.key ?? null;
  return { question, transition_phrase: normalizeQuestionTransitionPhrase(action.transition_phrase), target_slot: topic.slot_name,
    targetMainSlotId: topic.id, ...(selected ? { targetSubSlotId: selected } : {}),
    questionPurpose: candidate?.questionPurpose, reasonForSelection: candidate?.reasonForSelection,
    reason: "question_generated", sensitivity: getSlotSensitivity(topic.slot_name), no_relevant_followup: false, policy };
}

function looksLikeMultipleQuestions(question: string) {
  const questionMarks = question.match(/[?？]/g)?.length ?? 0;
  if (questionMarks > 1) return true;

  return /、.*(?:ですか|でしょうか).*(?:ですか|でしょうか)/.test(question);
}

function normalizeQuestionTransitionPhrase(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (/[?？]/.test(text)) return "";

  const compact = text.replace(/\s+/g, " ");
  const limited = Array.from(compact).slice(0, 120).join("");
  if (/[。.!！]$/.test(limited)) return limited;

  return `${limited}。`;
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
      currentTopicId,
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
      classifiedUtteranceIds: [...utteranceIds],
      skippedClassification: false,
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
    fallbackUsed?: boolean;
    fallbackSucceeded?: boolean;
    resultSource?: "llm" | "fallback";
    processingSucceeded?: boolean;
    unmatchedUtteranceCount?: number;
  } = {},
) {
  const rejectionReasons = rejected.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.reason] = (accumulator[item.reason] ?? 0) + 1;
    return accumulator;
  }, {});

  const llmSucceeded = meta.llmSucceeded === true;
  const fallbackUsed = meta.fallbackUsed ?? meta.source === "fallback";
  const fallbackSucceeded = meta.fallbackSucceeded === true;

  return {
    source: meta.source ?? "fallback",
    llmSucceeded,
    fallbackUsed,
    fallbackSucceeded,
    resultSource: meta.resultSource ?? (llmSucceeded ? "llm" : "fallback"),
    processingSucceeded:
      meta.processingSucceeded ?? (llmSucceeded || fallbackSucceeded),
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

function markQuestionProcessingSucceeded(
  summary: SlotStateBundle["debug"]["summary"],
  result: {
    resultSource: "llm" | "fallback";
    fallbackUsed: boolean;
    fallbackSucceeded: boolean;
  },
): SlotStateBundle["debug"]["summary"] {
  return {
    ...summary,
    resultSource: result.resultSource,
    fallbackUsed: result.fallbackUsed,
    fallbackSucceeded: result.fallbackSucceeded,
    processingSucceeded: true,
  };
}

function validateSlotClassificationCandidate(
  candidate: SlotClassification,
  evidenceIds: string[],
  utteranceIds: Set<string>,
  utterances: ConversationUtterance[],
  currentTopicId: string,
): SlotCandidateValidationResult {
  const mainSlotId = typeof candidate.mainSlotId === "string" ? candidate.mainSlotId : "";
  const subSlotId = typeof candidate.subSlotId === "string" ? candidate.subSlotId : "";
  const knownMainSlot = DISCUSSION_TOPICS.some((topic) => topic.id === mainSlotId);

  if (!knownMainSlot) return { accepted: false, reason: "unknown_main_slot" };
  if (mainSlotId !== currentTopicId) {
    return { accepted: false, reason: "invalid_evidence_topic" };
  }
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
  if (!evidenceIdsMatchTopic(evidenceIds, utterances, mainSlotId)) {
    return { accepted: false, reason: "invalid_evidence_topic" };
  }
  if (
    candidate.evidenceType !== "caregiver_report_with_elder_confirmation" &&
    evidenceIdsAreOnlyProgressUtterances(evidenceIds, utterances)
  ) {
    return { accepted: false, reason: "progress_only_evidence" };
  }
  if (candidate.evidenceType === "caregiver_report_only") {
    return { accepted: false, reason: "non_elder_evidence" };
  }
  if (!evidenceIdsHaveValidSpeakerConsent(evidenceIds, utterances)) {
    return { accepted: false, reason: "non_elder_evidence" };
  }

  return { accepted: true };
}

function evidenceIdsMatchTopic(
  evidenceIds: string[],
  utterances: ConversationUtterance[],
  topicId: string,
) {
  const byId = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );

  return evidenceIds.every((id) => {
    const utterance = byId.get(id);
    return Boolean(utterance) && utterance?.topic_id === topicId;
  });
}

function evidenceIdsAreOnlyProgressUtterances(
  evidenceIds: string[],
  utterances: ConversationUtterance[],
) {
  if (evidenceIds.length === 0) return false;

  const byId = new Map(
    utterances
      .filter((utterance) => utterance.id)
      .map((utterance) => [utterance.id as string, utterance]),
  );
  const evidenceUtterances = evidenceIds
    .map((id) => byId.get(id))
    .filter((utterance): utterance is ConversationUtterance => Boolean(utterance));

  return (
    evidenceUtterances.length > 0 &&
    evidenceUtterances.every((utterance) =>
      isProgressOnlyUtterance(utterance.text),
    )
  );
}

function isProgressOnlyUtterance(text: string) {
  const normalized = text
    .trim()
    .replace(/[、。,.!！?？「」『』（）()\s]/g, "")
    .toLowerCase();

  return (
    normalized === "はい" ||
    normalized === "うん" ||
    normalized === "ん" ||
    normalized === "そうです" ||
    normalized === "わかりました" ||
    normalized === "分かりました" ||
    normalized === "次に行きましょう" ||
    normalized === "じゃあ次へ" ||
    normalized === "次の話題へですね"
  );
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
  if (shouldPreserveCurrentSubSlotState(current, next)) {
    return mergePreservedSubSlotState(current, next);
  }

  const mergedEvidenceIds = mergeEvidenceIds(
    current.evidenceUtteranceIds,
    next.evidenceUtteranceIds,
  );
  if (current.completion === "complete" && next.completion !== "complete") {
    return {
      ...current,
      evidenceUtteranceIds: mergedEvidenceIds,
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
    evidenceUtteranceIds: mergedEvidenceIds,
  };
}

function shouldPreserveCurrentSubSlotState(
  current: StoredSubSlotState,
  next: StoredSubSlotState,
) {
  if (completionRank(next.completion) < completionRank(current.completion)) {
    return true;
  }
  if (
    current.responseState === "answered" &&
    next.responseState !== "answered" &&
    next.responseState !== "ambiguous" &&
    next.responseState !== "conflicting"
  ) {
    return true;
  }

  return false;
}

function mergePreservedSubSlotState(
  current: StoredSubSlotState,
  next: StoredSubSlotState,
): StoredSubSlotState {
  const hasConflict =
    current.hasConflict === true || next.responseState === "conflicting";

  return {
    ...current,
    evidenceUtteranceIds: mergeEvidenceIds(
      current.evidenceUtteranceIds,
      next.evidenceUtteranceIds,
    ),
    hasConflict,
    needsOptionalFollowUp:
      current.needsOptionalFollowUp === true ||
      next.responseState === "conflicting",
    updatedAt: hasConflict ? next.updatedAt : current.updatedAt,
  };
}

function completionRank(completion: SlotCompletion) {
  if (completion === "complete") return 2;
  if (completion === "partial") return 1;
  return 0;
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
    const strongest = getMainSlotStatusFromSubSlots(topic, topicStates);
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
  topic: (typeof DISCUSSION_TOPICS)[number],
  states: StoredSubSlotState[],
): AcpSlotState["status"] {
  const topicSubSlotIds = new Set(topic.aspects.map((aspect) => aspect.id));
  const topicStates = states.filter((state) => topicSubSlotIds.has(state.subSlotId));
  const meaningfulStates = topicStates.filter(
    (state) =>
      state.evidenceUtteranceIds.length > 0 &&
      (state.completion !== "none" || state.responseState !== "no_response"),
  );
  const askableIncompleteStates = topicStates.filter(isAskableIncompleteSubSlotState);

  if (askableIncompleteStates.length > 0) {
    return meaningfulStates.length > 0 ? "partial" : "unanswered";
  }

  if (meaningfulStates.length === 0) {
    return "unanswered";
  }

  if (
    meaningfulStates.every((state) => state.responseState === "declined")
  ) {
    return "prefer_not_to_answer";
  }
  if (
    meaningfulStates.every((state) => state.responseState === "explicit_none")
  ) {
    return "no_preference";
  }
  if (
    meaningfulStates.every((state) => state.responseState === "unable_to_verbalize")
  ) {
    return "cannot_verbalize";
  }
  if (
    meaningfulStates.every((state) => state.responseState === "not_considered")
  ) {
    return "not_considered";
  }

  if (
    meaningfulStates.some(
      (state) =>
        state.completion === "complete" ||
        state.responseState === "answered" ||
        isTerminalValidResponseState(state.responseState),
    )
  ) {
    return "answered";
  }

  return "unanswered";
}

function isAskableIncompleteSubSlotState(state: StoredSubSlotState) {
  if (state.completion === "complete") return false;
  if (state.canAskAgain === false) return false;
  if (isTerminalValidResponseState(state.responseState)) return false;

  return (
    state.responseState === "no_response" ||
    state.responseState === "answered" ||
    state.responseState === "ambiguous" ||
    state.responseState === "conflicting"
  );
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
    finalMinutesResponseFormat,
    {
      model: getMinutesOpenAIModel(),
      timeoutMs: Number(process.env.FINAL_MINUTES_OPENAI_TIMEOUT_MS || 90000),
    },
  );
  const requestMeta = result.__requestMeta ?? {
    source: "fallback",
    llmSucceeded: false,
  };
  const llmMatchedSchema = hasFinalMinutesResponseSchema(result);
  const validatedMinutes =
    requestMeta.source === "openai" && llmMatchedSchema
      ? validateACPMinutes({
          ...baseMinutes,
          overall_summary: result.overall_summary,
          narratives: result.narratives,
        }, fallback.json.acp_minutes_llm_input) ?? baseMinutes
      : baseMinutes;
  const narrativeStatus = getNarrativeGenerationStatus(requestMeta, llmMatchedSchema);
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
  llmMatchedSchema: boolean,
): NarrativeGenerationStatus {
  if (meta.source === "openai" && llmMatchedSchema) return "success";
  if (meta.failureReason === "parse_error") return "parse_error";
  if (meta.failureReason === "api_error" || meta.failureReason === "missing_api_key") {
    return "api_error";
  }
  if (meta.source === "openai" && !llmMatchedSchema) return "no_supported_content";
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
    schemaSucceeded: hasFinalMinutesResponseSchema(input.rawResponse),
    fallbackUsed: input.fallbackUsed,
    failureReason: input.requestMeta.failureReason,
    errorMessage: input.requestMeta.errorMessage,
    rawResponse: input.requestMeta.rawResponse,
    parsedResponse: parsedRawResponse,
    normalizedNarratives: input.normalizedMinutes?.narratives ?? null,
    themeChecks: themes.map((theme) => ({
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

function hasFinalMinutesResponseSchema(value: {
  overall_summary?: unknown;
  narratives?: unknown;
}) {
  return hasOverallSummaryObject(value.overall_summary) &&
    hasNarrativeObject(value.narratives);
}

function hasOverallSummaryObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  return (
    Array.isArray(record.core_values) &&
    Array.isArray(record.cross_theme_connections) &&
    Array.isArray(record.undecided_things)
  );
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
  options: { model?: string; throwOnFailure?: boolean; timeoutMs?: number; disableRetries?: boolean; onCall?: () => void } = {},
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
    const openai = options.timeoutMs || options.disableRetries
      ? createOpenAIClient({ apiKey, timeout: options.timeoutMs ?? getDefaultOpenAITimeoutMs(), ...(options.disableRetries ? { maxRetries: 0 } : {}) })
      : getClient(apiKey);
    options.onCall?.();
    const completion = await openai.chat.completions.create({
      model: options.model ?? getDialogueOpenAIModel(),
      messages: [
        { role: "system", content: `${COMMON_AI_POLICY}\n\n${systemPrompt}` },
        { role: "user", content: buildAnonymizedAIUserContent(payload) },
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

function logAiQuestionStage(stage: string, details: Record<string, unknown>) {
  const error = details.error;
  const normalizedError =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : error;

  console.info(
    `[ai question generation stage] ${JSON.stringify({
      ...details,
      stage,
      error: normalizedError,
      occurredAt: new Date().toISOString(),
    })}`,
  );
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
    client = createOpenAIClient({
      apiKey,
      timeout: getDefaultOpenAITimeoutMs(),
    });
  }

  return client;
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

function buildAskableSubSlotsForQuestionPayload(
  debugState: SlotControlDebugState,
  subSlotStates: StoredSubSlotState[],
) {
  const currentMainSlot = debugState.mainSlots.find((slot) => slot.isCurrentTopic);
  if (!currentMainSlot) return [];

  return currentMainSlot.subSlots
    .filter((slot) => {
      if (!slot.canAskAgain) return false;
      const stored = subSlotStates.find(
        (state) =>
          state.mainSlotId === currentMainSlot.topicId &&
          state.subSlotId === slot.id,
      );
      if (stored?.completion === "complete") return false;
      if (stored && isTerminalValidResponseState(stored.responseState)) return false;

      return true;
    })
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
        minutesReadiness: slot.minutesReadiness,
        followUpNeed: slot.followUpNeed,
        questionStage: slot.questionStage,
      };
    });
}

function buildRelevantAskableSubSlotsForQuestionPayload(
  debugState: SlotControlDebugState,
  subSlotStates: StoredSubSlotState[],
  utterances: ConversationUtterance[],
) : QuestionCandidate[] {
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
      if (stored?.completion === "complete") return null;
      if (stored && isTerminalValidResponseState(stored.responseState)) return null;
      if (slot.followUpNeed === "none" || slot.canAskAgain === false) return null;
      if (stored?.isDeferred && slot.followUpNeed !== "required") return null;

      const questionPurpose = getQuestionPurposeForSubSlot(slot, stored);

      const score = scoreSubSlotRelevance({
        id: slot.id,
        label: slot.label,
        latestText: latestElderText,
        recentText,
      });
      const threshold = latestIsUncertain ? 3 : 2;
      if (score < threshold && slot.followUpNeed !== "required") return null;

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
          minutesReadiness: slot.minutesReadiness,
          followUpNeed: slot.followUpNeed,
          questionStage: slot.questionStage,
        }),
        priority: slot.priority,
        relevanceScore: score,
        questionPurpose,
        reasonForSelection: buildQuestionCandidateReason(slot, questionPurpose),
        priorityScore: scoreQuestionCandidatePriority({
          priority: slot.priority,
          completion: stored?.completion ?? "none",
          responseState: stored?.responseState ?? "no_response",
          minutesReadiness: slot.minutesReadiness,
          questionStage: slot.questionStage,
        }),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const leftScore = left.priorityScore + left.relevanceScore;
      const rightScore = right.priorityScore + right.relevanceScore;

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return priorityRank(left.priority) - priorityRank(right.priority);
    });

  const required = scored.filter((item) => item.followUpNeed === "required");
  const helpful = scored.filter((item) => item.followUpNeed === "helpful");

  return [...required, ...helpful];
}

function getNextQuestionCandidateDecision(context: ConversationContext) {
  const currentTopic = resolveTopic(context.currentTopic);
  const slotControl = buildSlotControlDebugState({
    slots: filterAcpSlotStates(context.slotStates),
    currentTopic: currentTopic.slot_name,
    subSlotStates: context.subSlotStates,
  });
  const candidates = buildRelevantAskableSubSlotsForQuestionPayload(
    slotControl,
    context.subSlotStates ?? [],
    context.utterances,
  );
  const history = filterQuestionHistoryForTopic(
    context.aiQuestionHistory ?? [],
    currentTopic.id,
    currentTopic.slot_name,
  );
  const hasInsufficientCoreThought = candidates.some(
    (candidate) =>
      candidate.followUpNeed === "required" &&
      candidate.questionStage === "current_thought",
  );
  const limit = hasInsufficientCoreThought
    ? INSUFFICIENT_TOPIC_AI_QUESTION_LIMIT
    : DEFAULT_TOPIC_AI_QUESTION_LIMIT;
  const questionCount = context.currentTopicQuestionCount ?? history.length;

  if (questionCount >= limit) {
    return {
      currentTopic,
      historyCount: history.length,
      questionCount,
      limit,
      candidateCount: candidates.length,
      selectedCandidate: null,
      limitReached: true,
    };
  }

  const selectedCandidate = candidates
    .map((candidate) => ({
      candidate,
      score:
        candidate.priorityScore +
        candidate.relevanceScore -
        scoreQuestionHistoryPenalty(candidate, history),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)[0]?.candidate ?? null;

  return {
    currentTopic,
    historyCount: history.length,
    questionCount,
    limit,
    candidateCount: candidates.length,
    selectedCandidate,
    limitReached: false,
  };
}

function filterQuestionHistoryForTopic(
  history: QuestionHistoryItem[],
  topicId: string,
  slotName: string,
) {
  return history.filter(
    (item) => item.topicId === topicId || item.targetMainSlotId === topicId || item.topicId === slotName,
  );
}

function scoreQuestionHistoryPenalty(
  candidate: QuestionCandidate,
  history: QuestionHistoryItem[],
) {
  const samePurposeCount = history.filter(
    (item) =>
      item.targetSubSlotId === candidate.subSlotId &&
      item.questionPurpose === candidate.questionPurpose,
  ).length;
  if (samePurposeCount === 0) return 0;

  if (
    (candidate.questionPurpose === "clarify" ||
      candidate.questionPurpose === "resolve_conflict") &&
    samePurposeCount <= 1
  ) {
    return 60;
  }

  return 100;
}

function scoreQuestionCandidatePriority(input: {
  priority: string;
  completion: SlotCompletion;
  responseState: SlotClassificationResponseState;
  minutesReadiness: QuestionCandidate["minutesReadiness"];
  questionStage: QuestionCandidate["questionStage"];
}) {
  if (
    input.responseState === "explicit_none" ||
    input.responseState === "declined" ||
    input.responseState === "not_considered" ||
    input.responseState === "unable_to_verbalize"
  ) {
    return -999;
  }

  let score = 0;
  if (input.minutesReadiness === "insufficient" && input.questionStage === "current_thought") {
    score += 100;
  }
  if (input.questionStage === "background_reason") score += 60;
  if (input.questionStage === "conditions_specificity") score += 40;
  if (input.responseState === "ambiguous") score += 50;
  if (input.responseState === "conflicting") score += 50;
  if (input.priority === "core") score += 30;
  if (input.completion === "partial") score += 20;

  return score;
}

function getQuestionPurposeForSubSlot(
  slot: {
    id: string;
    label: string;
    questionStage: QuestionCandidate["questionStage"];
    responseState?: SlotClassificationResponseState;
  },
  stored: StoredSubSlotState | undefined,
): QuestionPurpose {
  const responseState = stored?.responseState ?? slot.responseState;

  if (responseState === "conflicting") return "resolve_conflict";
  if (responseState === "ambiguous") return "clarify";
  if (slot.questionStage === "background_reason") return "ask_reason";
  if (/condition|timing|acceptable_change|involvement/.test(slot.id)) {
    return "ask_condition";
  }
  if (slot.questionStage === "conditions_specificity") return "ask_example";

  return "elicit_preference";
}

function buildQuestionCandidateReason(
  slot: { label: string; followUpNeed: string; questionStage: string },
  purpose: QuestionPurpose,
) {
  if (slot.followUpNeed === "required") {
    return `本人の考えを議事録に記載するため、「${slot.label}」を確認します。`;
  }

  if (purpose === "ask_reason") {
    return `本人の考えの背景や理由を補うため、「${slot.label}」を確認します。`;
  }

  if (purpose === "ask_condition" || purpose === "ask_example") {
    return `希望が変わる条件や具体例を補うため、「${slot.label}」を確認します。`;
  }

  if (purpose === "clarify") return `曖昧な発言を確認するため、「${slot.label}」を確認します。`;
  if (purpose === "resolve_conflict") return `発言間の違いを確認するため、「${slot.label}」を確認します。`;

  return `議事録に必要な情報を補うため、「${slot.label}」を確認します。`;
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
    topic_id: utterance.topic_id ?? null,
    text: utterance.text,
    start_ms: utterance.start_ms ?? null,
    end_ms: utterance.end_ms ?? null,
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

function isRepeatedAIQuestion(
  history: QuestionHistoryItem[],
  question: string,
) {
  const normalizedQuestion = normalizeAnswerText(question);
  if (!normalizedQuestion) return true;

  return history.some((item) => {
    const normalizedHistory = normalizeAnswerText(item.content);
    if (!normalizedHistory) return false;

    return (
      normalizedHistory === normalizedQuestion ||
      normalizedHistory.includes(normalizedQuestion) ||
      normalizedQuestion.includes(normalizedHistory)
    );
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

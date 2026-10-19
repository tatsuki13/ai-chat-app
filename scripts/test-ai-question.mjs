import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { tsLoader } from "./test-helpers/load-ts.mjs";

process.env.OPENAI_API_KEY = "test-key-no-network";
const baseLoad = tsLoader();
const acp = baseLoad("lib/acp-mvp.ts");
const policy = baseLoad("lib/ai/question-policy.ts");
const topic = acp.DISCUSSION_TOPICS[0];
const utterance = (text = "毎朝、庭の花を見るのが楽しみです。", id = "u1", speaker = "elder", at = "2026-10-01T00:01:00.000Z") => ({ id, speaker, text, topic_id: topic.id, created_at: at });
function context({ empty = false, incomplete = false, count = 0, utterances = [utterance()], history = [] } = {}) {
  const states = acp.createEmptySubSlotStates().map((item) => incomplete ? item : ({ ...item, completion: "complete", responseState: "answered", evidenceUtteranceIds: ["u1"], depth: "elaborated", canAskAgain: false, isDeferred: false }));
  return { sessionId: "session-test", currentTopic: topic.id,
    utterances: empty ? [] : utterances, utterancesToClassify: empty ? [] : utterances,
    subSlotStates: states, slotStates: acp.createEmptySlotStates(), currentTopicQuestionCount: count, aiQuestionHistory: history };
}
function action(overrides = {}) {
  return { type: "ask_question", current_topic_id: topic.id, selected_slot_id: null,
    question_type: "values", source_type: "utterance", evidence_utterance_ids: ["u1"],
    support_for_utterance_id: null, transition_phrase: "", question: "花を見る時間のどのようなところが好きですか？",
    decision_reason: "question_generated", model_reported_reason: "本人が語った花を見る経験の背景を尋ねるため。", ...overrides };
}
function fixture(responder = () => action(), extraMocks = {}) {
  const requests = [];
  const mocks = { "lib/ai/client.ts": {
    getDialogueOpenAIModel: () => "mock-model", getMinutesOpenAIModel: () => "mock-model", getDefaultOpenAITimeoutMs: () => 1000,
    createOpenAIClient: (options) => ({ chat: { completions: { create: async (request) => {
      if (options.maxRetries !== undefined) assert.equal(options.maxRetries, 0);
      const payload = JSON.parse(request.messages[1].content);
      requests.push({ payload, system: request.messages[0].content });
      const response = await responder(payload, requests.length);
      return { choices: [{ message: { content: typeof response === "string" ? response : response?.slot_updates ? JSON.stringify(response) : JSON.stringify({ slot_updates: [], unmatchedUtteranceIds: payload.unprocessed_utterances.map((item) => item.id), next_action: response }) } }] };
    } } } }),
  }, ...extraMocks };
  const load = tsLoader(mocks);
  return { load, requests, generate: load("lib/llm.ts").updateSlotsAndGenerateNextQuestionAction };
}

test("slotless grounded questions work with zero candidate slots and preserve all classification definitions", async () => {
  const f = fixture();
  const result = await f.generate(context());
  assert.equal(result.nextQuestion.policy.selected_slot_id, null);
  assert.equal(result.nextQuestion.policy.question_type, "values");
  assert.equal(result.nextQuestion.policy.llm_call_count, 1);
  assert.equal(f.requests[0].payload.candidate_slots.length, 0);
  assert.equal(f.requests[0].payload.sub_slot_definitions.length, topic.aspects.length);
  assert.equal(f.requests[0].payload.opening_question, topic.openingQuestion);
  assert.deepEqual(result.debug.classifiedUtteranceIds, ["u1"]);
});

test("shortlist is deterministic, at most two, without changing the full-pool three-question condition", async () => {
  const f = fixture();
  const first = await f.generate(context({ incomplete: true, count: 2 }));
  const second = await f.generate(context({ incomplete: true, count: 2 }));
  assert.equal(first.nextQuestion.policy.question_limit, 3);
  assert.ok(f.requests[0].payload.candidate_slots.length <= 2);
  assert.deepEqual(f.requests[0].payload.candidate_slots, f.requests[1].payload.candidate_slots);
  assert.equal(first.nextQuestion.policy.decision, "next_question");
  assert.equal(second.nextQuestion.policy.decision, "next_question");
});

test("normal two / conditional three cap is enforced before LLM and does not classify pending utterances", async () => {
  const f = fixture();
  for (const [incomplete, count, limit] of [[false, 2, 2], [true, 3, 3]]) {
    const result = await f.generate(context({ incomplete, count }));
    assert.equal(result.nextQuestion.policy.decision_reason, "question_limit_reached");
    assert.equal(result.nextQuestion.policy.question_limit, limit);
    assert.equal(result.nextQuestion.policy.llm_call_count, 0);
    assert.deepEqual(result.debug.classifiedUtteranceIds, []);
  }
  assert.equal(f.requests.length, 0);
});

test("no current-theme speech returns an opening reminder, not advance/error, without an LLM call", async () => {
  const f = fixture();
  const result = await f.generate(context({ utterances: [{ ...utterance(), topic_id: "selfhood" }] }));
  assert.equal(result.nextQuestion.policy.decision, "opening_question");
  assert.equal(result.nextQuestion.no_relevant_followup, false);
  assert.deepEqual(result.debug.classifiedUtteranceIds, []);
  assert.equal(f.requests.length, 0);
});

test("opening and literal repeated questions are rejected; retry can legitimately decline to ask", async () => {
  for (const repeated of [topic.openingQuestion, "散歩のどのようなところが好きですか？"]) {
    const f = fixture((payload, attempt) => attempt === 1 ? action({ question: repeated }) : action({ type: "advance_topic", question: null, decision_reason: "no_useful_question" }));
    const result = await f.generate(context({ history: [{ content: repeated, topicId: topic.id }] }));
    assert.equal(result.nextQuestion.policy.decision, "advance_topic");
    assert.deepEqual(result.nextQuestion.policy.validation_failures, ["repeated_question"]);
    assert.equal(f.requests.length, 2);
  }
});

test("combined prompt supplies semantic duplicate example, real history and evidence rather than relying on text equality", async () => {
  const f = fixture();
  await f.generate(context({ history: [{ content: "散歩のどのようなところが好きですか？", topicId: topic.id }] }));
  assert.match(f.requests[0].system, /意味が同じ質問/);
  assert.match(f.requests[0].system, /散歩を楽しみにする理由/);
  assert.equal(f.requests[0].payload.previous_ai_questions.length, 1);
  assert.ok(f.requests[0].payload.evidence_memory.length > 0);
});

test("different wording on the same evidence and question purpose is rejected without a separate semantic call", async () => {
  const f = fixture((payload, attempt) => attempt === 1
    ? action({ question: "花を見ることを楽しみにしている理由は何ですか？" })
    : action({ type: "advance_topic", question: null, decision_reason: "no_useful_question" }));
  const result = await f.generate(context({ history: [{
    content: "花を見る時間のどのようなところが好きですか？", topicId: topic.id,
    questionType: "values", evidenceUtteranceIds: ["u1"], targetSubSlotId: null,
  }] }));
  assert.equal(result.nextQuestion.policy.decision, "advance_topic");
  assert.deepEqual(result.nextQuestion.policy.validation_failures, ["repeated_question_subject"]);
});

test("a legitimate advance_topic is accepted even while candidate slots remain", async () => {
  const f = fixture(() => action({ type: "advance_topic", question: null, decision_reason: "no_useful_question" }));
  const result = await f.generate(context({ incomplete: true }));
  assert.ok(f.requests[0].payload.candidate_slots.length > 0);
  assert.equal(result.nextQuestion.policy.decision_reason, "no_useful_question");
  assert.equal(f.requests.length, 1);
});

test("selected slot must belong to the supplied shortlist, but either candidate may be selected", async () => {
  const f = fixture((payload) => action({ selected_slot_id: payload.candidate_slots.at(-1).subSlotId, source_type: "both" }));
  const result = await f.generate(context({ incomplete: true }));
  assert.equal(result.nextQuestion.policy.selected_slot_id.slot_id, f.requests[0].payload.candidate_slots.at(-1).subSlotId);
  const bad = fixture(() => action({ selected_slot_id: "invented", source_type: "both" }));
  await assert.rejects(bad.generate(context()), /ai_question_generation_failed/);
});

test("refusal and hold evidence cannot be used to pursue a slotless question", async () => {
  for (const text of ["そのことは話したくありません。", "今はまだ決められません。 "]) {
    const f = fixture();
    await assert.rejects(f.generate(context({ utterances: [utterance(text)] })), (error) => error.policy.validation_failures.every((item) => item === "protected_evidence"));
  }
});

test("difficulty permits one experience support; a repeated difficulty on the same subject cannot be pursued", async () => {
  const difficulty = utterance("考えたことがないので、わからないです。", "d1");
  const f = fixture(() => action({ question_type: "experience", evidence_utterance_ids: ["d1"], support_for_utterance_id: "d1", question: "普段、ご自宅ではどのように過ごしていますか？" }));
  const c = context({ utterances: [difficulty] });
  const result = await f.generate(c);
  const trace = result.nextQuestion.policy;
  assert.equal(trace.support_for_utterance_id, "d1");
  const history = [{ content: result.nextQuestion.question, topicId: topic.id, generatedAt: "2026-10-01T00:01:30.000Z", supportKey: trace.support_key, supportForUtteranceId: "d1", evidenceUtteranceIds: ["d1"] }];
  const again = fixture(() => action({ question_type: "experience", evidence_utterance_ids: ["d2"], support_for_utterance_id: "d2", question: "昨日は何をして過ごしましたか？" }));
  await assert.rejects(again.generate(context({ count: 1, utterances: [difficulty, utterance("やっぱり思いつかないです。", "d2", "elder", "2026-10-01T00:02:00.000Z")], history })), /ai_question_generation_failed/);
  const guard = policy.buildDialogueGuards([difficulty], history, topic.id);
  assert.equal(guard.difficulties[0].supported, true);
});

test("question grounding rejects foreign IDs, wrong topic and unknown original speakers", async () => {
  for (const overrides of [{ evidence_utterance_ids: ["foreign-session-id"] }, { current_topic_id: "selfhood" }]) {
    const f = fixture(() => action(overrides));
    await assert.rejects(f.generate(context()), /ai_question_generation_failed/);
  }
  const f = fixture();
  const result = await f.generate(context({ utterances: [{ ...utterance(), original_speaker: "unknown" }] }));
  assert.equal(result.nextQuestion.policy.decision, "opening_question");
});

test("API failure and invalid JSON remain technical errors with actual call counts and no generated fallback", async () => {
  for (const responder of [() => { throw new Error("mock API unavailable"); }, () => "invalid JSON"]) {
    const f = fixture(responder);
    await assert.rejects(f.generate(context()), (error) => {
      assert.equal(error.policy.decision, "error");
      assert.equal(error.policy.decision_reason, "technical_error");
      assert.equal(error.policy.llm_call_count, 2);
      return true;
    });
  }
});

test("cursor advances through classified prefix only; unclassified utterances remain for transition/minutes updates", () => {
  const pending = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(policy.classifiedPrefix(pending, []), []);
  assert.deepEqual(policy.classifiedPrefix(pending, ["b", "c"]), []);
  assert.deepEqual(policy.classifiedPrefix(pending, ["a", "c"]), [{ id: "a" }]);
  assert.deepEqual(policy.classifiedPrefix(pending, ["a", "b", "c"]), pending);
});

test("first-stage strings and slot definitions remain unchanged; final-theme AI proposal requires confirmation", () => {
  const original = execFileSync("git", ["show", "HEAD:lib/acp-mvp.ts"], { encoding: "utf8" });
  const now = readFileSync("lib/acp-mvp.ts", "utf8");
  const definitions = (text) => text.slice(text.indexOf("const TOPIC_PRESENTATIONS"), text.indexOf("export const OPTIONAL_RESEARCH_THEMES"));
  assert.equal(definitions(now), definitions(original));
  const page = readFileSync("app/session/page.tsx", "utf8");
  assert.ok(page.includes('text: `${topic.introduction}\\n\\n${topic.openingQuestion}`'));
  const branch = page.slice(page.indexOf('proposal?.source === "ai_question"'), page.indexOf("async function generateQuestionFromTransitionProposal"));
  assert.match(branch, /if \(isLastTopic\) \{\s*showEndConfirmation/);
  assert.ok(!branch.slice(0, branch.indexOf("if (!nextTopic)")).includes("await completeSession()"));
});

test("final-theme approval opens confirmation; only the explicit end-confirmation action completes the session", async () => {
  const source = ts.createSourceFile("page.tsx", readFileSync("app/session/page.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "acceptTransitionProposal") declaration = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const js = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("state", `
    const session = {id:'s'}, busyAction = null, completionState = 'active', isLastTopic = true;
    const currentTopic = {id:'t'}, nextTopic = null, currentTopicIndex = 5;
    const transitionProposal = state.proposal;
    const setTransitionProposal = value => {state.proposal=value};
    const showEndConfirmation = () => {state.confirmations++;state.proposal={reason:'ready_to_end'}};
    const completeSession = async () => {state.completions++};
    ${js}
    return acceptTransitionProposal();`);
  const state = { proposal: { source: "ai_question", action: "advance_topic", sessionId: "s", topicId: "t" }, confirmations: 0, completions: 0 };
  await run(state);
  assert.equal(state.confirmations, 1);
  assert.equal(state.completions, 0);
  await run(state);
  assert.equal(state.completions, 1);
});

function serviceFixture(responder = () => action(), { count = 0, empty = false } = {}) {
  const c = context({ empty });
  const events = new Map();
  const logs = Array.from({ length: count }, (_, index) => ({
    content: `過去の質問${index}`, topicId: topic.id, generatedAt: new Date("2026-09-01"),
    metadata: { question: `過去の質問${index}` }, type: "NEXT_QUESTION",
  }));
  let state = {
    sessionId: "session-test", topicId: topic.id, participantCode: "test", slotRevision: 0,
    lastProcessedUtteranceId: null, lastProcessedAt: null, processingStatus: "idle",
    processingStartedAt: null, processingFinishedAt: null, lastError: null, retryCount: 0,
  };
  const merge = (target, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      target[key] = value && typeof value === "object" && "increment" in value ? (target[key] ?? 0) + value.increment : value;
    }
    return target;
  };
  const prisma = {
    $executeRaw: async () => 1,
    $transaction: async (fn) => fn(prisma),
    aIActionEvent: {
      findUnique: async ({ where }) => events.get(where.id) ?? null,
      findFirst: async () => null,
      create: async ({ data }) => { const row = { ...data, createdAt: new Date() }; events.set(data.id, row); return row; },
      update: async ({ where, data }) => merge(events.get(where.id), data),
    },
    aIInterventionLog: {
      findMany: async () => logs.filter((item) => item.type === "NEXT_QUESTION").slice(-8).reverse(),
      create: async ({ data }) => { logs.push(data); return data; },
    },
    slotProcessingState: {
      findUnique: async () => state,
      upsert: async () => state,
      updateMany: async ({ data }) => { merge(state, data); return { count: 1 }; },
      update: async ({ data }) => merge(state, data),
    },
    aIProcessingState: { upsert: async ({ create }) => ({ ...state, ...create }) },
  };
  const store = {
    getSessionContext: async () => ({ ...c, session: { id: "session-test", participantCode: "test" } }),
    getUnprocessedSlotUtterances: (items, id) => id ? items.slice(items.findIndex((item) => item.id === id) + 1) : items,
    getChangedSlotStates: () => [], getChangedSubSlotStates: () => [],
    saveSlotStates: async () => {}, saveSubSlotStates: async () => {},
  };
  const f = fixture(responder, { "lib/prisma.ts": { prisma }, "lib/acp-store.ts": store });
  return { ...f, events, logs, state, service: f.load("lib/server/ai-question.ts").generateAiQuestionForTopic,
    slots: f.load("lib/server/slot-processing.ts") };
}

test("service preserves initial and final research metadata and same-request replay does not save/generate twice", async () => {
  const f = serviceFixture();
  const request = { requestId: "request-1", sessionId: "session-test", currentTopicId: topic.id };
  const first = await f.service(request);
  const second = await f.service(request);
  assert.equal(first.suggestion.question, second.suggestion.question);
  assert.equal(second.idempotent_replay, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.logs.length, 1);
  const row = f.events.get("request-1");
  for (const key of ["question_type", "decision", "decision_reason", "source_type", "candidate_slot_ids", "selected_slot_id", "evidence_utterance_ids", "model_reported_reason", "policy_version", "llm_call_count", "result_source", "requestedAt", "processingStartedAt", "slotRevisionAtRequest"]) {
    assert.ok(key in row.metadata, `missing ${key}`);
  }
  assert.equal(row.policyVersion, policy.QUESTION_POLICY_VERSION);
  assert.equal(row.metadata.llm_call_count, 1);
  assert.equal(row.metadata.selected_slot_id, null);
  assert.equal(f.state.lastProcessedUtteranceId, "u1");
});

test("service logs advance and opening separately, keeps cap-skipped utterances unprocessed for later classification", async () => {
  const f = serviceFixture(undefined, { count: 2 });
  const response = await f.service({ requestId: "cap", sessionId: "session-test", currentTopicId: topic.id });
  assert.equal(response.transition_proposal.action, "advance_topic");
  assert.equal(f.events.get("cap").metadata.decision_reason, "question_limit_reached");
  assert.equal(f.events.get("cap").metadata.llm_call_count, 0);
  assert.equal(f.state.lastProcessedUtteranceId, null);
  assert.deepEqual(f.events.get("cap").metadata.processedUtteranceIds, []);
  assert.equal(f.requests.length, 0);
  const empty = serviceFixture(undefined, { empty: true });
  const reminder = await empty.service({ requestId: "empty", sessionId: "session-test", currentTopicId: topic.id });
  assert.equal(reminder.question_policy.decision, "opening_question");
  assert.equal(reminder.opening_question.question, topic.openingQuestion);
  assert.equal(reminder.transition_proposal, null);
  assert.equal(empty.logs.length, 0);
});

test("technical failure is persisted as error with original request metadata and no NEXT_QUESTION log", async () => {
  const f = serviceFixture(() => { throw new Error("mock unavailable"); });
  await assert.rejects(f.service({ requestId: "failure", sessionId: "session-test", currentTopicId: topic.id }), /ai_question_generation_failed/);
  const row = f.events.get("failure");
  assert.equal(row.result, "failed");
  assert.equal(row.metadata.decision_reason, "technical_error");
  assert.equal(row.metadata.llm_call_count, 2);
  assert.ok(row.metadata.requestedAt);
  assert.equal(f.logs.length, 0);
  assert.equal(f.state.lastProcessedUtteranceId, null);
});

test("cap-skipped speech is subsequently classified by the existing theme-transition / final-minutes path", async () => {
  for (const finalMinutes of [false, true]) {
    const f = serviceFixture((payload) => ({ classifications: [], unmatchedUtteranceIds: payload.conversation_log.map((item) => item.id), slot_updates: [] }), { count: 2 });
    await f.service({ requestId: `cap-${finalMinutes}`, sessionId: "session-test", currentTopicId: topic.id });
    assert.equal(f.state.lastProcessedUtteranceId, null);
    if (finalMinutes) await f.slots.updateSlotsForAllTopics({ sessionId: "session-test" });
    else await f.slots.updateSlotsForTopic({ sessionId: "session-test", topicId: topic.id });
    assert.equal(f.state.lastProcessedUtteranceId, "u1");
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.requests[0].payload.conversation_log.map((item) => item.id), ["u1"]);
  }
});

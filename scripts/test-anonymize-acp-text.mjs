import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const output = mkdtempSync(join(tmpdir(), "acp-anonymization-test-"));
let anonymizeACPText;
let buildAnonymizedAIUserContent;
try {
  execFileSync("node_modules/.bin/tsc", [
    "lib/anonymize-acp-text.ts", "lib/ai/anonymized-input.ts", "--outDir", output,
    "--module", "commonjs", "--target", "ES2020", "--skipLibCheck", "--strict",
  ], { stdio: "inherit" });
  ({ anonymizeACPText } = createRequire(import.meta.url)(join(output, "anonymize-acp-text.js")));
  ({ buildAnonymizedAIUserContent } = createRequire(import.meta.url)(join(output, "ai/anonymized-input.js")));
} finally {
  rmSync(output, { recursive: true, force: true });
}

test("masks labelled names, introductions and names with honorifics", () => {
  for (const [input, expected] of [
    ["氏名：山田 太郎", "氏名：[氏名]"],
    ["名前は山田太郎です。", "名前は[氏名]です。"],
    ["名前は山田さくらです。", "名前は[氏名]です。"],
    ["山田さくらさんに相談したい。", "[氏名]さんに相談したい。"],
    ["名前はたなかたろうです。", "名前は[氏名]です。"],
    ["氏名：John Smith", "氏名：[氏名]"],
    ["山田太郎と申します。", "[氏名]と申します。"],
    ["田中さんに相談したい。", "[氏名]さんに相談したい。"],
    ["佐藤先生を信頼しています。", "[氏名]先生を信頼しています。"],
    ["ジョン・スミスさんが来ます。", "[氏名]さんが来ます。"],
  ]) assert.equal(anonymizeACPText(input), expected);
});

test("masks addresses and postal codes while retaining conversational meaning", () => {
  for (const [input, expected] of [
    ["東京都新宿区西新宿2-8-1に住んでいます。", "[住所]に住んでいます。"],
    ["大阪府大阪市北区梅田１丁目２番３号です。", "[住所]です。"],
    ["住所は横浜市中区山下町123番地です。", "住所は[住所]です。"],
    ["住所：札幌市北区あいの里1条2丁目3番4号", "住所：[住所]"],
    ["新宿区西新宿2-8-1に住んでいます。", "[住所]に住んでいます。"],
    ["〒160-0023", "[郵便番号]"],
    ["東京都新宿区で散歩を続けたい。", "[住所]で散歩を続けたい。"],
  ]) assert.equal(anonymizeACPText(input), expected);
});

test("preserves family roles, professional titles and ordinary discussion", () => {
  for (const text of [
    "お医者さんに相談したい。", "看護師さんが来ます。", "お母さんと暮らしたい。",
    "家族と近所の方とのつながりを大切にしたい。", "自宅で生活を続けたい。",
  ]) assert.equal(anonymizeACPText(text), text);
});

test("retains existing masks and can be applied repeatedly", () => {
  const text = "田中さんのメールはtaro@example.com、電話は090-1234-5678、東京病院、participant-ABC123です。";
  const masked = anonymizeACPText(text);
  for (const placeholder of ["[氏名]", "[メール]", "[電話番号]", "[医療機関]", "[ID]"]) {
    assert.ok(masked.includes(placeholder));
  }
  assert.equal(anonymizeACPText(masked), masked);
});

test("masks nested question inputs and histories without changing reference IDs or enums", () => {
  const payload = {
    session: { id: "session-12345678", participant_code: "P001" },
    current_topic: { id: "current_life_values", slot_name: "今の生活で大切にしていること" },
    unprocessed_utterances: [{
      id: "utterance-12345678", speaker: "caregiver",
      text: "田中さんは東京都新宿区西新宿2-8-1に住んでいます。",
      created_at: "2026-10-07T10:00:00.000Z", start_ms: 1234, end_ms: null,
    }],
    recent_context: [{ text: "メールはtaro@example.comです。" }],
    previous_ai_questions: [{ content: "佐藤先生に相談しますか？" }],
    current_sub_slot_states: [{
      mainSlotId: "current_life_values", subSlotId: "family_communication",
      evidenceUtteranceIds: ["utterance-12345678"], responseState: "caregiver_interpretation",
    }],
    rules: { slot_updates_evidence_source: "unprocessed_utterances_only" },
  };
  const original = structuredClone(payload);
  const sent = JSON.parse(buildAnonymizedAIUserContent(payload));
  assert.equal(sent.unprocessed_utterances[0].text, "[氏名]さんは[住所]に住んでいます。");
  assert.equal(sent.recent_context[0].text, "メールは[メール]です。");
  assert.equal(sent.previous_ai_questions[0].content, "[氏名]先生に相談しますか？");
  assert.equal(sent.session.participant_code, "[ID]");
  assert.equal(sent.session.id, payload.session.id);
  assert.deepEqual(sent.current_sub_slot_states, payload.current_sub_slot_states);
  assert.deepEqual(sent.rules, payload.rules);
  assert.equal(sent.unprocessed_utterances[0].created_at, payload.unprocessed_utterances[0].created_at);
  assert.equal(sent.unprocessed_utterances[0].start_ms, 1234);
  assert.equal(sent.unprocessed_utterances[0].end_ms, null);
  assert.deepEqual(payload, original);
});

test("masks slot classification, minutes evidence and legacy chat input", () => {
  for (const payload of [
    { conversation_log: [{ id: "utterance-12345678", text: "氏名：山田太郎" }] },
    { acp_minutes_input: { themes: [{ aspects: [{ evidence: [{
      sourceUtteranceId: "utterance-12345678", value: "田中さんに頼りたい。", evidence: "住所：東京都新宿区西新宿2-8-1",
    }] }] }] } },
    { recent_transcript: ["田中さんに頼りたい。"], acpSlots: [{ summary: "山田太郎と申します。" }] },
  ]) {
    const sent = buildAnonymizedAIUserContent(payload);
    for (const pii of ["山田太郎", "田中", "東京都新宿区西新宿2-8-1"]) assert.ok(!sent.includes(pii));
    if (JSON.stringify(payload).includes("utterance-12345678")) assert.ok(sent.includes("utterance-12345678"));
  }
  assert.equal(JSON.parse(buildAnonymizedAIUserContent({ phone: "090-1234-5678", text: "participant-ABC123" })).phone, "[電話番号]");
  assert.equal(JSON.parse(buildAnonymizedAIUserContent({ text: "participant-ABC123" })).text, "[ID]");
});

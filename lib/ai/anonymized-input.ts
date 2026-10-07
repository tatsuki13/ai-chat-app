import { anonymizeACPText } from "../anonymize-acp-text";

// Keep references and enum values intact so the response can still be matched
// to stored utterances and slots. Mask free text in every nested input field.
const REFERENCE_FIELD = /(?:^id$|^ids$|Id$|Ids$|_id$|_ids$)/;
const MACHINE_TOKEN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function anonymizeInput(value: unknown, field = ""): unknown {
  if (field === "participant_code" || field === "participantCode") {
    return typeof value === "string" && value ? "[ID]" : value;
  }
  if (REFERENCE_FIELD.test(field)) return value;
  if (typeof value === "string") {
    if (ISO_TIMESTAMP.test(value)) return value;
    // Unlike narrative evidence, structured inputs contain long English enum
    // values. Do not replace these with [ID]. Other PII rules still apply.
    return anonymizeACPText(value, { maskOpaqueIdentifiers: !MACHINE_TOKEN.test(value) });
  }
  if (Array.isArray(value)) {
    return value.map((item) => anonymizeInput(item, field));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, anonymizeInput(item, key)]),
    );
  }
  return value;
}

export function buildAnonymizedAIUserContent(payload: unknown): string {
  // Transform strings before serialization: masking a JSON string directly
  // could change its keys, references, escaping, or structure.
  return JSON.stringify(anonymizeInput(payload), null, 2);
}

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";
const TEST_TEXT =
  process.env.JAPANESE_API_TEST_TEXT ??
  "「自宅」で過ごしたい。家族（ACP2026）とも相談したい。";

async function postJson(path, body, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  return readJson(response, path);
}

async function getJson(path, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return readJson(response, path);
}

async function readJson(response, path) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

const participantCode = `utf8-node-${Date.now()}`;
const sessionResult = await postJson("/api/session/start", {
  participant_code: participantCode,
  condition: "mvp",
});
const sessionId = sessionResult.session.id;
const sessionToken = sessionResult.session_access_token;

const savedResult = await postJson("/api/utterance", {
  session_id: sessionId,
  speaker: "elder",
  text: TEST_TEXT,
}, sessionToken);
const detailResult = await getJson(
  `/api/session/${encodeURIComponent(sessionId)}`,
  sessionToken,
);
const retrievedText = detailResult.utterances.at(-1)?.text ?? "";

const responseMatches = savedResult.utterance.text === TEST_TEXT;
const retrievedMatches = retrievedText === TEST_TEXT;

console.log(JSON.stringify({
  baseUrl: BASE_URL,
  sessionId,
  participantCode,
  responseMatches,
  retrievedMatches,
  input: TEST_TEXT,
  responseText: savedResult.utterance.text,
  retrievedText,
}, null, 2));

if (!responseMatches || !retrievedMatches) {
  process.exitCode = 1;
}

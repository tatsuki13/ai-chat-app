import type { RemoteMicRole } from "./config";
import { getRemoteMicRuntimeStore } from "./runtime-store";

export type RemoteMicRecognizedText = {
  id: string;
  sessionId: string;
  role: RemoteMicRole;
  text: string;
  recognizedAt: string;
  createdAt: number;
  consumed: boolean;
};

const TEXT_TTL_MS = 5 * 60 * 1000;

function getTexts() {
  return getRemoteMicRuntimeStore().texts as Map<string, RemoteMicRecognizedText>;
}

export function addRemoteMicRecognizedText(input: {
  sessionId: string;
  role: RemoteMicRole;
  text: string;
  recognizedAt: string;
  clientTextId: string;
}) {
  pruneExpiredTexts();
  const texts = getTexts();
  const id = `${input.sessionId}:${input.role}:${input.clientTextId}`;
  const existing = texts.get(id);

  if (existing) return serializeText(existing);

  const item: RemoteMicRecognizedText = {
    id,
    sessionId: input.sessionId,
    role: input.role,
    text: input.text,
    recognizedAt: input.recognizedAt,
    createdAt: Date.now(),
    consumed: false,
  };
  texts.set(id, item);

  return serializeText(item);
}

export function consumeRemoteMicRecognizedTexts(sessionId: string) {
  pruneExpiredTexts();
  const texts = getTexts();
  const items = Array.from(texts.values())
    .filter((item) => item.sessionId === sessionId && !item.consumed)
    .sort((left, right) => Date.parse(left.recognizedAt) - Date.parse(right.recognizedAt));

  for (const item of items) {
    item.consumed = true;
    texts.set(item.id, item);
  }

  return items.map(serializeText);
}

export function clearRemoteMicRecognizedTexts(sessionId: string) {
  const texts = getTexts();

  for (const [id, item] of texts.entries()) {
    if (item.sessionId === sessionId) {
      texts.delete(id);
    }
  }
}

function serializeText(item: RemoteMicRecognizedText) {
  return {
    id: item.id,
    role: item.role,
    text: item.text,
    recognizedAt: item.recognizedAt,
  };
}

function pruneExpiredTexts() {
  const minCreatedAt = Date.now() - TEXT_TTL_MS;
  const texts = getTexts();

  for (const [id, item] of texts.entries()) {
    if (item.createdAt < minCreatedAt) {
      texts.delete(id);
    }
  }
}

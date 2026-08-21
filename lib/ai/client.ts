import OpenAI from "openai";

export function createOpenAIClient(input: {
  apiKey: string;
  timeout?: number;
}) {
  return new OpenAI({
    apiKey: input.apiKey,
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
  });
}

export function getDefaultOpenAITimeoutMs() {
  return Number(process.env.OPENAI_TIMEOUT_MS || 20000);
}

export function getDialogueOpenAIModel() {
  return process.env.OPENAI_DIALOGUE_MODEL || "gpt-4.1";
}

export function getMinutesOpenAIModel() {
  return process.env.OPENAI_MINUTES_MODEL || "gpt-5.6-terra";
}

export function getDefaultOpenAIModel() {
  return getDialogueOpenAIModel();
}

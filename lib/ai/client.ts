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

export function getDefaultOpenAIModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

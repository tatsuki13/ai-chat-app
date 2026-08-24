export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
export const TRANSCRIBE_PROMPT = [
  "これは日本語のACP（アドバンス・ケア・プランニング）の対話です。",
  "本人と介護者が、今後の生活、医療、介護、本人の希望、不安、家族、施設、在宅療養、延命治療、救急搬送、意思決定について話しています。",
  "日本語として自然な表記にしてください。",
  "医療・介護・ACPに関する語を優先して認識してください。",
  "聞き取れない箇所は推測しすぎず、無理に別の言葉へ置き換えないでください。",
  "沈黙、環境音、端末操作音、咳払いだけの場合は文字にしないでください。",
].join("\n");

export function getTranscribeModel() {
  return process.env.OPENAI_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
}

export function getTranscribePrompt() {
  return process.env.OPENAI_TRANSCRIBE_PROMPT || TRANSCRIBE_PROMPT;
}

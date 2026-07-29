export type RemoteMicRole = "elder" | "caregiver";

export const REMOTE_MIC_COOKIE_NAME = "acp_remote_mic";

export function isRemoteMicEnabled() {
  return process.env.REMOTE_MIC_ENABLED === "true";
}

export function getRemoteMicTokenTtlSeconds() {
  const value = Number(process.env.REMOTE_MIC_TOKEN_TTL_SECONDS ?? 300);

  return Number.isFinite(value) ? Math.max(60, Math.min(900, value)) : 300;
}

export function getRemoteMicSessionTtlSeconds() {
  const value = Number(process.env.REMOTE_MIC_SESSION_TTL_SECONDS ?? 14_400);

  return Number.isFinite(value) ? Math.max(300, Math.min(28_800, value)) : 14_400;
}

export function shouldStoreRawRemoteMicAudio() {
  return process.env.REMOTE_MIC_STORE_RAW_AUDIO === "true";
}

export function isRemoteMicDedupEnabled() {
  return process.env.REMOTE_MIC_DEDUP_ENABLED !== "false";
}

export function getRemoteMicBaseUrl(request?: Request) {
  const configured = normalizeBaseUrl(process.env.REMOTE_MIC_BASE_URL ?? "");
  if (configured) return configured;

  if (!request) return "";
  const url = new URL(request.url);

  return `${url.protocol}//${url.host}`;
}

export function parseRemoteMicRole(value: unknown): RemoteMicRole | null {
  return value === "elder" || value === "caregiver" ? value : null;
}

export function isSafeRemoteMicBaseUrl(value: string) {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;

    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  return trimmed.replace(/\/+$/, "");
}

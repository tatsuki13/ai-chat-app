export type RemoteMicRole = "elder" | "caregiver";

export function isRemoteMicEnabled() {
  return process.env.REMOTE_MIC_ENABLED === "true";
}

export function shouldStoreRawRemoteMicAudio() {
  return process.env.REMOTE_MIC_STORE_RAW_AUDIO === "true";
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

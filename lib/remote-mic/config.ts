export type RemoteMicRole = "elder" | "caregiver";

export function parseRemoteMicRole(value: unknown): RemoteMicRole | null {
  return value === "elder" || value === "caregiver" ? value : null;
}

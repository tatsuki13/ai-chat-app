import { NextResponse } from "next/server";
import { getActiveFixedRemoteMicSession } from "../../../../../lib/remote-mic/fixed-session";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";

export const runtime = "nodejs";

const LOCAL_ASR_BASE_URL =
  process.env.LOCAL_ASR_BASE_URL || "http://127.0.0.1:8765";
const LOCAL_ASR_TIMEOUT_MS = Number(process.env.LOCAL_ASR_TIMEOUT_MS || 3000);
const LOCAL_ASR_HEALTH_RETRY_COUNT = 3;
const LOCAL_ASR_HEALTH_RETRY_DELAY_MS = 250;

export async function GET() {
  let activeSession: Awaited<ReturnType<typeof getFixedRemoteMicActiveSession>> = null;
  let activeSessionError: string | null = null;

  try {
    activeSession = await getFixedRemoteMicActiveSession();
  } catch (error) {
    activeSessionError = error instanceof Error ? error.message : String(error);
    console.error("[local-asr] active session health check failed", {
      error: activeSessionError,
    });
  }

  const runtimeState = getActiveFixedRemoteMicSession();
  const roles =
    runtimeState && activeSession && runtimeState.sessionId === activeSession.sessionId
      ? runtimeState.roles
      : null;
  try {
    const response = await fetchLocalAsrHealth();
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          worker: "error",
          status: response.status,
          activeSession: activeSessionError ? "error" : activeSession ? "connected" : "none",
          activeSessionId: activeSession?.sessionId ?? null,
          elder: roles?.elder.lastSeenAt ? "connected" : "disconnected",
          caregiver: roles?.caregiver.lastSeenAt ? "connected" : "disconnected",
        },
        { status: 502 },
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      worker: "connected",
      ...data,
      activeSession: activeSessionError ? "error" : activeSession ? "connected" : "none",
      activeSessionId: activeSession?.sessionId ?? null,
      elder: roles?.elder.lastSeenAt ? "connected" : "disconnected",
      caregiver: roles?.caregiver.lastSeenAt ? "connected" : "disconnected",
    });
  } catch (error) {
    console.error("[local-asr] worker health check failed", {
      error: error instanceof Error ? error.message : String(error),
      activeSessionId: activeSession?.sessionId ?? null,
    });

    return NextResponse.json(
      {
        ok: false,
        worker: "disconnected",
        error: error instanceof Error ? error.message : String(error),
        activeSession: activeSessionError ? "error" : activeSession ? "connected" : "none",
        activeSessionId: activeSession?.sessionId ?? null,
        elder: roles?.elder.lastSeenAt ? "connected" : "disconnected",
        caregiver: roles?.caregiver.lastSeenAt ? "connected" : "disconnected",
      },
      { status: 503 },
    );
  }
}

async function fetchLocalAsrHealth() {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= LOCAL_ASR_HEALTH_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOCAL_ASR_TIMEOUT_MS);

    try {
      return await fetch(`${LOCAL_ASR_BASE_URL.replace(/\/+$/, "")}/health`, {
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      lastError = error;
      if (attempt < LOCAL_ASR_HEALTH_RETRY_COUNT) {
        await wait(LOCAL_ASR_HEALTH_RETRY_DELAY_MS);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Local ASR health check failed");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

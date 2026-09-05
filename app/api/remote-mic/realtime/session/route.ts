import { NextResponse } from "next/server";
import { getFixedRemoteMicActiveSession } from "../../../../../lib/remote-mic/active-session-db";
import { parseRemoteMicRole } from "../../../../../lib/remote-mic/config";
import {
  getActiveFixedRemoteMicSession,
  setActiveFixedRemoteMicSession,
} from "../../../../../lib/remote-mic/fixed-session";
import {
  getRealtimeTranscribeModel,
  getRealtimeTranscribePrompt,
  getRealtimeVadSilenceMs,
  getRealtimeVadThreshold,
} from "../../../../../lib/remote-mic/realtime-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
    role?: unknown;
  } | null;
  const sessionId = requiredString(body?.sessionId);
  const role = parseRemoteMicRole(requiredString(body?.role));

  if (!sessionId || !role) {
    return NextResponse.json(
      { error: "sessionId and role are required" },
      { status: 400 },
    );
  }

  let active:
    | {
        sessionId: string;
        participantCode: string | null;
        endedAt: string | null;
        dialogueStartedAt: string | null;
      }
    | null = null;

  try {
    active = await getFixedRemoteMicActiveSession();
  } catch (error) {
    console.warn("[remote-mic realtime active session db lookup failed]", {
      sessionId,
      role,
      error,
    });
    active = getActiveFixedRemoteMicSession();
  }

  if (!active || active.sessionId !== sessionId || active.endedAt) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }
  if (!active.dialogueStartedAt) {
    return NextResponse.json(
      { error: "dialogue has not started" },
      { status: 409 },
    );
  }

  setActiveFixedRemoteMicSession(active);
  const runtimeActive = getActiveFixedRemoteMicSession();
  if (!runtimeActive || runtimeActive.sessionId !== sessionId) {
    return NextResponse.json({ error: "active session mismatch" }, { status: 409 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is required for realtime transcription" },
      { status: 503 },
    );
  }

  const model = getRealtimeTranscribeModel();
  const prompt = getRealtimeTranscribePrompt();
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
            noise_reduction: {
              type: "near_field",
            },
            transcription: {
              model,
              language: "ja",
              prompt,
            },
            turn_detection: {
              type: "server_vad",
              threshold: getRealtimeVadThreshold(),
              prefix_padding_ms: 300,
              silence_duration_ms: getRealtimeVadSilenceMs(),
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error("[remote-mic realtime session failed]", {
      status: response.status,
      errorText,
    });

    return NextResponse.json(
      { error: "Failed to create realtime transcription session" },
      { status: 502 },
    );
  }

  const data = (await response.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: {
      value?: string;
      expires_at?: number;
    };
  };
  const clientSecret = data.client_secret?.value ?? data.value ?? "";
  const expiresAt = data.client_secret?.expires_at ?? data.expires_at ?? null;

  if (!clientSecret) {
    return NextResponse.json(
      { error: "Realtime client secret was not returned" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    clientSecret,
    expiresAt,
    model,
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

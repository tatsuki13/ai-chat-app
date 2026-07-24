import { NextResponse } from "next/server";
import {
  createPairingExpiry,
  createPairingToken,
  hashPairingToken,
  isMicrophoneRole,
  type MicrophoneRole,
} from "../../../../lib/microphone-pairing";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const sessionId = requiredString(body?.sessionId ?? body?.session_id);

    if (!sessionId || !isValidSessionId(sessionId)) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        endedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!session) {
      return NextResponse.json(
        { error: "Session not found or already ended" },
        { status: 404 },
      );
    }

    const roles: MicrophoneRole[] = ["caregiver", "elder"];
    const expiresAt = createPairingExpiry();
    const tokens = await Promise.all(
      roles.map(async (role) => {
        const token = createPairingToken();

        await prisma.microphonePairingToken.upsert({
          where: {
            sessionId_role: {
              sessionId,
              role,
            },
          },
          create: {
            sessionId,
            role,
            tokenHash: hashPairingToken(token),
            expiresAt,
          },
          update: {
            tokenHash: hashPairingToken(token),
            expiresAt,
            revokedAt: null,
            lastUsedAt: null,
          },
        });

        return {
          role,
          token,
          expiresAt: expiresAt.toISOString(),
        };
      }),
    );

    return NextResponse.json({ tokens });
  } catch (error) {
    console.error("Failed to create microphone pairing tokens", error);

    return NextResponse.json(
      { error: "Failed to create microphone pairing tokens" },
      { status: 500 },
    );
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidSessionId(value: string) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

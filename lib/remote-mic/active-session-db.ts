import { prisma } from "../prisma";

export const FIXED_REMOTE_MIC_CHANNEL = "fixed";

export async function getFixedRemoteMicActiveSession() {
  const active = await prisma.remoteMicActiveSession.findUnique({
    where: { channel: FIXED_REMOTE_MIC_CHANNEL },
    include: {
      session: {
        select: {
          id: true,
          participantCode: true,
          endedAt: true,
          dialogueStartedAt: true,
        },
      },
    },
  });

  if (!active || active.session.endedAt) return null;

  return {
    id: active.id,
    channel: active.channel,
    sessionId: active.session.id,
    participantCode: active.session.participantCode,
    endedAt: active.session.endedAt?.toISOString() ?? null,
    dialogueStartedAt: active.session.dialogueStartedAt?.toISOString() ?? null,
    activatedAt: active.activatedAt.toISOString(),
    updatedAt: active.updatedAt.toISOString(),
  };
}

export async function setFixedRemoteMicActiveSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      participantCode: true,
      endedAt: true,
      dialogueStartedAt: true,
    },
  });

  if (!session) return { ok: false as const, error: "Session not found", status: 404 };
  if (session.endedAt) return { ok: false as const, error: "Session is not active", status: 409 };

  const active = await prisma.remoteMicActiveSession.upsert({
    where: { channel: FIXED_REMOTE_MIC_CHANNEL },
    create: {
      channel: FIXED_REMOTE_MIC_CHANNEL,
      sessionId: session.id,
    },
    update: {
      sessionId: session.id,
    },
  });

  return {
    ok: true as const,
    active: {
      id: active.id,
      channel: active.channel,
      sessionId: session.id,
      participantCode: session.participantCode,
      endedAt: session.endedAt?.toISOString() ?? null,
      dialogueStartedAt: session.dialogueStartedAt?.toISOString() ?? null,
      activatedAt: active.activatedAt.toISOString(),
      updatedAt: active.updatedAt.toISOString(),
    },
  };
}

export async function clearFixedRemoteMicActiveSession(sessionId?: string) {
  await prisma.remoteMicActiveSession.deleteMany({
    where: {
      channel: FIXED_REMOTE_MIC_CHANNEL,
      ...(sessionId ? { sessionId } : {}),
    },
  });
}

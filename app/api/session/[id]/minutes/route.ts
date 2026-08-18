import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { requireAdminOrSessionAccess } from "../../../../../lib/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await requireAdminOrSessionAccess(request, id);
    if ("response" in auth) return auth.response;

    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        id: true,
        participantCode: true,
        condition: true,
        startedAt: true,
        endedAt: true,
        finalMinutes: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            markdown: true,
            json: true,
            createdAt: true,
          },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const latestMinutes = session.finalMinutes[0] ?? null;

    return NextResponse.json({
      session: {
        participant_code: session.participantCode,
        condition: session.condition,
        started_at: session.startedAt.toISOString(),
        ended_at: session.endedAt?.toISOString() ?? null,
      },
      final_minutes: latestMinutes
        ? {
            id: latestMinutes.id,
            markdown: latestMinutes.markdown,
            json: latestMinutes.json,
            created_at: latestMinutes.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to load final minutes" },
      { status: 500 },
    );
  }
}

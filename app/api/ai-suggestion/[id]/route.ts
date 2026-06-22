import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return updateAdoption(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return updateAdoption(request, context);
}

async function updateAdoption(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    if (typeof body.adopted !== "boolean") {
      return NextResponse.json({ error: "adopted is required" }, { status: 400 });
    }

    const suggestion = await prisma.aiSuggestionLog.update({
      where: { id },
      data: {
        adopted: body.adopted,
      },
    });

    return NextResponse.json({
      suggestion: {
        id: suggestion.id,
        adopted: suggestion.adopted,
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to update suggestion adoption" },
      { status: 500 },
    );
  }
}

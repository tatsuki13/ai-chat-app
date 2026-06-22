import { NextResponse } from "next/server";
import { createButtonEvent } from "../../../lib/acp-store";
import { isButtonType } from "../../../lib/acp-mvp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
    const buttonType = body.button_type ?? body.buttonType;

    if (!sessionId || !isButtonType(buttonType)) {
      return NextResponse.json(
        { error: "session_id and valid button_type are required" },
        { status: 400 },
      );
    }

    const event = await createButtonEvent(sessionId, buttonType);

    return NextResponse.json({
      button_event: {
        id: event.id,
        session_id: event.sessionId,
        button_type: event.buttonType,
        created_at: event.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Failed to save button event" },
      { status: 500 },
    );
  }
}

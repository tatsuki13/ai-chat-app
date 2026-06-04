import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string") {
      return Response.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const response = await client.responses.create({
      model: "gpt-5.4 mini",
      input: [
        {
          role: "system",
          content:
            "あなたは家族間の将来ケア対話を支援する中立的なAIエージェントです。介護、医療、終末期、住まいに関する話題を、押しつけず、穏やかに、心理的負担を下げる形で提示してください。特定の意思決定を誘導してはいけません。",
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    return Response.json({
      reply: response.output_text,
    });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
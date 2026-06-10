export async function POST() {
  return Response.json(
    {
      error:
        "Generated assistant replies are disabled. The moderator flow uses fixed templates only."
    },
    { status: 410 }
  );
}

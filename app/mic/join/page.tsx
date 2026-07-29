import { redirect } from "next/navigation";
import {
  exchangeRemoteMicJoinToken,
  remoteMicErrorResponse,
  setRemoteMicCookie,
} from "../../../lib/remote-mic/token-service";

type PageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function RemoteMicJoinPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const token = searchParams.token?.trim() ?? "";

  if (!token) {
    return <JoinError message="QRコードの情報が見つかりません。PC画面から新しいQRコードを発行してください。" />;
  }

  try {
    const session = await exchangeRemoteMicJoinToken(token);
    await setRemoteMicCookie(session);
  } catch (error) {
    const response = remoteMicErrorResponse(error);

    return <JoinError message={response.message} />;
  }

  redirect("/mic");
}

function JoinError(props: { message: string }) {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
          Remote microphone
        </div>
        <h1 className="mt-1 text-[22px] font-black leading-tight">
          QRコード確認
        </h1>
        <p className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] font-bold text-red-700">
          {props.message}
        </p>
      </section>
    </main>
  );
}

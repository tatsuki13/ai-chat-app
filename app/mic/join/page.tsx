import { Suspense } from "react";
import RemoteMicJoinClient from "./remote-mic-join-client";

export default function RemoteMicJoinPage() {
  return (
    <Suspense fallback={<JoinFallback />}>
      <RemoteMicJoinClient />
    </Suspense>
  );
}

function JoinFallback() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
          Remote microphone
        </div>
        <h1 className="mt-1 text-[22px] font-black leading-tight">
          QRコード確認
        </h1>
        <p className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-[13px] font-bold text-emerald-800">
          QRコードを確認しています。
        </p>
      </section>
    </main>
  );
}

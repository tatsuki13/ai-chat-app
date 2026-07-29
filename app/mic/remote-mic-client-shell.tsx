"use client";

import dynamic from "next/dynamic";

const RemoteMicClient = dynamic(() => import("./remote-mic-client"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <p className="text-[13px] font-bold text-stone-600">
          スマートフォンの接続環境を確認しています。
        </p>
      </section>
    </main>
  ),
});

export default function RemoteMicClientShell() {
  return <RemoteMicClient />;
}

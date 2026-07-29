"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type JoinState = "checking" | "success" | "error";

export default function RemoteMicJoinClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<JoinState>("checking");
  const [message, setMessage] = useState("QRコードを確認しています。");

  useEffect(() => {
    const token = searchParams.get("token")?.trim() ?? "";
    if (!token) {
      setState("error");
      setMessage("QRコードの情報が見つかりません。PC画面から新しいQRコードを発行してください。");
      return;
    }

    async function exchangeToken() {
      try {
        const response = await fetch("/api/remote-mic/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!response.ok) {
          throw new Error("このQRコードは期限切れ、または使用済みです。");
        }

        window.history.replaceState(null, "", "/mic");
        setState("success");
        setMessage("認証が完了しました。マイク画面へ移動します。");
        router.replace("/mic");
      } catch (error) {
        setState("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "QRコードを確認できませんでした。",
        );
      }
    }

    void exchangeToken();
  }, [router, searchParams]);

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[12px] font-black uppercase tracking-[0.08em] text-stone-500">
          Remote microphone
        </div>
        <h1 className="mt-1 text-[22px] font-black leading-tight">
          QRコード確認
        </h1>
        <p
          className={`mt-4 rounded-md border px-3 py-2 text-[13px] font-bold ${
            state === "error"
              ? "border-red-100 bg-red-50 text-red-700"
              : "border-emerald-100 bg-emerald-50 text-emerald-800"
          }`}
        >
          {message}
        </p>
      </section>
    </main>
  );
}

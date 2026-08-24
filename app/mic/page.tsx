export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RemoteMicPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-5 text-stone-950">
      <section className="mx-auto max-w-md rounded-md border border-stone-300 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-black uppercase tracking-[0.08em] text-stone-500">
          Fixed Mic
        </div>
        <h1 className="mt-1 text-[22px] font-black leading-tight">
          スマートフォンマイク
        </h1>
        <div className="mt-4 grid gap-2">
          <a
            href="/mic/elder"
            className="flex min-h-14 items-center justify-center rounded-md bg-stone-950 px-4 text-[15px] font-black text-white active:scale-[0.99]"
          >
            本人用マイクを開く
          </a>
          <a
            href="/mic/caregiver"
            className="flex min-h-14 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-[15px] font-black text-stone-800 active:scale-[0.99]"
          >
            介護者用マイクを開く
          </a>
        </div>
        <p className="mt-4 text-[12px] font-bold leading-relaxed text-stone-500">
          PC側で /session を開いてから、使用するスマホに対応したマイクを選んでください。
        </p>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { PlayActions } from "@/components/play/PlayActions";

export const metadata: Metadata = {
  title: "Play",
  description: "Jump into the Paradox Squad practice range or start a private match with friends.",
};

export default function PlayHub() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <Link href="/" className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-300/80">
        ← Paradox Squad
      </Link>
      <h1 className="text-4xl font-bold tracking-tight">Choose your deployment</h1>
      <PlayActions />
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/play/practice" className="group rounded-xl border border-white/10 bg-white/5 p-6 transition hover:border-cyan-300/60 hover:bg-white/10">
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-300">Solo</div>
          <div className="mt-2 text-2xl font-semibold">Practice range</div>
          <p className="mt-2 text-sm text-white/60">Tune your sensitivity, learn recoil patterns and movement on the Foundry greybox.</p>
        </Link>
      </div>
    </main>
  );
}

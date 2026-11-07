"use client";

import { isValidInviteCode, normalizeInviteCode } from "@paradox/shared";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { BotDifficulty } from "@/game/net/NetClient";
import { openSession } from "@/game/net/sessions";
import { useSettings } from "@/stores/settings";

type Busy = null | "create" | "quick" | "join" | "ai";

const DIFFICULTIES: BotDifficulty[] = ["easy", "normal", "hard", "insane"];

export function PlayActions() {
  const router = useRouter();
  const name = useSettings((s) => s.playerName);
  const set = useSettings((s) => s.set);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<BotDifficulty>("normal");

  const run = async (kind: "create" | "quick" | "ai") => {
    setBusy(kind);
    setError(null);
    try {
      const net = await openSession(kind === "ai" ? { kind, difficulty } : { kind });
      router.push(`/play/${net.code}`);
    } catch (e) {
      setError(e instanceof Error && e.message ? `Could not reach the game server (${e.message}).` : "Could not reach the game server.");
      setBusy(null);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeInviteCode(code);
    if (!isValidInviteCode(c)) {
      setError("Invite codes are 6 letters/numbers, e.g. K7QF2M.");
      return;
    }
    setBusy("join");
    router.push(`/play/${c}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-mono text-xs uppercase tracking-[0.25em] text-white/50">Callsign</span>
        <input
          value={name}
          maxLength={20}
          placeholder="Agent"
          onChange={(e) => set({ playerName: e.target.value })}
          className="rounded-md border border-white/15 bg-black/40 px-3 py-2 outline-none focus:border-cyan-300"
        />
      </label>
      <div className="rounded-xl border border-lime-300/40 bg-lime-400/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.25em] text-lime-300">Solo · instant</div>
            <div className="mt-1 text-xl font-semibold">Play vs AI</div>
            <p className="mt-1 text-sm text-white/60">4v4 Team Deathmatch with bot teammates and bot enemies. Starts immediately.</p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("ai")}
            className="rounded-md bg-lime-400 px-6 py-3 font-mono text-sm font-bold uppercase tracking-widest text-black transition hover:bg-lime-300 disabled:opacity-50"
          >
            {busy === "ai" ? "Deploying…" : "Play vs AI"}
          </button>
        </div>
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Bot difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={`rounded px-3 py-1 font-mono text-xs uppercase tracking-widest ${difficulty === d ? "bg-lime-300 text-black" : "bg-white/10 text-white/70 hover:bg-white/20"}`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("create")}
          className="rounded-xl border border-cyan-300/40 bg-cyan-400/10 p-5 text-left transition hover:bg-cyan-400/20 disabled:opacity-50"
        >
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-300">With friends</div>
          <div className="mt-1 text-xl font-semibold">{busy === "create" ? "Creating…" : "Create private match"}</div>
          <p className="mt-1 text-sm text-white/60">Get a 6-letter code and a link to share. Team Deathmatch, up to 4v4.</p>
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("quick")}
          className="rounded-xl border border-white/10 bg-white/5 p-5 text-left transition hover:bg-white/10 disabled:opacity-50"
        >
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-orange-300">Public</div>
          <div className="mt-1 text-xl font-semibold">{busy === "quick" ? "Finding a match…" : "Quick play"}</div>
          <p className="mt-1 text-sm text-white/60">Join an open Team Deathmatch in your region.</p>
        </button>
      </div>
      <form onSubmit={join} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Invite code"
          maxLength={8}
          className="flex-1 rounded-md border border-white/15 bg-black/40 px-3 py-2 font-mono uppercase tracking-[0.3em] outline-none focus:border-cyan-300"
        />
        <button type="submit" disabled={busy !== null} className="rounded-md bg-white/10 px-5 font-mono text-sm uppercase tracking-widest hover:bg-white/20 disabled:opacity-50">
          Join
        </button>
      </form>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}

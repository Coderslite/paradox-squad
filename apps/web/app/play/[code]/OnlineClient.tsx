"use client";

import { isValidInviteCode, normalizeInviteCode } from "@paradox/shared";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { InviteBox, MatchHud } from "@/components/hud/MatchHud";
import type { NetClient } from "@/game/net/NetClient";
import { acquireSession, releaseSession } from "@/game/net/sessions";
import { patchUi } from "@/stores/ui";

const PlayScreen = dynamic(() => import("@/components/game/PlayScreen").then((m) => m.PlayScreen), { ssr: false });

export function OnlineClient({ code: raw }: { code: string }) {
  const code = normalizeInviteCode(raw);
  const valid = isValidInviteCode(code);
  const [net, setNet] = useState<NetClient | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    patchUi({ loading: true, loadingText: "Connecting", error: null, connection: "connecting" });
    acquireSession(code)
      .then((n) => {
        if (alive) setNet(n);
      })
      .catch(() => {
        if (alive) setError("That match doesn't exist any more, or it's full.");
      });
    return () => {
      alive = false;
      releaseSession(code);
    };
  }, [code, valid]);

  if (!valid || error) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">{valid ? "Can't join this match" : "That invite code looks wrong"}</h1>
        <p className="max-w-md text-white/60">{error ?? `"${raw}" isn't a valid 6-character code.`}</p>
        <Link href="/play" className="rounded-md bg-cyan-400 px-6 py-2 font-mono text-sm font-bold uppercase tracking-widest text-black">
          Back to play
        </Link>
      </main>
    );
  }
  if (!net) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#05070a]">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
        <p className="mt-4 font-mono text-sm uppercase tracking-[0.3em] text-white/70">Joining {code}</p>
      </div>
    );
  }
  return (
    <PlayScreen net={net} title="Team Deathmatch" subtitle={<InviteBox code={code} />}>
      <MatchHud />
    </PlayScreen>
  );
}

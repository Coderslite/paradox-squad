"use client";

import { useEffect, useState } from "react";
import { getSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";

const TEAM = [
  { name: "Chrono", text: "text-sky-300", bg: "bg-sky-400" },
  { name: "Rift", text: "text-orange-300", bg: "bg-orange-400" },
];

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Online-only HUD: score bar, timer, scoreboard (Tab), connection status, respawn banner. */
export function MatchHud() {
  const [a, b] = useUi((s) => s.teamScores);
  const limit = useUi((s) => s.scoreLimit);
  const time = useUi((s) => s.matchTimeLeft);
  const phase = useUi((s) => s.phase);
  const myTeam = useUi((s) => s.localTeam);
  const alive = useUi((s) => s.alive);
  const connection = useUi((s) => s.connection);
  const [showBoard, setShowBoard] = useState(false);

  useEffect(() => {
    const isBoard = (e: KeyboardEvent) => getSettings().bindings.scoreboard.includes(e.code);
    const down = (e: KeyboardEvent) => {
      if (isBoard(e)) setShowBoard(true);
    };
    const up = (e: KeyboardEvent) => {
      if (isBoard(e)) setShowBoard(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const winner = a === b ? null : a > b ? 0 : 1;
  return (
    <>
      <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-4 font-mono">
        <Score team={0} score={a} limit={limit} mine={myTeam === 0} />
        <div className="min-w-16 text-center text-lg tabular-nums text-white/90">{fmtTime(time)}</div>
        <Score team={1} score={b} limit={limit} mine={myTeam === 1} />
      </div>
      <NetIndicator />
      {connection === "reconnecting" && (
        <Banner className="top-24 bg-amber-500/90 text-black">Connection lost — reconnecting…</Banner>
      )}
      {!alive && phase === "playing" && <Banner className="top-1/3 bg-black/60">Eliminated — redeploying</Banner>}
      {phase === "ended" && (
        <Banner className="top-1/4 bg-black/70 px-10 py-6 text-2xl">
          {winner === null ? "Draw" : winner === myTeam ? "Victory" : "Defeat"}
          <div className="mt-1 text-sm text-white/60">Next match in {time}s</div>
        </Banner>
      )}
      {(showBoard || phase === "ended") && <Scoreboard />}
    </>
  );
}

function Score({ team, score, limit, mine }: { team: 0 | 1; score: number; limit: number; mine: boolean }) {
  const t = TEAM[team]!;
  return (
    <div className={`flex w-36 flex-col ${team === 0 ? "items-end" : "items-start"}`}>
      <div className={`text-xs uppercase tracking-[0.25em] ${t.text}`}>
        {t.name}
        {mine ? " · you" : ""}
      </div>
      <div className="text-2xl font-bold tabular-nums text-white">{score}</div>
      <div className="h-1 w-full overflow-hidden rounded bg-white/10">
        <div className={`h-full ${t.bg} ${team === 0 ? "ml-auto" : ""}`} style={{ width: `${Math.min(100, (score / Math.max(1, limit)) * 100)}%` }} />
      </div>
    </div>
  );
}

function Scoreboard() {
  const rows = useUi((s) => s.scoreboard);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="grid w-full max-w-3xl grid-cols-2 gap-4 rounded-xl bg-black/75 p-6 font-mono text-sm backdrop-blur">
        {[0, 1].map((team) => (
          <div key={team}>
            <div className={`mb-2 text-xs uppercase tracking-[0.25em] ${TEAM[team]!.text}`}>{TEAM[team]!.name}</div>
            <div className="grid grid-cols-[1fr_3rem_3rem_3.5rem] gap-y-1 text-white/50">
              <span>Agent</span>
              <span className="text-right">K</span>
              <span className="text-right">D</span>
              <span className="text-right">Ping</span>
            </div>
            {rows
              .filter((r) => r.team === team)
              .map((r) => (
                <div key={r.id} className={`grid grid-cols-[1fr_3rem_3rem_3.5rem] py-1 ${r.local ? "text-cyan-200" : "text-white"}`}>
                  <span className="flex items-center gap-1.5 truncate">
                    {r.bot && (
                      <span title="Bot" className="rounded bg-white/15 px-1 text-[9px] font-bold leading-4 tracking-wider text-white/70">
                        BOT
                      </span>
                    )}
                    {r.name}
                  </span>
                  <span className="text-right tabular-nums">{r.kills}</span>
                  <span className="text-right tabular-nums">{r.deaths}</span>
                  <span className="text-right tabular-nums text-white/60">{r.ping}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small always-on network quality dot (detail in F3). */
function NetIndicator() {
  const rows = useUi((s) => s.scoreboard);
  const me = rows.find((r) => r.local);
  const ping = me?.ping ?? 0;
  const color = ping === 0 ? "bg-white/30" : ping < 80 ? "bg-lime-400" : ping < 150 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="pointer-events-none absolute bottom-28 left-10 flex items-center gap-2 font-mono text-xs text-white/60">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {ping ? `${ping} ms` : "—"}
    </div>
  );
}

function Banner({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <div className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-md px-5 py-2 text-center font-mono uppercase tracking-[0.2em] ${className}`}>
      {children}
    </div>
  );
}

/** Invite link + code with copy button (shown in the pause menu). */
export function InviteBox({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pointer-events-auto flex flex-col gap-2">
      <div className="font-mono text-xs uppercase tracking-[0.25em] text-white/50">Invite code</div>
      <div className="font-mono text-2xl font-bold tracking-[0.35em] text-cyan-200">{code}</div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(`${window.location.origin}/play/${code}`).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="rounded bg-white/10 px-3 py-1.5 font-mono text-xs uppercase tracking-widest hover:bg-white/20"
      >
        {copied ? "Link copied" : "Copy invite link"}
      </button>
    </div>
  );
}

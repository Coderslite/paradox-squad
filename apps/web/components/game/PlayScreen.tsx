"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { Game } from "@/game/core/Game";
import type { NetSession } from "@/game/net/types";
import { detectQuality } from "@/game/render/quality";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { Crosshair } from "../hud/Crosshair";
import { AmmoPanel, DamageIndicators, DamageNumbers, DebugOverlay, HealthPanel, KillFeed } from "../hud/HudPanels";
import { PauseMenu } from "../menus/PauseMenu";

const GameCanvas = dynamic(() => import("./GameCanvas"), { ssr: false });

type Support = "ok" | "no-webgl2";

function detectSupport(): Support {
  const gl = document.createElement("canvas").getContext("webgl2");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl ? "ok" : "no-webgl2";
}

interface Props {
  net: NetSession | null;
  title: string;
  subtitle?: ReactNode;
  /** Extra HUD for online play (scoreboard, match timer…). */
  children?: ReactNode;
}

export function PlayScreen({ net, title, subtitle, children }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  // Client-only component (loaded with ssr: false), so browser APIs are safe here.
  const [support] = useState<Support>(detectSupport);
  const [qualityReady, setQualityReady] = useState(false);
  const loading = useUi((s) => s.loading);
  const loadingText = useUi((s) => s.loadingText);
  const paused = useUi((s) => s.paused);
  const error = useUi((s) => s.error);
  const alive = useUi((s) => s.alive);

  useEffect(() => {
    // First launch: pick a preset from the GPU tier before the renderer is created.
    const finish = () => setQualityReady(true);
    if (useSettings.persist.hasHydrated()) {
      if (useSettings.getState().qualityDetected) finish();
      else
        void detectQuality().then((q) => {
          useSettings.getState().set({ quality: q, qualityDetected: true });
          finish();
        });
    } else {
      const off = useSettings.persist.onFinishHydration((s) => {
        off();
        if (s.qualityDetected) finish();
        else
          void detectQuality().then((q) => {
            useSettings.getState().set({ quality: q, qualityDetected: true });
            finish();
          });
      });
    }
  }, []);

  if (support === "no-webgl2") {
    return (
      <Centered>
        <h1 className="text-2xl font-bold">Your browser can&apos;t run Paradox Squad</h1>
        <p className="mt-3 max-w-md text-white/70">
          The game needs WebGL 2 (Chrome, Edge, Firefox or Safari 15+ with hardware acceleration enabled). Check that graphics acceleration is turned on in your
          browser settings and try again.
        </p>
      </Centered>
    );
  }

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black">
      {support === "ok" && qualityReady && <GameCanvas net={net} onGame={setGame} />}
      {!loading && (
        <>
          <Crosshair />
          <DamageIndicators />
          <DamageNumbers />
          <HealthPanel />
          <AmmoPanel />
          <KillFeed />
          {children}
        </>
      )}
      <DebugOverlay />
      {(loading || !qualityReady) && !error && (
        <Centered>
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-300/30 border-t-cyan-300" />
          <p className="mt-4 font-mono text-sm uppercase tracking-[0.3em] text-white/70">{loadingText}</p>
        </Centered>
      )}
      {error && (
        <Centered>
          <h1 className="text-xl font-bold text-red-300">Something went wrong</h1>
          <p className="mt-2 max-w-md text-white/70">{error}</p>
          <Link href="/play" className="mt-6 rounded bg-white/10 px-4 py-2 font-mono text-sm uppercase tracking-widest hover:bg-white/20">
            Back
          </Link>
        </Centered>
      )}
      {!loading && !error && paused && (
        <PauseMenu title={title} subtitle={subtitle} resumeLabel={alive ? "Deploy" : "Spectate"} onResume={() => game?.requestPlay()} />
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#05070a] text-center text-white">{children}</div>;
}

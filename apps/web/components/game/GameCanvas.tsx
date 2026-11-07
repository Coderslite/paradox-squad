"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Game } from "@/game/core/Game";
import type { NetSession } from "@/game/net/types";
import { QUALITY } from "@/game/render/quality";
import { useSettings } from "@/stores/settings";
import { patchUi } from "@/stores/ui";

interface Props {
  net: NetSession | null;
  onGame: (game: Game | null) => void;
}

/**
 * Client-only R3F host for the game. React renders this once; all per-frame work
 * happens in Game.frame() via a single useFrame. Changing the quality preset remounts
 * the canvas (MSAA cannot be toggled on a live WebGL context).
 */
export default function GameCanvas({ net, onGame }: Props) {
  const quality = useSettings((s) => s.quality);
  const cfg = QUALITY[quality];
  return (
    <Canvas
      key={quality}
      className="!absolute inset-0"
      gl={{ antialias: cfg.antialias, powerPreference: "high-performance", stencil: false, alpha: false }}
      dpr={1}
      flat
      camera={{ fov: 70, near: 0.05, far: 600, position: [0, 2, 0] }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color(0x0b0d10));
      }}
    >
      <GameDriver net={net} onGame={onGame} />
    </Canvas>
  );
}

function GameDriver({ net, onGame }: Props) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const setDpr = useThree((s) => s.setDpr);
  const size = useThree((s) => s.size);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    const game = new Game({ renderer: gl, scene, camera, canvas: gl.domElement, net, setPixelRatio: setDpr });
    gameRef.current = game;
    let cancelled = false;
    game
      .init()
      .then(() => {
        if (cancelled) return;
        onGame(game);
        // Dev-only handle for automated tests and console debugging.
        if (process.env.NODE_ENV !== "production") (window as unknown as { __paradox?: Game }).__paradox = game;
      })
      .catch((err: unknown) => {
        console.error(err);
        patchUi({ error: err instanceof Error ? err.message : "Failed to start the game" });
      });
    return () => {
      cancelled = true;
      gameRef.current = null;
      onGame(null);
      game.dispose();
    };
  }, [gl, scene, camera, net, setDpr, onGame]);

  useEffect(() => {
    gameRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  // Positive priority: R3F stops auto-rendering; Game renders world + viewmodel passes itself.
  useFrame((_, delta) => gameRef.current?.frame(delta), 1);
  return null;
}

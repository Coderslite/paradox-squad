"use client";

import { create } from "zustand";

export type ConnectionState = "offline" | "connecting" | "connected" | "reconnecting" | "failed";

export interface ScoreRow {
  id: string;
  name: string;
  team: number;
  kills: number;
  deaths: number;
  ping: number;
  local: boolean;
  bot: boolean;
}

/** Low-frequency game state mirrored for the HUD. Written by the game on change only. */
export interface UiState {
  loading: boolean;
  loadingText: string;
  pointerLocked: boolean;
  paused: boolean;
  alive: boolean;
  respawnIn: number;
  health: number;
  weaponName: string;
  ammo: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  connection: ConnectionState;
  roomCode: string | null;
  mode: "practice" | "online";
  teamScores: [number, number];
  scoreLimit: number;
  localTeam: number;
  scoreboard: ScoreRow[];
  showScoreboard: boolean;
  matchTimeLeft: number;
  phase: string;
  error: string | null;
}

export const useUi = create<UiState>()(() => ({
  loading: true,
  loadingText: "Loading",
  pointerLocked: false,
  paused: true,
  alive: true,
  respawnIn: 0,
  health: 100,
  weaponName: "",
  ammo: 0,
  magSize: 0,
  reserve: 0,
  reloading: false,
  connection: "offline",
  roomCode: null,
  mode: "practice",
  teamScores: [0, 0],
  scoreLimit: 50,
  localTeam: 0,
  scoreboard: [],
  showScoreboard: false,
  matchTimeLeft: 0,
  phase: "playing",
  error: null,
}));

/** Set only the fields that actually changed (avoids pointless subscriber work). */
export function patchUi(patch: Partial<UiState>): void {
  const cur = useUi.getState() as unknown as Record<string, unknown>;
  let changed = false;
  for (const k in patch) {
    if (cur[k] !== (patch as Record<string, unknown>)[k]) {
      changed = true;
      break;
    }
  }
  if (changed) useUi.setState(patch);
}

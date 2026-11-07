"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type QualityPreset = "low" | "medium" | "high" | "ultra";

export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "crouch"
  | "sprint"
  | "reload"
  | "primary"
  | "secondary"
  | "rewind"
  | "echo"
  | "ability"
  | "interact"
  | "scoreboard"
  | "shoulder"
  | "view";

/** KeyboardEvent.code values (layout independent), plus "Mouse0".."Mouse4". */
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  forward: ["KeyW"],
  back: ["KeyS"],
  left: ["KeyA"],
  right: ["KeyD"],
  jump: ["Space"],
  crouch: ["KeyC", "ControlLeft"],
  sprint: ["ShiftLeft"],
  reload: ["KeyR"],
  primary: ["Digit1"],
  secondary: ["Digit2"],
  rewind: ["KeyZ"],
  echo: ["KeyE"],
  ability: ["KeyF"],
  interact: ["KeyG"],
  scoreboard: ["Tab"],
  shoulder: ["KeyQ", "Mouse1"],
  view: ["KeyV"],
};

export interface Settings {
  sensitivity: number;
  adsSensitivity: number;
  /** Horizontal FOV in degrees at 16:9. */
  fov: number;
  invertY: boolean;
  rawInput: boolean;
  toggleAds: boolean;
  quality: QualityPreset;
  qualityDetected: boolean;
  dynamicResolution: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  damageNumbers: boolean;
  reducedViolence: boolean;
  cameraBob: boolean;
  crosshairColor: string;
  crosshairSize: number;
  crosshairGap: number;
  crosshairDot: boolean;
  bindings: Bindings;
  playerName: string;
  /** Over-the-shoulder third person (default) or first person. */
  cameraMode: "third" | "first";
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 2.5,
  adsSensitivity: 0.85,
  fov: 100,
  invertY: false,
  rawInput: true,
  toggleAds: false,
  quality: "medium",
  qualityDetected: false,
  dynamicResolution: true,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.5,
  damageNumbers: true,
  reducedViolence: false,
  cameraBob: true,
  crosshairColor: "#e8fff8",
  crosshairSize: 7,
  crosshairGap: 4,
  crosshairDot: true,
  bindings: DEFAULT_BINDINGS,
  playerName: "",
  cameraMode: "third",
};

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  bind: (action: Action, code: string) => void;
  reset: () => void;
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      bind: (action, code) =>
        set((s) => {
          // A key can only drive one action: remove it from others first.
          const bindings = { ...s.bindings };
          for (const a of Object.keys(bindings) as Action[]) bindings[a] = bindings[a].filter((c) => c !== code);
          bindings[action] = [code];
          return { bindings };
        }),
      reset: () => set({ ...DEFAULT_SETTINGS, qualityDetected: true }),
    }),
    {
      name: "paradox-settings",
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Settings>;
        return { ...current, ...p, bindings: { ...DEFAULT_BINDINGS, ...(p.bindings ?? {}) } };
      },
    },
  ),
);

/** Non-React read for the game loop. */
export const getSettings = (): Settings => useSettings.getState();

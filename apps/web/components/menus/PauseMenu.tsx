"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_BINDINGS, useSettings, type Action, type QualityPreset } from "@/stores/settings";

const ACTION_LABELS: Record<Action, string> = {
  forward: "Move forward",
  back: "Move back",
  left: "Strafe left",
  right: "Strafe right",
  jump: "Jump / mantle",
  crouch: "Crouch / slide",
  sprint: "Sprint",
  reload: "Reload",
  primary: "Primary weapon",
  secondary: "Secondary weapon",
  rewind: "Personal Rewind",
  echo: "Record / deploy Echo",
  ability: "Agent ability",
  interact: "Interact",
  scoreboard: "Scoreboard",
  shoulder: "Swap shoulder",
  view: "First / third person",
};

type Tab = "game" | "controls" | "video" | "audio";

interface Props {
  title: string;
  subtitle?: ReactNode;
  resumeLabel: string;
  onResume: () => void;
  leaveHref?: string;
}

export function PauseMenu({ title, subtitle, resumeLabel, onResume, leaveHref = "/play" }: Props) {
  const [tab, setTab] = useState<Tab | null>(null);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-20 flex items-center justify-center bg-[#05070a]/70 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-4xl gap-6 px-6">
        <div className="flex w-64 shrink-0 flex-col gap-2">
          <h1 className="mb-1 font-mono text-2xl font-bold uppercase tracking-[0.2em] text-white">{title}</h1>
          {subtitle && <div className="mb-3 text-sm text-white/60">{subtitle}</div>}
          <MenuButton primary onClick={onResume}>
            {resumeLabel}
          </MenuButton>
          <MenuButton onClick={() => setTab(tab === "game" ? null : "game")} active={tab === "game"}>
            Gameplay
          </MenuButton>
          <MenuButton onClick={() => setTab(tab === "controls" ? null : "controls")} active={tab === "controls"}>
            Controls
          </MenuButton>
          <MenuButton onClick={() => setTab(tab === "video" ? null : "video")} active={tab === "video"}>
            Graphics
          </MenuButton>
          <MenuButton onClick={() => setTab(tab === "audio" ? null : "audio")} active={tab === "audio"}>
            Audio
          </MenuButton>
          <Link href={leaveHref} className="mt-4 rounded border border-white/10 px-4 py-2 text-center font-mono text-sm uppercase tracking-widest text-white/70 hover:bg-white/10">
            Leave
          </Link>
        </div>
        <div className="min-h-[420px] flex-1">
          {tab === "game" && <GameplaySettings />}
          {tab === "controls" && <ControlsSettings />}
          {tab === "video" && <VideoSettings />}
          {tab === "audio" && <AudioSettings />}
          {tab === null && <ControlsCheatSheet />}
        </div>
      </div>
    </motion.div>
  );
}

function MenuButton({ children, onClick, primary, active }: { children: ReactNode; onClick: () => void; primary?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-4 py-2.5 text-left font-mono text-sm uppercase tracking-widest transition ${
        primary ? "bg-cyan-400 text-black hover:bg-cyan-300" : active ? "bg-white/20 text-white" : "bg-white/5 text-white/80 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-black/50 p-5 text-sm text-white/90">{children}</div>;
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="grid grid-cols-[180px_1fr_60px] items-center gap-3">
      <span className="text-white/70">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-cyan-400" />
      <span className="text-right font-mono tabular-nums">{format ? format(value) : value}</span>
    </label>
  );
}

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-white/70">
        {label}
        {hint && <span className="block text-xs text-white/40">{hint}</span>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-cyan-400" />
    </label>
  );
}

function GameplaySettings() {
  const s = useSettings();
  return (
    <Panel>
      <Slider label="Sensitivity" value={s.sensitivity} min={0.2} max={8} step={0.05} onChange={(v) => s.set({ sensitivity: v })} format={(v) => v.toFixed(2)} />
      <Slider label="ADS sensitivity" value={s.adsSensitivity} min={0.3} max={1.5} step={0.01} onChange={(v) => s.set({ adsSensitivity: v })} format={(v) => v.toFixed(2)} />
      <Slider label="Field of view" value={s.fov} min={80} max={120} step={1} onChange={(v) => s.set({ fov: v })} format={(v) => `${v}°`} />
      <Toggle label="Invert Y" value={s.invertY} onChange={(v) => s.set({ invertY: v })} />
      <Toggle label="Raw mouse input" hint="Unaccelerated pointer lock where the browser supports it" value={s.rawInput} onChange={(v) => s.set({ rawInput: v })} />
      <Toggle label="Toggle ADS" value={s.toggleAds} onChange={(v) => s.set({ toggleAds: v })} />
      <Toggle label="Third-person camera" hint="Over the shoulder. Press V in game to switch" value={s.cameraMode === "third"} onChange={(v) => s.set({ cameraMode: v ? "third" : "first" })} />
      <Toggle label="Camera bob" value={s.cameraBob} onChange={(v) => s.set({ cameraBob: v })} />
      <Toggle label="Damage numbers" value={s.damageNumbers} onChange={(v) => s.set({ damageNumbers: v })} />
      <Toggle label="Reduced violence" hint="No blood; hits show time shards" value={s.reducedViolence} onChange={(v) => s.set({ reducedViolence: v })} />
      <div className="grid grid-cols-[180px_1fr] items-center gap-3">
        <span className="text-white/70">Crosshair colour</span>
        <input type="color" value={s.crosshairColor} onChange={(e) => s.set({ crosshairColor: e.target.value })} className="h-7 w-16 bg-transparent" />
      </div>
      <Slider label="Crosshair length" value={s.crosshairSize} min={2} max={16} step={1} onChange={(v) => s.set({ crosshairSize: v })} />
      <Slider label="Crosshair gap" value={s.crosshairGap} min={0} max={14} step={1} onChange={(v) => s.set({ crosshairGap: v })} />
      <Toggle label="Centre dot" value={s.crosshairDot} onChange={(v) => s.set({ crosshairDot: v })} />
    </Panel>
  );
}

function ControlsSettings() {
  const bindings = useSettings((s) => s.bindings);
  const bind = useSettings((s) => s.bind);
  const set = useSettings((s) => s.set);
  const [listening, setListening] = useState<Action | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") bind(listening, e.code);
      setListening(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening, bind]);

  return (
    <Panel>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <div key={a} className="flex items-center justify-between gap-2">
            <span className="text-white/70">{ACTION_LABELS[a]}</span>
            <button
              type="button"
              onClick={() => setListening(a)}
              className={`min-w-24 rounded px-2 py-1 font-mono text-xs ${listening === a ? "bg-cyan-400 text-black" : "bg-white/10 hover:bg-white/20"}`}
            >
              {listening === a ? "press a key" : bindings[a].map(prettyKey).join(" / ") || "—"}
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>Fire: left mouse / RT · Aim: right mouse / LT · Gamepad supported (standard mapping)</span>
        <button type="button" className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => set({ bindings: DEFAULT_BINDINGS })}>
          Reset
        </button>
      </div>
    </Panel>
  );
}

function VideoSettings() {
  const quality = useSettings((s) => s.quality);
  const dyn = useSettings((s) => s.dynamicResolution);
  const set = useSettings((s) => s.set);
  return (
    <Panel>
      <div className="grid grid-cols-4 gap-2">
        {(["low", "medium", "high", "ultra"] as QualityPreset[]).map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => set({ quality: q })}
            className={`rounded px-3 py-2 font-mono text-xs uppercase tracking-widest ${quality === q ? "bg-cyan-400 text-black" : "bg-white/10 hover:bg-white/20"}`}
          >
            {q}
          </button>
        ))}
      </div>
      <p className="text-xs text-white/50">Changing the preset reloads the renderer (a second or two).</p>
      <Toggle label="Dynamic resolution" hint="Lowers render scale under load to hold 60 FPS" value={dyn} onChange={(v) => set({ dynamicResolution: v })} />
      <p className="text-xs text-white/50">Press F3 in game for the performance overlay.</p>
    </Panel>
  );
}

function AudioSettings() {
  const s = useSettings();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Panel>
      <Slider label="Master" value={s.masterVolume} min={0} max={1} step={0.01} onChange={(v) => s.set({ masterVolume: v })} format={pct} />
      <Slider label="Effects" value={s.sfxVolume} min={0} max={1} step={0.01} onChange={(v) => s.set({ sfxVolume: v })} format={pct} />
      <Slider label="Music" value={s.musicVolume} min={0} max={1} step={0.01} onChange={(v) => s.set({ musicVolume: v })} format={pct} />
    </Panel>
  );
}

function ControlsCheatSheet() {
  const b = useSettings((s) => s.bindings);
  const k = (a: Action) => b[a].map(prettyKey).join(" / ");
  const rows: [string, string][] = [
    [`${k("forward")} ${k("left")} ${k("back")} ${k("right")}`, "Move"],
    ["Mouse", "Look"],
    ["Left mouse", "Fire"],
    ["Right mouse", "Aim down sights"],
    [k("sprint"), "Sprint"],
    [k("jump"), "Jump · into ledges to mantle"],
    [k("crouch"), "Crouch · while sprinting to slide"],
    [k("reload"), "Reload"],
    [k("shoulder"), "Swap shoulder (third person)"],
    [k("view"), "First / third person"],
    [`${k("primary")} / ${k("secondary")} / wheel`, "Switch weapon"],
    ["Esc", "Pause"],
    ["F3", "Performance overlay"],
  ];
  return (
    <Panel>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-6 gap-y-2">
        {rows.map(([key, what]) => (
          <div key={what} className="contents">
            <span className="font-mono text-xs text-cyan-200">{key}</span>
            <span className="text-white/70">{what}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function prettyKey(code: string): string {
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("ShiftLeft", "L-Shift")
    .replace("ControlLeft", "L-Ctrl")
    .replace("Space", "Space")
    .replace("Mouse1", "Middle mouse");
}

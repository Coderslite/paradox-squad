"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { gameBus, type GameEvents } from "@/game/core/events";
import { hudDom } from "@/game/core/hudDom";
import { useUi } from "@/stores/ui";

export function AmmoPanel() {
  const ammo = useUi((s) => s.ammo);
  const mag = useUi((s) => s.magSize);
  const reserve = useUi((s) => s.reserve);
  const name = useUi((s) => s.weaponName);
  const reloading = useUi((s) => s.reloading);
  const low = mag > 0 && ammo <= Math.ceil(mag * 0.25);
  return (
    <div className="pointer-events-none absolute bottom-8 right-10 text-right font-mono text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
      <div className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">{name}</div>
      <div className="flex items-baseline justify-end gap-2">
        <span className={`text-5xl font-bold tabular-nums ${low ? "text-amber-300" : ""}`}>{ammo}</span>
        <span className="text-xl tabular-nums text-white/60">/ {reserve}</span>
      </div>
      {reloading && <div className="text-xs uppercase tracking-widest text-cyan-300">Reloading</div>}
    </div>
  );
}

export function HealthPanel() {
  const health = useUi((s) => s.health);
  const pct = Math.max(0, Math.min(100, health));
  return (
    <div className="pointer-events-none absolute bottom-8 left-10 w-64 font-mono text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums">{Math.ceil(health)}</span>
        <span className="text-xs uppercase tracking-[0.25em] text-white/60">Integrity</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-white/15">
        <div className={`h-full transition-[width] duration-150 ${pct < 35 ? "bg-red-400" : "bg-cyan-300"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface FeedItem extends Omit<GameEvents["killfeed"], never> {
  id: number;
}

export function KillFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  useEffect(() => {
    let id = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = gameBus.on("killfeed", (e) => {
      const item = { ...e, id: id++ };
      setItems((list) => [...list.slice(-4), item]);
      const t = setTimeout(() => {
        setItems((list) => list.filter((x) => x.id !== item.id));
        timers.delete(t);
      }, 5000);
      timers.add(t);
    });
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, []);
  return (
    <div className="pointer-events-none absolute right-6 top-6 flex flex-col items-end gap-1 font-mono text-sm">
      <AnimatePresence initial={false}>
        {items.map((k) => (
          <motion.div
            key={k.id}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded px-2 py-1 backdrop-blur-sm ${k.local ? "bg-cyan-500/25 ring-1 ring-cyan-300/50" : "bg-black/40"}`}
          >
            <span className={k.local === "killer" ? "text-cyan-200" : "text-white"}>{k.killer}</span>
            <span className="mx-2 text-white/50">[{k.weapon}{k.head ? " ⌖" : ""}]</span>
            <span className={k.local === "victim" ? "text-red-300" : "text-white"}>{k.victim}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

interface DmgNum {
  id: number;
  sx: number;
  sy: number;
  damage: number;
  head: boolean;
}

export function DamageNumbers() {
  const [nums, setNums] = useState<DmgNum[]>([]);
  useEffect(() => {
    let id = 0;
    const off = gameBus.on("damageNumber", (e) => {
      const n = { ...e, id: id++, sx: e.sx + (Math.random() - 0.5) * 0.02 };
      setNums((l) => [...l.slice(-12), n]);
      setTimeout(() => setNums((l) => l.filter((x) => x.id !== n.id)), 800);
    });
    return off;
  }, []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {nums.map((n) => (
        <motion.div
          key={n.id}
          initial={{ opacity: 1, y: 0, scale: n.head ? 1.25 : 1 }}
          animate={{ opacity: 0, y: -40 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`absolute -translate-x-1/2 font-mono text-lg font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${n.head ? "text-amber-300" : "text-white"}`}
          style={{ left: `${n.sx * 100}%`, top: `${n.sy * 100}%` }}
        >
          {n.damage}
        </motion.div>
      ))}
    </div>
  );
}

interface DirHit {
  id: number;
  angle: number;
}

/** Arcs around the crosshair pointing toward whoever damaged you. */
export function DamageIndicators() {
  const [hits, setHits] = useState<DirHit[]>([]);
  const vignette = useRef<HTMLDivElement>(null);
  useEffect(() => {
    hudDom.vignette = vignette.current;
    let id = 0;
    const off = gameBus.on("damaged", (e) => {
      const h = { id: id++, angle: e.angle };
      setHits((l) => [...l.slice(-5), h]);
      setTimeout(() => setHits((l) => l.filter((x) => x.id !== h.id)), 1200);
    });
    return () => {
      off();
      hudDom.vignette = null;
    };
  }, []);
  return (
    <>
      <div
        ref={vignette}
        className="pointer-events-none absolute inset-0"
        style={{ opacity: 0, background: "radial-gradient(ellipse at center, transparent 55%, rgba(200,20,20,0.55) 100%)" }}
      />
      <div className="pointer-events-none absolute left-1/2 top-1/2">
        {hits.map((h) => (
          <motion.div
            key={h.id}
            initial={{ opacity: 0.95 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
            className="absolute h-[6px] w-[70px] rounded-full bg-red-500/90 shadow-[0_0_12px_rgba(255,40,40,0.9)]"
            style={{ transform: `rotate(${(h.angle * 180) / Math.PI}deg) translate(-50%, -130px)`, transformOrigin: "0 0", left: 0, top: 0 }}
          />
        ))}
      </div>
    </>
  );
}

export function DebugOverlay() {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    hudDom.debug = ref.current;
    return () => {
      hudDom.debug = null;
    };
  }, []);
  return (
    <pre
      ref={ref}
      style={{ display: "none" }}
      className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-3 py-2 font-mono text-[11px] leading-4 text-lime-200"
    />
  );
}

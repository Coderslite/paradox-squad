"use client";

import { useEffect, useRef } from "react";
import { hudDom } from "@/game/core/hudDom";
import { useSettings } from "@/stores/settings";

/** Dynamic crosshair: the game writes --spread every frame; React only renders on settings change. */
export function Crosshair() {
  const ref = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef<HTMLDivElement>(null);
  const color = useSettings((s) => s.crosshairColor);
  const size = useSettings((s) => s.crosshairSize);
  const gap = useSettings((s) => s.crosshairGap);
  const dot = useSettings((s) => s.crosshairDot);

  useEffect(() => {
    hudDom.crosshair = ref.current;
    hudDom.hitmarker = hitRef.current;
    hudDom.tags = tagsRef.current;
    hudDom.blocked = blockedRef.current;
    return () => {
      hudDom.crosshair = null;
      hudDom.hitmarker = null;
      hudDom.tags = null;
      hudDom.blocked = null;
    };
  }, []);

  const arm = (rot: number) => (
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        width: 2,
        height: size,
        background: color,
        boxShadow: "0 0 2px rgba(0,0,0,0.9)",
        transform: `translate(-50%, -50%) rotate(${rot}deg) translateY(calc(-1 * (${gap}px + var(--spread, 0px) + ${size / 2}px)))`,
      }}
    />
  );

  return (
    <div className="pointer-events-none absolute inset-0">
      <div ref={tagsRef} className="absolute inset-0 overflow-hidden" />
      {/* Third person: the shot would hit cover here before reaching the crosshair. */}
      <div ref={blockedRef} className="absolute left-0 top-0 transition-opacity duration-75" style={{ opacity: 0 }}>
        <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
          <circle cx="9" cy="9" r="7" fill="none" stroke="#ff5a4f" strokeWidth="2" />
          <line x1="4" y1="14" x2="14" y2="4" stroke="#ff5a4f" strokeWidth="2" />
        </svg>
      </div>
      <div ref={ref} className="absolute inset-0 transition-opacity duration-100" style={{ ["--spread" as string]: "0px" }}>
        {arm(0)}
        {arm(90)}
        {arm(180)}
        {arm(270)}
        {dot && (
          <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color, boxShadow: "0 0 2px rgba(0,0,0,0.9)" }} />
        )}
      </div>
      <div ref={hitRef} className="group absolute left-1/2 top-1/2 h-0 w-0" style={{ opacity: 0 }}>
        {[45, 135, 225, 315].map((r) => (
          <div
            key={r}
            className="absolute h-[10px] w-[2px] bg-white group-data-[kill=1]:bg-red-500"
            style={{ transform: `translate(-50%, -50%) rotate(${r}deg) translateY(-11px)`, boxShadow: "0 0 3px rgba(0,0,0,0.8)" }}
          />
        ))}
      </div>
    </div>
  );
}

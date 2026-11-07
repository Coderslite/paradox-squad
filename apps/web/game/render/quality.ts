import type { QualityPreset } from "@/stores/settings";

export interface QualityConfig {
  /** Cap on devicePixelRatio. */
  maxPixelRatio: number;
  shadowMapSize: number;
  antialias: boolean;
  particleScale: number;
  maxDecals: number;
}

export const QUALITY: Record<QualityPreset, QualityConfig> = {
  low: { maxPixelRatio: 0.85, shadowMapSize: 0, antialias: false, particleScale: 0.5, maxDecals: 48 },
  medium: { maxPixelRatio: 1.25, shadowMapSize: 1024, antialias: true, particleScale: 0.8, maxDecals: 96 },
  high: { maxPixelRatio: 1.75, shadowMapSize: 2048, antialias: true, particleScale: 1, maxDecals: 160 },
  ultra: { maxPixelRatio: 2, shadowMapSize: 4096, antialias: true, particleScale: 1, maxDecals: 256 },
};

/** Maps a detect-gpu tier to a starting preset. Runs once on first launch. */
export async function detectQuality(): Promise<QualityPreset> {
  try {
    const { getGPUTier } = await import("detect-gpu");
    const r = await getGPUTier();
    if (r.isMobile) return "low";
    // Apple Silicon reports tier 3 but M1 8GB is the Medium target.
    if (r.gpu?.includes("apple m1")) return "medium";
    return r.tier >= 3 ? "high" : r.tier === 2 ? "medium" : "low";
  } catch {
    return "medium";
  }
}

/**
 * Dynamic resolution: lowers the render scale when frames run long and raises it
 * again once there is headroom, to hold 60 FPS. Changes at most every 1.5s.
 */
export class DynamicResolution {
  scale = 1;
  private acc = 0;
  private frames = 0;
  private sinceChange = 0;

  /** Returns true when the scale changed. */
  sample(frameMs: number, dt: number, enabled: boolean): boolean {
    if (!enabled) {
      if (this.scale !== 1) {
        this.scale = 1;
        return true;
      }
      return false;
    }
    this.acc += frameMs;
    this.frames++;
    this.sinceChange += dt;
    if (this.sinceChange < 1.5 || this.frames < 30) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    let next = this.scale;
    if (avg > 18.2) next = Math.max(0.6, this.scale - 0.1);
    else if (avg < 14.5) next = Math.min(1, this.scale + 0.05);
    if (next !== this.scale) {
      this.scale = next;
      this.sinceChange = 0;
      return true;
    }
    return false;
  }
}

import type { SurfaceMaterial, Vec3 } from "@paradox/shared";

type GunSound = "rifle" | "pistol" | "shotgun";

const GUN: Record<GunSound, { body: number; thump: number; tail: number; gain: number }> = {
  rifle: { body: 3200, thump: 140, tail: 0.45, gain: 0.55 },
  pistol: { body: 4200, thump: 180, tail: 0.3, gain: 0.45 },
  shotgun: { body: 2200, thump: 95, tail: 0.7, gain: 0.75 },
};

const STEP: Record<SurfaceMaterial, { freq: number; q: number; ring: number }> = {
  concrete: { freq: 900, q: 1.2, ring: 0 },
  metal: { freq: 2200, q: 3, ring: 1400 },
  wood: { freq: 480, q: 1.5, ring: 0 },
  dirt: { freq: 380, q: 0.8, ring: 0 },
  glass: { freq: 3000, q: 4, ring: 2600 },
};

const SPEED_OF_SOUND = 343;

/**
 * Procedural Web Audio: all sounds are synthesized from noise and oscillators, so the
 * first match needs no audio downloads. Positional sounds use HRTF panners, air
 * absorption (distance low-pass), speed-of-sound delay and a shared reverb send.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private listenerPos = { x: 0, y: 0, z: 0 };

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      // Gentle limiter so stacked gunfire does not clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      comp.connect(this.master);
      this.sfx = ctx.createGain();
      this.sfx.connect(comp);
      this.ui = ctx.createGain();
      this.ui.connect(this.master);
      const reverb = ctx.createConvolver();
      reverb.buffer = this.makeImpulse(1.8, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.25;
      this.reverbSend.connect(reverb);
      reverb.connect(comp);
      this.noise = this.makeNoise(1);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  setVolumes(master: number, sfx: number): void {
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.sfx.gain.value = sfx;
    this.ui.gain.value = sfx;
  }

  /** Indoor zones get a wetter, longer reverb. */
  setReverbAmount(wet: number): void {
    if (this.ctx) this.reverbSend.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.3);
  }

  setListener(pos: Vec3, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    this.listenerPos.x = pos.x;
    this.listenerPos.y = pos.y;
    this.listenerPos.z = pos.z;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      // Safari < 14.1 fallback
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** `at` = null for the local player's own weapon (non-positional, full presence). */
  gunshot(kind: string, at: Vec3 | null): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const g = GUN[(kind as GunSound) in GUN ? (kind as GunSound) : "rifle"];
    const dist = at ? this.distanceTo(at) : 0;
    const t = ctx.currentTime + (at ? Math.min(0.6, dist / SPEED_OF_SOUND) : 0);
    const out = this.output(at, dist, g.gain * (at ? 1.4 : 1));

    // Body: filtered noise burst
    const body = this.noiseSource(t, 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(g.body, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    body.connect(lp);
    lp.connect(this.env(t, 0.001, 0.16, 1, out));

    // Thump: pitched-down sine
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(g.thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    osc.connect(this.env(t, 0.001, 0.14, at ? 0.5 : 0.9, out));
    osc.start(t);
    osc.stop(t + 0.2);

    // Mechanical click (local only)
    if (!at) {
      const click = this.noiseSource(t, 0.03);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 5000;
      click.connect(hp);
      hp.connect(this.env(t, 0.0005, 0.025, 0.35, out));
    }

    // Distant supersonic crack: sharp, high, arrives first.
    if (at && dist > 25) {
      const tc = Math.max(ctx.currentTime, t - Math.min(0.3, dist / SPEED_OF_SOUND) * 0.5);
      const crack = this.noiseSource(tc, 0.04);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      crack.connect(hp);
      hp.connect(this.env(tc, 0.0005, 0.04, Math.min(0.6, 8 / dist), out));
    }

    // Tail into the reverb
    const tail = this.noiseSource(t, g.tail + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.7;
    tail.connect(bp);
    const tailEnv = this.env(t, 0.005, g.tail, at ? 0.5 : 0.35, this.reverbSend);
    bp.connect(tailEnv);
  }

  footstep(mat: SurfaceMaterial, at: Vec3 | null, intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const s = STEP[mat];
    const t = ctx.currentTime;
    const dist = at ? this.distanceTo(at) : 0;
    if (dist > 40) return;
    const out = this.output(at, dist, (at ? 0.5 : 0.18) * intensity);
    const src = this.noiseSource(t, 0.12);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = s.freq * (0.85 + Math.random() * 0.3);
    bp.Q.value = s.q;
    src.connect(bp);
    bp.connect(this.env(t, 0.002, 0.07, 1, out));
    if (s.ring) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = s.ring * (0.9 + Math.random() * 0.2);
      o.connect(this.env(t, 0.001, 0.09, 0.12, out));
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  land(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    const out = this.output(null, 0, Math.min(0.5, 0.1 + intensity * 0.04));
    const src = this.noiseSource(t, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    src.connect(lp);
    lp.connect(this.env(t, 0.003, 0.15, 1, out));
  }

  slide(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    const src = this.noiseSource(t, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.55);
    src.connect(bp);
    bp.connect(this.env(t, 0.02, 0.5, 0.12, this.sfx));
  }

  hitmarker(head: boolean, kill: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    const tone = (f: number, when: number, dur: number, gain: number, type: OscillatorType = "sine"): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(this.env(when, 0.001, dur, gain, this.ui));
      o.start(when);
      o.stop(when + dur + 0.02);
    };
    if (kill) {
      tone(1400, t, 0.08, 0.22, "triangle");
      tone(2100, t + 0.06, 0.12, 0.2, "triangle");
    } else if (head) {
      tone(2800, t, 0.05, 0.22, "triangle");
      tone(4200, t, 0.03, 0.08);
    } else {
      tone(1900, t, 0.035, 0.16, "triangle");
    }
  }

  /** Reload foley: "out" (mag out), "in" (mag in), "rack" (bolt/slide). */
  reload(stage: "out" | "in" | "rack"): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const t = ctx.currentTime;
    const freq = stage === "out" ? 1800 : stage === "in" ? 2600 : 3400;
    const src = this.noiseSource(t, 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 6;
    src.connect(bp);
    bp.connect(this.env(t, 0.001, stage === "rack" ? 0.06 : 0.04, 0.35, this.sfx));
  }

  dryFire(): void {
    this.reload("rack");
  }

  uiClick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const o = ctx.createOscillator();
    o.frequency.value = 900;
    o.connect(this.env(ctx.currentTime, 0.001, 0.03, 0.08, this.ui));
    o.start();
    o.stop(ctx.currentTime + 0.05);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private distanceTo(p: Vec3): number {
    const dx = p.x - this.listenerPos.x;
    const dy = p.y - this.listenerPos.y;
    const dz = p.z - this.listenerPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Output chain: positional (HRTF + air absorption) or direct. */
  private output(at: Vec3 | null, dist: number, gain: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (!at) {
      g.connect(this.sfx);
      return g;
    }
    const absorb = ctx.createBiquadFilter();
    absorb.type = "lowpass";
    absorb.frequency.value = Math.max(900, 18000 / (1 + dist * 0.08));
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 4;
    p.rolloffFactor = 1.1;
    p.maxDistance = 300;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else {
      (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
    }
    g.connect(absorb);
    absorb.connect(p);
    p.connect(this.sfx);
    return g;
  }

  private env(t: number, attack: number, decay: number, peak: number, dest: AudioNode): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }

  private noiseSource(t: number, dur: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(Math.max(ctx.currentTime, t), Math.random() * 0.5, dur);
    return src;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }
}

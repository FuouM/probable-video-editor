// Music analysis of the song (beats from generated/timing.ai.json, envelopes and onsets from
// generated/features.json, sections from user_input/lyrics.calibrated.json) sampled at arbitrary song time.

export interface AudioInput {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  /** Envelope frames per second. */
  fps: number;
  /** 0..1 envelopes by name. A missing envelope reads as 0. */
  envelopes: Partial<Record<string, number[]>>;
  /** [time s, strength 0..1] by kind. A missing kind has no hits. */
  onsets: Partial<Record<string, [number, number][]>>;
}

export interface AudioSample {
  rms: number; low: number; mid: number; high: number;
  vocal: number; drums: number; bass: number; other: number;
  /** Decaying pulses (1 at the hit, half-life ~90-140 ms), scaled by hit strength. */
  kick: number; snare: number; hat: number; vonset: number;
}

const FEATURES = ['rms', 'low', 'mid', 'high', 'vocal', 'drums', 'bass', 'other'] as const;

export class AudioData {
  duration: number;
  bpm: number;
  beats: number[];
  downbeats: number[];
  sections: { name: string; start: number; end: number }[];
  private fps: number;
  private feat: Record<string, Float32Array> = {};
  private fRms!: Float32Array;
  private fLow!: Float32Array;
  private fMid!: Float32Array;
  private fHigh!: Float32Array;
  private fVocal!: Float32Array;
  private fDrums!: Float32Array;
  private fBass!: Float32Array;
  private fOther!: Float32Array;
  private oKick!: [number, number][];
  private oSnare!: [number, number][];
  private oHat!: [number, number][];
  private oVocal!: [number, number][];
  onsets: Partial<Record<string, [number, number][]>>;

  constructor(j: AudioInput) {
    this.duration = j.duration;
    this.bpm = j.bpm;
    this.beats = j.beats;
    this.downbeats = j.downbeats;
    this.sections = j.sections;
    this.fps = j.fps;
    for (const k of FEATURES) this.feat[k] = Float32Array.from(j.envelopes[k] ?? []);
    this.fRms = this.feat.rms!;
    this.fLow = this.feat.low!;
    this.fMid = this.feat.mid!;
    this.fHigh = this.feat.high!;
    this.fVocal = this.feat.vocal!;
    this.fDrums = this.feat.drums!;
    this.fBass = this.feat.bass!;
    this.fOther = this.feat.other!;
    for (const [k, arr] of Object.entries(j.envelopes)) {
      if (arr && !(k in this.feat)) this.feat[k] = Float32Array.from(arr);
    }
    this.onsets = j.onsets;
    this.oKick = j.onsets.kick ?? [];
    this.oSnare = j.onsets.snare ?? [];
    this.oHat = j.onsets.hat ?? [];
    this.oVocal = j.onsets.vocal ?? [];
  }

  /** Linear-interpolated envelope value at time t. */
  env(name: string, t: number): number {
    const a = this.feat[name];
    if (!a || a.length === 0) return 0;
    const x = t * this.fps;
    const i = Math.floor(x);
    if (i < 0) return a[0]!;
    if (i >= a.length - 1) return a[a.length - 1]!;
    const f = x - i;
    return a[i]! * (1 - f) + a[i + 1]! * f;
  }

  /** Max over [t - w, t]: a peak-hold for punchy reactions. */
  envPeak(name: string, t: number, w = 0.08): number {
    const a = this.feat[name];
    if (!a || a.length === 0) return 0;
    const invFps = 1 / this.fps;
    let m = 0;
    for (let s = t - w; s <= t; s += invFps) {
      const x = s * this.fps;
      const i = Math.floor(x);
      const v = i < 0 ? a[0]! : i >= a.length - 1 ? a[a.length - 1]! : a[i]! + (a[i + 1]! - a[i]!) * (x - i);
      if (v > m) m = v;
    }
    return m;
  }

  /** Sum of decaying pulses from onsets of a kind (kick/snare/hat/vocal) before t. */
  hit(kind: string, t: number, halfLife = 0.11): number {
    const list = this.onsets[kind];
    if (!list || list.length === 0) return 0;
    return this.hitList(list, t, halfLife);
  }

  private hitList(list: [number, number][], t: number, halfLife: number): number {
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    let v = 0;
    const invHL = 0.6931471805599453 / halfLife;
    for (let i = lo - 1; i >= 0 && i >= lo - 6; i--) {
      const [ot, s] = list[i]!;
      const dt = t - ot;
      if (dt > halfLife * 8) break;
      v = Math.max(v, s * Math.exp(-dt * invHL));
    }
    return v;
  }

  /** Onset events of a kind in [t0, t1). */
  events(kind: string, t0: number, t1: number): [number, number][] {
    return (this.onsets[kind] ?? []).filter(([t]) => t >= t0 && t < t1);
  }

  /** The last onset of a kind at or before t with strength >= min: [time, strength], or null. */
  lastHit(kind: string, t: number, min = 0.15): [number, number] | null {
    const list = this.onsets[kind];
    if (!list || list.length === 0) return null;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    for (let i = lo - 1; i >= 0; i--) if (list[i]![1] >= min) return list[i]!;
    return null;
  }

  /** The next onset of a kind after t with strength >= min: [time, strength], or null. */
  nextHit(kind: string, t: number, min = 0.15): [number, number] | null {
    const list = this.onsets[kind];
    if (!list || list.length === 0) return null;
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m]![0] <= t) lo = m + 1; else hi = m; }
    for (let i = lo; i < list.length; i++) if (list[i]![1] >= min) return list[i]!;
    return null;
  }

  /** Number of onsets of a kind with strength >= min in [t0, t1). */
  hitCount(kind: string, t0: number, t1: number, min = 0.15): number {
    return this.events(kind, t0, t1).filter(([, s]) => s >= min).length;
  }

  sample(t: number): AudioSample {
    const x = t * this.fps;
    const i = Math.floor(x);
    const f = x - i;
    const w0 = 1 - f, w1 = f;
    const i1 = i + 1;

    const sEnv = (a: Float32Array) => {
      const len = a.length;
      if (len === 0) return 0;
      if (i < 0) return a[0]!;
      if (i >= len - 1) return a[len - 1]!;
      return a[i]! * w0 + a[i1]! * w1;
    };

    return {
      rms: sEnv(this.fRms), low: sEnv(this.fLow), mid: sEnv(this.fMid), high: sEnv(this.fHigh),
      vocal: sEnv(this.fVocal), drums: sEnv(this.fDrums), bass: sEnv(this.fBass), other: sEnv(this.fOther),
      kick: this.hitList(this.oKick, t, 0.12),
      snare: this.hitList(this.oSnare, t, 0.14),
      hat: this.hitList(this.oHat, t, 0.06),
      vonset: this.hitList(this.oVocal, t, 0.15),
    };
  }

  /** Continuous beat index: 0 at first beat, fractional in between (extrapolated outside). */
  beatAt(t: number): number {
    const b = this.beats;
    if (b.length < 2) return t * (this.bpm / 60);
    if (t <= b[0]!) return (t - b[0]!) / (b[1]! - b[0]!);
    if (t >= b[b.length - 1]!) {
      const p = b[b.length - 1]! - b[b.length - 2]!;
      return b.length - 1 + (t - b[b.length - 1]!) / p;
    }
    let lo = 0, hi = b.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m]! <= t) lo = m; else hi = m; }
    return lo + (t - b[lo]!) / (b[hi]! - b[lo]!);
  }

  /** Time of (fractional) beat index. */
  timeOfBeat(i: number): number {
    const b = this.beats;
    const n = b.length;
    const period = n > 1 ? (b[n - 1]! - b[0]!) / (n - 1) : 60 / this.bpm;
    if (i <= 0) return (b[0] ?? 0) + i * period;
    if (i >= n - 1) return b[n - 1]! + (i - (n - 1)) * period;
    const k = Math.floor(i);
    return b[k]! + (b[k + 1]! - b[k]!) * (i - k);
  }

  /** Continuous bar index from downbeats (0 at first downbeat). */
  barAt(t: number): number {
    const d = this.downbeats;
    if (d.length < 2) return this.beatAt(t) / 4;
    if (t <= d[0]!) return (t - d[0]!) / (d[1]! - d[0]!);
    if (t >= d[d.length - 1]!) {
      const p = d[d.length - 1]! - d[d.length - 2]!;
      return d.length - 1 + (t - d[d.length - 1]!) / p;
    }
    let lo = 0, hi = d.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m]! <= t) lo = m; else hi = m; }
    return lo + (t - d[lo]!) / (d[hi]! - d[lo]!);
  }

  /** Nearest beat time to t. */
  nearestBeat(t: number): number {
    return this.timeOfBeat(Math.round(this.beatAt(t)));
  }

  section(t: number) {
    return this.sections.find((s) => t >= s.start && t < s.end) ?? this.sections[this.sections.length - 1];
  }
}

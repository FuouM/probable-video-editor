// Audio & Visual Metronome for pve-next NLE Timeline
// Synthesizes zero-latency acoustic woodblock clicks on each beat and pulses in timeline header.

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export class Metronome {
  private ctx: AudioContext | null = null;
  private enabled = false;
  private lastBeat = -1;
  private btnEl: HTMLButtonElement | null = null;
  private dotEl: HTMLElement | null = null;
  private flashTimeout: number | null = null;

  constructor() {
    this.btnEl = document.getElementById('btn-metronome') as HTMLButtonElement | null;
    this.dotEl = document.getElementById('metro-beat-dot');

    try {
      const saved = localStorage.getItem('pve:metronome');
      if (saved === 'true') {
        this.setEnabled(true);
      }
    } catch {}

    this.btnEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    this.btnEl?.classList.toggle('active', this.enabled);
    this.btnEl?.setAttribute('aria-pressed', String(this.enabled));
    try {
      localStorage.setItem('pve:metronome', String(this.enabled));
    } catch {}

    if (this.enabled && !this.ctx) {
      const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
      void this.ctx.resume();
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  tick(playing: boolean, continuousBeat: number, isDownbeat: boolean) {
    const beatInt = Math.floor(continuousBeat);
    if (beatInt === this.lastBeat) return;

    const isNewBeat = this.lastBeat === -1 || (beatInt > this.lastBeat && beatInt - this.lastBeat <= 2);
    this.lastBeat = beatInt;

    if (!isNewBeat || !playing) return;

    // Visual beat flash on dot
    if (this.dotEl) {
      clearTimeout(this.flashTimeout ?? undefined);
      this.dotEl.className = isDownbeat ? 'nle-metro-dot nle-metro-dot--downbeat' : 'nle-metro-dot nle-metro-dot--beat';
      this.flashTimeout = window.setTimeout(() => {
        if (this.dotEl) this.dotEl.className = 'nle-metro-dot';
      }, 75);
    }

    // Audio click
    if (this.enabled) {
      this.playClick(isDownbeat);
    }
  }

  private playClick(isDownbeat: boolean) {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1400 : 900, t);
    osc.frequency.exponentialRampToValueAtTime(isDownbeat ? 600 : 400, t + 0.025);

    gain.gain.setValueAtTime(isDownbeat ? 0.35 : 0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.04);
  }
}

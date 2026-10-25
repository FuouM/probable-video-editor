// High-Performance Zero-Latency Audio Engine for pve-next NLE Studio
// Uses Web Audio API (AudioBuffer in memory) with HTML5 Audio fallback.
// Eliminates demuxer seek stalls, buffer underruns, backward clock flicker, and clip jump hitches.


declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
export class StudioAudioEngine {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private master: GainNode | null = null;
  private volume = 1;

  // HTML5 Audio fallback for immediate playback while buffer decodes
  private fallbackAudio: HTMLAudioElement;

  private isPlaying = false;
  private currentT = 0;
  private startTime = 0;
  private startOffset = 0;
  private rate = 1.0;
  private loopRange: [number, number] | null = null;
  private isBufferReady = false;
  private fallbackSeeking = false;

  constructor(
    private url: string,
    private onTimeUpdate?: (t: number) => void,
    private onEndedCb?: () => void,
  ) {
    this.fallbackAudio = new Audio(url);
    this.fallbackAudio.preload = 'auto';

    this.fallbackAudio.addEventListener('seeked', () => {
      this.fallbackSeeking = false;
    });

    this.fallbackAudio.addEventListener('ended', () => {
      this.pause();
      this.currentT = 0;
      this.onEndedCb?.();
    });

    this.initWebAudio();
  }

  private async initWebAudio() {
    try {
      const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.master);

      const res = await fetch(this.url);
      const arrayBuf = await res.arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(arrayBuf);
      this.isBufferReady = true;

      // If playback started on HTMLAudio while buffer was decoding, promote seamlessly
      if (this.isPlaying && this.fallbackAudio && !this.fallbackAudio.paused) {
        const cur = this.fallbackAudio.currentTime;
        this.fallbackAudio.pause();
        this.playAt(cur);
      }
    } catch {
      // Keep using fallbackAudio if Web Audio fails
    }
  }

  get duration(): number {
    if (this.buffer) return this.buffer.duration;
    return this.fallbackAudio.duration || 0;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get currentTime(): number {
    if (this.isBufferReady && this.ctx && this.isPlaying) {
      const elapsed = this.ctx.currentTime - this.startTime;
      let t = this.startOffset + elapsed * this.rate;
      // Loop wrap-around
      if (this.loopRange && t >= this.loopRange[1]) {
        this.seek(this.loopRange[0]);
        return this.loopRange[0];
      }

      // Stop and jump to 0 at end of song when not looping
      const dur = this.duration;
      if (!this.loopRange && dur > 0 && t >= dur) {
        this.isPlaying = false;
        this.currentT = 0;
        this.stopBufferSource();
        this.onEndedCb?.();
        return 0;
      }
      return t;
    }

    if (this.fallbackSeeking) {
      return this.currentT;
    }

    if (!this.fallbackAudio.paused) {
      return this.fallbackAudio.currentTime;
    }

    return this.currentT;
  }

  get playbackRate(): number {
    return this.rate;
  }

  setPlaybackRate(speed: number) {
    if (speed <= 0) return;
    if (this.isPlaying) {
      this.currentT = this.currentTime;
      this.startOffset = this.currentT;
      if (this.ctx) this.startTime = this.ctx.currentTime;
      if (this.source && this.ctx) {
        this.source.playbackRate.setValueAtTime(speed, this.ctx.currentTime);
      }
    }
    this.rate = speed;

    // HTML5 fallback: disable pitch correction (varispeed / tape style)
    this.fallbackAudio.playbackRate = speed;
    this.fallbackAudio.preservesPitch = false;
    const fb = this.fallbackAudio as unknown as Record<string, unknown>;
    fb.webkitPreservesPitch = false;
    fb.mozPreservesPitch = false;
  }

  setLoop(range: [number, number] | null) {
    this.loopRange = range;
  }

  /** Master volume 0..1 (a muted player is volume 0). */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
    this.fallbackAudio.volume = this.volume;
  }
  async play() {
    if (this.isPlaying) return;
    const dur = this.duration;
    if (dur > 0 && this.currentT >= dur - 0.05) {
      this.currentT = 0;
    }
    this.isPlaying = true;

    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }

    if (this.isBufferReady && this.buffer && this.ctx) {
      this.playAt(this.currentT);
    } else {
      this.fallbackAudio.currentTime = this.currentT;
      this.fallbackAudio.play().catch(() => {});
    }
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.isBufferReady && this.ctx) {
      const elapsed = this.ctx.currentTime - this.startTime;
      this.currentT = Math.min(this.duration || Infinity, this.startOffset + elapsed * this.rate);
      this.stopBufferSource();
    } else {
      this.currentT = this.fallbackAudio.currentTime;
      this.fallbackAudio.pause();
    }
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(targetT: number) {
    const dur = this.duration || Infinity;
    this.currentT = Math.max(0, Math.min(dur - 0.001, targetT));

    if (this.isBufferReady && this.buffer && this.ctx) {
      if (this.isPlaying) {
        // Zero-latency instant buffer jump with fast 3ms crossfade to prevent pops
        this.playAt(this.currentT);
      } else {
        this.startOffset = this.currentT;
      }
    } else {
      this.fallbackSeeking = true;
      this.fallbackAudio.currentTime = this.currentT;
      if (this.isPlaying) {
        this.fallbackAudio.play().catch(() => {});
      }
    }

    this.onTimeUpdate?.(this.currentT);
  }

  private playAt(offsetSec: number) {
    if (!this.ctx || !this.buffer || !this.gainNode) return;

    // Fast 3ms anti-pop ramp down on previous source
    if (this.source) {
      try {
        const now = this.ctx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.003);
        const old = this.source;
        setTimeout(() => {
          try { old.stop(); old.disconnect(); } catch {}
        }, 5);
      } catch {}
    }

    // Create fresh gain node for the new source to ramp in
    this.gainNode = this.ctx.createGain();
    this.gainNode.connect(this.master ?? this.ctx.destination);
    const now = this.ctx.currentTime;
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + 0.003);

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.playbackRate.setValueAtTime(this.rate, this.ctx.currentTime);
    this.source.connect(this.gainNode);

    this.startTime = this.ctx.currentTime;
    this.startOffset = offsetSec;

    this.source.start(0, offsetSec);
  }

  private stopBufferSource() {
    if (this.source && this.ctx && this.gainNode) {
      try {
        const now = this.ctx.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.003);
        const s = this.source;
        setTimeout(() => {
          try { s.stop(); s.disconnect(); } catch {}
        }, 5);
      } catch {}
      this.source = null;
    }
  }

  dispose() {
    this.pause();
    this.stopBufferSource();
    this.fallbackAudio.src = '';
    this.ctx?.close().catch(() => {});
  }
}

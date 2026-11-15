// The player transport, shared by the site player (app/site) and the studio's fullscreen overlay: the seek bar
// (SoulWindow seekBar over the song in deciseconds, section starts as marks), transport buttons, time, section/clip chip,
// live stats (title, resolution, fps, ms, speed), volume (.daw-range) and mute, playback speed, resolution, fullscreen.
// The look is styles/controls.css on SoulWindow primitives.
//
// In fullscreen the controls float at the foot of the screen, hidden until hovered.
import { seekBar } from 'soulwindow/vanilla';

const svg = (path: string, size = 12, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" ${extra}>${path}</svg>`;

export const ICON = {
  start: svg('<path d="M4 4h2v8H4V4zm7.5 4L7 4.5v7l4.5-3.5z"/>'),
  prev: svg('<path d="M10.5 4L6 8l4.5 4V4z"/>'),
  next: svg('<path d="M5.5 4L10 8l-4.5 4V4z"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5-7-4.5z"/>', 14),
  pause: svg('<path d="M4 3.5h3v9H4v-9zm5 0h3v9H9v-9z"/>', 14),
  loop: svg('<path d="M11 1v2A5 5 0 0 0 6 8h2a3 3 0 0 1 3-3V7l4-3-4-3zm-6 8a3 3 0 0 1-3 3V10L1 13l4 3v-2a5 5 0 0 0 5-5H8z"/>'),
  vol: svg('<path d="M2 6v4h3l4 3V3L5 6H2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  mute: svg('<path d="M2 6v4h3l4 3V3L5 6H2z"/><path d="M11 6l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  fsOn: svg('<path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V2h3.5a.5.5 0 0 0 0-1h-4zm13 0h-4a.5.5 0 0 0 0 1H14v3.5a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-.5-.5zm-13 14a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 0-1H2v-3.5a.5.5 0 0 0-1 0v4zm13.5 0v-4a.5.5 0 0 0-1 0V14h-3.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5z"/>'),
  fsOff: svg('<path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/>'),
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Seek bar positions per second: the bar works on integer positions, a tenth of a second is fine enough for a song. */
export const SEEK_RES = 10;

/** The section that holds time `t` (the last that starts at or before it). */
export function sectionAt<S extends { start: number }>(sections: readonly S[], t: number): S | undefined {
  let found: S | undefined;
  for (const s of sections) if (s.start <= t) found = s;
  return found;
}

export interface TimeSeek {
  readonly el: ReturnType<typeof seekBar>;
  /** The song: its length in seconds and its sections (each start after the first is a mark; the tip names the section). */
  setSong(duration: number, sections: readonly { name: string; start: number }[]): void;
  /** Moves the fill to time `t` (seconds). */
  setTime(t: number): void;
}

/** A seek bar over a song in seconds (positions: deciseconds, SEEK_RES). After a drag the bar gives the keyboard focus back,
 *  so the arrows keep the page's own steps. */
export function timeSeek(o: { id: string; onSeek: (t: number) => void; onScrubStart: () => void; onScrubEnd: () => void }): TimeSeek {
  let sections: readonly { name: string; start: number }[] = [];
  let shown = -1;
  const tip = (v: number) => {
    const t = v / SEEK_RES;
    const s = sectionAt(sections, t);
    return s ? `${fmtTime(t)}  ${s.name}` : fmtTime(t);
  };
  const el = seekBar({
    max: 0,
    class: 'pl-seek',
    ariaLabel: 'Seek',
    format: tip,
    onInput: (v) => {
      shown = v; // the bar has moved itself
      o.onSeek(v / SEEK_RES);
    },
    onScrubStart: o.onScrubStart,
    onScrubEnd: () => {
      el.blur();
      o.onScrubEnd();
    },
  });
  el.id = o.id;
  return {
    el,
    setSong(duration, list) {
      sections = list;
      shown = -1;
      el.setMax(Math.max(0, Math.floor(duration * SEEK_RES)));
      el.setMarks(list.slice(1).map((s) => ({ value: Math.round(s.start * SEEK_RES), title: s.name })));
    },
    setTime(t) {
      // the epsilon keeps v/SEEK_RES (a seek from the bar) on its own position
      const v = Math.floor(t * SEEK_RES + 1e-6);
      if (v === shown) return;
      shown = v;
      el.set(v);
    },
  };
}

export interface SongSectionItem {
  name: string;
  start: number;
  end: number;
}

export interface FsControlsCallbacks {
  onTogglePlay: () => void;
  onSeek: (targetT: number) => void;
  onSeekStart: () => void;
  onPrevSection: () => void;
  onNextSection: () => void;
  onToggleLoop: () => void;
  onVolumeChange: (volume: number, muted: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onScaleChange: (scale: number) => void;
  onToggleFullscreen: () => void;
}

export interface FsControlsUpdateState {
  time: number;
  duration: number;
  playing: boolean;
  loop?: boolean;
  sectionName?: string;
  fps?: number;
  renderMs?: number;
  speed?: number;
  projectId?: string;
}

export class NleFullscreenControls {
  readonly el: HTMLElement;
  private seek: TimeSeek;
  private btnStart: HTMLButtonElement;
  private btnPrev: HTMLButtonElement;
  private btnPlay: HTMLButtonElement;
  private btnNext: HTMLButtonElement;
  private btnLoop: HTMLButtonElement;
  private timeNow: HTMLElement;
  private timeTotal: HTMLElement;
  private section: HTMLElement;
  private stat: HTMLElement;
  private btnMute: HTMLButtonElement;
  private vol: HTMLInputElement;
  private speedSelect: HTMLSelectElement;
  private resSelect: HTMLSelectElement;
  private btnFull: HTMLButtonElement;

  private sections: SongSectionItem[] = [];
  private duration = 0;
  private isPlaying = false;
  private shownPlaying: boolean | null = null;
  private volume = 1;
  private muted = false;

  constructor(
    parent: HTMLElement,
    private cb: FsControlsCallbacks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'pl-controls';
    this.el.id = 'fs-controls';
    this.el.innerHTML = `
      <div class="daw-transport pl-bar">
        <div class="daw-transport-group">
          <button class="daw-tbtn" id="fs-btn-start" title="Go to start (Home)" aria-label="Go to start"></button>
          <button class="daw-tbtn" id="fs-btn-prev" title="Previous section (PageUp)" aria-label="Previous section"></button>
          <button class="daw-tbtn daw-tbtn-play" id="fs-btn-play" title="Play / pause (Space)" aria-label="Play"></button>
          <button class="daw-tbtn" id="fs-btn-next" title="Next section (PageDown)" aria-label="Next section"></button>
          <button class="daw-tbtn" id="fs-btn-loop" title="Loop active clip (L)" aria-label="Loop" aria-pressed="false"></button>
        </div>
        <div class="pl-time"><span id="fs-time-now">0:00</span> <span class="pl-muted">/</span> <span id="fs-time-total">0:00</span></div>
        <div class="daw-chip" id="fs-chip-section" title="Current section / clip"><span class="pl-muted">SECTION:</span> <strong id="fs-section">—</strong></div>
        <div class="pl-stat" id="fs-stat" title="Video, output size, frames per second, CPU time of one frame"></div>
        <div class="daw-transport-spacer"></div>
        <div class="daw-transport-group">
          <button class="daw-tbtn" id="fs-btn-mute" title="Mute (M)" aria-label="Mute"></button>
          <input class="daw-range pl-vol" id="fs-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" title="Volume (Up / Down)" />
        </div>
        <label class="pl-field" title="Playback speed ( < and > )">
          <span class="pl-muted">SPEED:</span>
          <select class="input-field ds-select pl-select" id="fs-speed" aria-label="Playback speed">
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1" selected>1.0×</option>
            <option value="2">2.0×</option>
          </select>
        </label>
        <label class="pl-field" title="Preview resolution">
          <span class="pl-muted">RES:</span>
          <select class="input-field ds-select pl-select" id="fs-res" aria-label="Preview resolution">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1.0×</option>
          </select>
        </label>
        <div class="daw-transport-group">
          <button class="daw-tbtn" id="fs-btn-full" title="Exit fullscreen (Escape / F11)" aria-label="Exit fullscreen"></button>
        </div>
      </div>
    `;
    parent.appendChild(this.el);

    this.btnStart = this.el.querySelector('#fs-btn-start')!;
    this.btnPrev = this.el.querySelector('#fs-btn-prev')!;
    this.btnPlay = this.el.querySelector('#fs-btn-play')!;
    this.btnNext = this.el.querySelector('#fs-btn-next')!;
    this.btnLoop = this.el.querySelector('#fs-btn-loop')!;
    this.timeNow = this.el.querySelector('#fs-time-now')!;
    this.timeTotal = this.el.querySelector('#fs-time-total')!;
    this.section = this.el.querySelector('#fs-section')!;
    this.stat = this.el.querySelector('#fs-stat')!;
    this.btnMute = this.el.querySelector('#fs-btn-mute')!;
    this.vol = this.el.querySelector('#fs-vol')!;
    this.speedSelect = this.el.querySelector('#fs-speed')!;
    this.resSelect = this.el.querySelector('#fs-res')!;
    this.btnFull = this.el.querySelector('#fs-btn-full')!;

    // scrubbing pauses playback and resumes it after; the bar stays shown while the pointer drags
    let resume = false;
    this.seek = timeSeek({
      id: 'fs-seek',
      onSeek: (t) => this.cb.onSeek(t),
      onScrubStart: () => {
        resume = this.isPlaying;
        if (resume) this.cb.onTogglePlay();
        this.el.classList.add('is-active');
      },
      onScrubEnd: () => {
        this.el.classList.remove('is-active');
        if (resume) this.cb.onTogglePlay();
      },
    });
    this.el.prepend(this.seek.el);

    this.initButtons();
    this.initVolume();
    this.initSelectors();
  }

  private initButtons() {
    this.btnStart.innerHTML = ICON.start;
    this.btnPrev.innerHTML = ICON.prev;
    this.btnPlay.innerHTML = ICON.play;
    this.btnNext.innerHTML = ICON.next;
    this.btnLoop.innerHTML = ICON.loop;
    this.btnFull.innerHTML = ICON.fsOff;

    // Prevent button click from stealing focus so Space/Arrow keys stay responsive
    for (const b of this.el.querySelectorAll('button')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
    }

    this.btnStart.addEventListener('click', () => this.cb.onSeekStart());
    this.btnPrev.addEventListener('click', () => this.cb.onPrevSection());
    this.btnPlay.addEventListener('click', () => this.cb.onTogglePlay());
    this.btnNext.addEventListener('click', () => this.cb.onNextSection());
    this.btnLoop.addEventListener('click', () => this.cb.onToggleLoop());
    this.btnFull.addEventListener('click', () => this.cb.onToggleFullscreen());
  }

  private initVolume() {
    try {
      const savedVol = localStorage.getItem('pve.player.vol');
      if (savedVol !== null) this.volume = clamp(parseFloat(savedVol) || 1, 0, 1);
      this.muted = localStorage.getItem('pve.player.mute') === 'true';
    } catch {}

    this.applyVol();

    this.vol.addEventListener('input', () => {
      this.volume = parseFloat(this.vol.value);
      if (this.muted && this.volume > 0) this.muted = false;
      this.saveVolume();
      this.applyVol();
    });

    this.btnMute.addEventListener('click', () => {
      this.toggleMute();
    });
  }

  private saveVolume() {
    try {
      localStorage.setItem('pve.player.vol', String(this.volume));
      localStorage.setItem('pve.player.mute', String(this.muted));
    } catch {}
  }

  private applyVol() {
    const off = this.muted || this.volume === 0;
    this.cb.onVolumeChange(this.volume, this.muted);
    this.vol.value = String(this.volume);
    this.btnMute.innerHTML = off ? ICON.mute : ICON.vol;
    this.btnMute.classList.toggle('daw-on', off);
    this.btnMute.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
    this.btnMute.title = off ? 'Unmute (M)' : 'Mute (M)';
  }

  toggleMute() {
    this.muted = !this.muted;
    this.saveVolume();
    this.applyVol();
  }

  stepVolume(delta: number) {
    this.volume = clamp(parseFloat((this.volume + delta).toFixed(2)), 0, 1);
    if (this.muted && delta > 0) this.muted = false;
    this.saveVolume();
    this.applyVol();
  }

  private initSelectors() {
    this.speedSelect.addEventListener('change', () => {
      const sp = parseFloat(this.speedSelect.value) || 1.0;
      this.cb.onSpeedChange(sp);
    });

    this.resSelect.addEventListener('change', () => {
      const sc = parseFloat(this.resSelect.value) || 1.0;
      this.cb.onScaleChange(sc);
    });
  }

  setSections(sections: SongSectionItem[], duration: number) {
    this.sections = sections;
    this.duration = duration;
    this.seek.setSong(duration, sections);
    this.timeTotal.textContent = fmtTime(duration);
  }

  update(s: FsControlsUpdateState) {
    this.isPlaying = s.playing;
    if (s.duration !== this.duration) this.setSections(this.sections, s.duration);
    this.seek.setTime(s.time);

    this.timeNow.textContent = fmtTime(s.time);
    this.timeTotal.textContent = fmtTime(s.duration);

    if (s.sectionName !== undefined) {
      this.section.textContent = s.sectionName || '—';
    }

    if (this.shownPlaying !== s.playing) {
      this.shownPlaying = s.playing;
      this.btnPlay.innerHTML = s.playing ? ICON.pause : ICON.play;
      this.btnPlay.classList.toggle('daw-on', s.playing);
      this.btnPlay.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      this.btnPlay.title = s.playing ? 'Pause (Space)' : 'Play (Space)';
    }

    if (s.loop !== undefined) {
      this.btnLoop.classList.toggle('daw-on', s.loop);
      this.btnLoop.setAttribute('aria-pressed', String(s.loop));
    }

    const fps = `${(s.fps ?? 60).toFixed(0)} FPS`;
    const ms = `${(s.renderMs ?? 16.6).toFixed(1)} ms`;
    const sp = s.speed && Math.abs(s.speed - 1) > 0.01 ? ` · ${s.speed}×` : '';
    this.stat.textContent = `${s.projectId ?? 'pve'} · 1920×1080 · ${fps} · ${ms}${sp}`;
  }

  setSpeed(speed: number) {
    const opts = Array.from(this.speedSelect.options);
    const closest = opts.find((o) => Math.abs(parseFloat(o.value) - speed) < 0.01);
    if (closest) {
      this.speedSelect.value = closest.value;
    }
  }

  setScale(scale: number) {
    const opts = Array.from(this.resSelect.options);
    const closest = opts.find((o) => Math.abs(parseFloat(o.value) - scale) < 0.01);
    if (closest) {
      this.resSelect.value = closest.value;
    }
  }

  setLoop(isLoop: boolean) {
    this.btnLoop.classList.toggle('daw-on', isLoop);
    this.btnLoop.setAttribute('aria-pressed', String(isLoop));
  }

  setFullscreen(isFs: boolean) {
    this.btnFull.innerHTML = isFs ? ICON.fsOff : ICON.fsOn;
    this.btnFull.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Fullscreen');
    this.btnFull.title = isFs ? 'Exit fullscreen (Escape / F11)' : 'Fullscreen (F11)';
  }
}

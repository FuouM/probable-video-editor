// Fullscreen Bottom Hover Player Controls for PVE NLE
// Exact live-site aesthetic and behavior: seek bar with section ticks, WinForms transport buttons,
// time display, section/clip chip, live stats (title, resolution, fps, ms, speed), volume slider/mute,
// playback speed selector, resolution selector, and fullscreen toggle.
//
// In fullscreen mode, the controls float at the foot of the screen, hidden until hovered.

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
  private seek: HTMLElement;
  private seekFill: HTMLElement;
  private seekTicks: HTMLElement;
  private seekTip: HTMLElement;
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
  private dragging = false;
  private volume = 1;
  private muted = false;

  constructor(
    parent: HTMLElement,
    private cb: FsControlsCallbacks,
  ) {
    let existing = parent.querySelector('#fs-controls') as HTMLElement | null;
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'pl-controls nle-fs-controls';
      existing.id = 'fs-controls';
      existing.innerHTML = `
        <div class="pl-seek" id="fs-seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
          <div class="pl-seek-fill" id="fs-seek-fill"></div>
          <div class="pl-seek-ticks" id="fs-seek-ticks"></div>
          <div class="pl-seek-tip" id="fs-seek-tip"></div>
        </div>
        <div class="daw-transport pl-bar">
          <div class="daw-transport-group">
            <button class="daw-tbtn" id="fs-btn-start" title="Go to start (Home)" aria-label="Go to start"></button>
            <button class="daw-tbtn" id="fs-btn-prev" title="Previous section (PageUp)" aria-label="Previous section"></button>
            <button class="daw-tbtn daw-tbtn-play" id="fs-btn-play" title="Play / pause (Space)" aria-label="Play"></button>
            <button class="daw-tbtn" id="fs-btn-next" title="Next section (PageDown)" aria-label="Next section"></button>
            <button class="daw-tbtn" id="fs-btn-loop" title="Loop active clip (L)" aria-label="Loop" aria-pressed="false"></button>
          </div>
          <div class="pl-time"><span id="fs-time-now">0:00</span> <span class="pl-muted">/</span> <span id="fs-time-total">0:00</span></div>
          <div class="nle-chip" id="fs-chip-section" title="Current section / clip"><span class="pl-muted">SECTION:</span> <strong id="fs-section">—</strong></div>
          <div class="pl-stat" id="fs-stat" title="Video, output size, frames per second, CPU time of one frame"></div>
          <div class="daw-transport-spacer"></div>
          <div class="daw-transport-group">
            <button class="daw-tbtn" id="fs-btn-mute" title="Mute (M)" aria-label="Mute"></button>
            <input class="pl-vol" id="fs-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" title="Volume (Up / Down)" />
          </div>
          <label class="pl-field" title="Playback speed ( < and > )">
            <span class="pl-muted">SPEED:</span>
            <select class="nle-select pl-select" id="fs-speed" aria-label="Playback speed">
              <option value="0.25">0.25×</option>
              <option value="0.5">0.5×</option>
              <option value="1" selected>1.0×</option>
              <option value="2">2.0×</option>
            </select>
          </label>
          <label class="pl-field" title="Preview resolution">
            <span class="pl-muted">RES:</span>
            <select class="nle-select pl-select" id="fs-res" aria-label="Preview resolution">
              <option value="0.5">0.5×</option>
              <option value="1" selected>1.0×</option>
            </select>
          </label>
          <div class="daw-transport-group">
            <button class="daw-tbtn" id="fs-btn-full" title="Exit fullscreen (Escape / F11)" aria-label="Exit fullscreen"></button>
          </div>
        </div>
      `;
      parent.appendChild(existing);
    }
    this.el = existing;

    this.seek = this.el.querySelector('#fs-seek')!;
    this.seekFill = this.el.querySelector('#fs-seek-fill')!;
    this.seekTicks = this.el.querySelector('#fs-seek-ticks')!;
    this.seekTip = this.el.querySelector('#fs-seek-tip')!;
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

    this.initButtons();
    this.initSeekBar();
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

  private initSeekBar() {
    let resume = false;
    const fracAt = (e: PointerEvent) => {
      const r = this.seek.getBoundingClientRect();
      if (r.width <= 0) return 0;
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };

    this.seek.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      resume = this.isPlaying;
      if (resume) this.cb.onTogglePlay();
      this.seek.setPointerCapture(e.pointerId);
      this.el.classList.add('is-active');
      const targetT = fracAt(e) * this.duration;
      this.cb.onSeek(targetT);
    });

    this.seek.addEventListener('pointermove', (e) => {
      const f = fracAt(e);
      const x = f * this.duration;
      const s = this.sectionAt(x);
      this.seekTip.textContent = s ? `${fmtTime(x)}  ${s.name}` : fmtTime(x);
      this.seekTip.style.left = `${clamp(f * 100, 6, 94)}%`;
      if (this.dragging) {
        this.cb.onSeek(x);
      }
    });

    const endDrag = () => {
      if (!this.dragging) return;
      this.dragging = false;
      this.el.classList.remove('is-active');
      if (resume) this.cb.onTogglePlay();
    };

    this.seek.addEventListener('pointerup', endDrag);
    this.seek.addEventListener('pointercancel', endDrag);
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
    this.btnMute.classList.toggle('active', off);
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
    this.seek.setAttribute('aria-valuemax', String(Math.round(duration)));
    this.timeTotal.textContent = fmtTime(duration);

    if (duration > 0 && sections.length > 0) {
      this.seekTicks.innerHTML = sections
        .slice(1)
        .map((s) => `<i style="left:${clamp((s.start / duration) * 100, 0, 100)}%"></i>`)
        .join('');
    } else {
      this.seekTicks.innerHTML = '';
    }
  }

  private sectionAt(t: number): SongSectionItem | undefined {
    let found: SongSectionItem | undefined;
    for (const s of this.sections) {
      if (s.start <= t) found = s;
    }
    return found;
  }

  update(s: FsControlsUpdateState) {
    this.isPlaying = s.playing;
    this.duration = s.duration;

    if (!this.dragging) {
      const pct = s.duration > 0 ? clamp((s.time / s.duration) * 100, 0, 100) : 0;
      this.seekFill.style.width = `${pct}%`;
      this.seek.setAttribute('aria-valuenow', String(Math.round(s.time)));
    }

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
      this.btnLoop.classList.toggle('active', s.loop);
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
    this.btnLoop.classList.toggle('active', isLoop);
    this.btnLoop.setAttribute('aria-pressed', String(isLoop));
  }

  setFullscreen(isFs: boolean) {
    this.btnFull.innerHTML = isFs ? ICON.fsOff : ICON.fsOn;
    this.btnFull.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Fullscreen');
    this.btnFull.title = isFs ? 'Exit fullscreen (Escape / F11)' : 'Fullscreen (F11)';
  }
}

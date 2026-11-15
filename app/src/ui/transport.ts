// Transport bar of the studio: SoulWindow pro `.daw-transport` with a VFD readout (`seg7Html`).
import { seg7Html } from 'soulwindow/runtime';

export interface TransportState {
  playing: boolean;
  time: number;
  bar: number;
  beat: number;
  duration: number;
  bpm: number;
  fps: number;
  loop: boolean;
  follow: boolean;
  scale: number;
  speed: number;
  clipId: string;
  dirtyCount: number;
  dirtyFiles: string[];
}

export interface TransportCallbacks {
  onTogglePlay: () => void;
  onStep: (frames: number) => void;
  onSeekStart: () => void;
  onToggleLoop: () => void;
  onToggleFollow: () => void;
  onZoom: (factor: number) => void;
  onZoomFit: () => void;
  onScaleChange: (scale: number) => void;
  onSpeedChange: (speed: number) => void;
  onRender?: () => void;
  onToggleFullscreen?: () => void;
}

export class NleTransport {
  private el: HTMLElement;
  private vfdMain: HTMLElement;
  private vfdTime: HTMLElement;
  private vfdBar: HTMLElement;
  private vfdBpm: HTMLElement;
  private btnPlay: HTMLButtonElement;
  private btnLoop: HTMLButtonElement;
  private btnFollow: HTMLButtonElement;
  private chipStatus: HTMLElement;
  private clipLabel: HTMLElement;
  private annPlay: HTMLElement;

  constructor(
    container: HTMLElement,
    private cb: TransportCallbacks,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'daw-transport';
    this.el.innerHTML = `
      <!-- Playback buttons group -->
      <div class="daw-transport-group">
        <button class="daw-tbtn" id="btn-start" title="Go to start (Home / [)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h2v8H4V4zm7.5 4L7 4.5v7l4.5-3.5z"/></svg>
        </button>
        <button class="daw-tbtn" id="btn-prev" title="Step -1 frame (,)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 4L6 8l4.5 4V4z"/></svg>
        </button>
        <button class="daw-tbtn daw-tbtn-play" id="btn-play" title="Play / pause (Space)">
          <svg id="icon-play" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.5v9l7-4.5-7-4.5z"/></svg>
          <svg id="icon-pause" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="display:none"><path d="M4 3.5h3v9H4v-9zm5 0h3v9H9v-9z"/></svg>
        </button>
        <button class="daw-tbtn" id="btn-next" title="Step +1 frame (.)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 4L10 8l-4.5 4V4z"/></svg>
        </button>
        <button class="daw-tbtn" id="btn-loop" title="Loop active clip (L)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M11 1v2A5 5 0 0 0 6 8h2a3 3 0 0 1 3-3V7l4-3-4-3zm-6 8a3 3 0 0 1-3 3V10L1 13l4 3v-2a5 5 0 0 0 5-5H8z"/></svg>
        </button>
        <button class="daw-tbtn daw-on" id="btn-follow" title="Follow Playhead (F)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103z"/></svg>
        </button>
      </div>

      <!-- Smoked Glass Hardware VFD / LCD Panel (Lyric-Sync standard) -->
      <div class="daw-lcd" title="Song Position">
        <div class="daw-lcd-glass">
          <span class="daw-lcd-ann" id="lcd-ann-play">▶</span>
          <div class="daw-lcd-main" id="vfd-main-container">
            ${seg7Html('0000')}
          </div>
          <div class="daw-lcd-sub">
            <span class="daw-lcd-label">BAR</span>
            <div id="vfd-bar-container">${seg7Html('001.1')}</div>
            <span class="daw-lcd-label">BPM</span>
            <div id="vfd-bpm-container">${seg7Html('200.0')}</div>
            <span class="daw-lcd-label">TIME</span>
            <div id="vfd-time-container">${seg7Html('00:00.00')}</div>
          </div>
        </div>
      </div>

      <!-- Timeline Zoom Controls -->
      <div class="daw-transport-group">
        <button class="daw-tbtn" id="btn-zoom-out" title="Zoom Out (-)">−</button>
        <button class="daw-tbtn" id="btn-zoom-in" title="Zoom In (+)">+</button>
        <button class="daw-tbtn" id="btn-zoom-fit" title="Zoom to Fit">FIT</button>
      </div>

      <!-- Scale preview resolution & Fullscreen -->
      <div class="daw-transport-group">
        <button class="daw-tbtn" id="btn-scale-half" title="540p Half preview">0.5×</button>
        <button class="daw-tbtn daw-on" id="btn-scale-one" title="1080p Native">1.0×</button>
        <button class="daw-tbtn" id="btn-fullscreen" title="Fullscreen Preview (F11 / Double-click)">
          <svg class="icon-fs-enter" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V2h3.5a.5.5 0 0 0 0-1h-4zm13 0h-4a.5.5 0 0 0 0 1H14v3.5a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-.5-.5zm-13 14a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 0-1H2v-3.5a.5.5 0 0 0-1 0v4zm13.5 0v-4a.5.5 0 0 0-1 0V14h-3.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5z"/></svg>
          <svg class="icon-fs-exit sw-hidden" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/></svg>
        </button>
      </div>

      <!-- Playback Speed (0.25x, 0.5x, 1x, 2x - varispeed, non-pitch-corrected) -->
      <div class="daw-transport-group">
        <button class="daw-tbtn" id="btn-speed-025" title="0.25× Speed (Quarter speed / 2 octaves down)">.25×</button>
        <button class="daw-tbtn" id="btn-speed-05" title="0.5× Speed (Half speed / 1 octave down)">0.5×</button>
        <button class="daw-tbtn daw-on" id="btn-speed-1" title="1.0× Normal Speed">1.0×</button>
        <button class="daw-tbtn" id="btn-speed-2" title="2.0× Speed (Double speed / 1 octave up)">2.0×</button>
      </div>
      <!-- Render & Export Action -->
      <div class="daw-transport-group">
        <button class="daw-tbtn daw-btn-err nle-render-btn" id="btn-render" title="Render video (Ctrl+Shift+R)">
          <span class="nle-render-mark">●</span>RENDER
        </button>
      </div>
      <div class="daw-transport-spacer"></div>

      <!-- Current Scene / Clip block chip -->
      <div class="daw-chip" id="chip-clip">
        <span>CLIP:</span>
        <strong id="label-clip" class="nle-chip-value">—</strong>
      </div>

      <!-- Agent Live Status Badge -->
      <div class="daw-chip daw-chip--ok" id="chip-status" title="Git status of project scenes">
        <span>● ALL COMMITTED</span>
      </div>

    `;

    container.appendChild(this.el);

    this.vfdMain = this.el.querySelector('#vfd-main-container')!;
    this.vfdBar = this.el.querySelector('#vfd-bar-container')!;
    this.vfdBpm = this.el.querySelector('#vfd-bpm-container')!;
    this.vfdTime = this.el.querySelector('#vfd-time-container')!;
    this.btnPlay = this.el.querySelector('#btn-play')!;
    this.btnLoop = this.el.querySelector('#btn-loop')!;
    this.btnFollow = this.el.querySelector('#btn-follow')!;
    this.chipStatus = this.el.querySelector('#chip-status')!;
    this.clipLabel = this.el.querySelector('#label-clip')!;
    this.annPlay = this.el.querySelector('#lcd-ann-play')!;

    this.bindEvents();
  }

  private bindEvents() {
    this.btnPlay.onclick = () => this.cb.onTogglePlay();
    this.btnLoop.onclick = () => this.cb.onToggleLoop();
    this.btnFollow.onclick = () => this.cb.onToggleFollow();
    this.el.querySelector('#btn-start')!.addEventListener('click', () => this.cb.onSeekStart());
    this.el.querySelector('#btn-prev')!.addEventListener('click', () => this.cb.onStep(-1));
    this.el.querySelector('#btn-next')!.addEventListener('click', () => this.cb.onStep(1));
    this.el.querySelector('#btn-render')?.addEventListener('click', () => this.cb.onRender?.());
    this.el.querySelector('#btn-zoom-out')!.addEventListener('click', () => this.cb.onZoom(1.3));
    this.el.querySelector('#btn-zoom-in')!.addEventListener('click', () => this.cb.onZoom(0.77));
    this.el.querySelector('#btn-zoom-fit')!.addEventListener('click', () => this.cb.onZoomFit());

    const btnHalf = this.el.querySelector('#btn-scale-half') as HTMLButtonElement;
    const btnOne = this.el.querySelector('#btn-scale-one') as HTMLButtonElement;

    btnHalf.onclick = () => {
      btnHalf.classList.add('daw-on');
      btnOne.classList.remove('daw-on');
      this.cb.onScaleChange(0.5);
    };
    btnOne.onclick = () => {
      btnOne.classList.add('daw-on');
      btnHalf.classList.remove('daw-on');
      this.cb.onScaleChange(1);
    };
    this.el.querySelector('#btn-fullscreen')?.addEventListener('click', () => {
      this.cb.onToggleFullscreen?.();
    });

    const speeds = [
      { id: '#btn-speed-025', val: 0.25 },
      { id: '#btn-speed-05', val: 0.5 },
      { id: '#btn-speed-1', val: 1.0 },
      { id: '#btn-speed-2', val: 2.0 },
    ];
    for (const s of speeds) {
      const btn = this.el.querySelector(s.id) as HTMLButtonElement;
      if (btn) btn.onclick = () => this.cb.onSpeedChange(s.val);
    }
  }

  /** What the bar shows now: update writes the DOM only where this changes (a write every frame restyles the bar). */
  private shown = new Map<HTMLElement | string, string | number | boolean>();

  private changed(k: HTMLElement | string, v: string | number | boolean): boolean {
    if (this.shown.get(k) === v) return false;
    this.shown.set(k, v);
    return true;
  }

  private setLcd(el: HTMLElement, text: string) {
    if (this.changed(el, text)) el.innerHTML = seg7Html(text);
  }

  update(s: Partial<TransportState>) {
    if (s.time !== undefined) {
      const frameNum = Math.floor(s.time * 30);
      this.setLcd(this.vfdMain, String(frameNum).padStart(4, '0'));

      const m = Math.floor(s.time / 60);
      const sec = s.time % 60;
      this.setLcd(this.vfdTime, `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`);
    }

    if (s.bar !== undefined && s.beat !== undefined) {
      const barNum = Math.max(1, Math.floor(s.bar) + 1);
      const beatNum = Math.floor(s.beat % 4) + 1;
      this.setLcd(this.vfdBar, `${String(barNum).padStart(3, '0')}.${beatNum}`);
    }

    if (s.bpm !== undefined) {
      this.setLcd(this.vfdBpm, s.bpm.toFixed(1).padStart(5, ' '));
    }


    if (s.playing !== undefined && this.changed('playing', s.playing)) {
      this.btnPlay.classList.toggle('daw-on', s.playing);
      const iconPlay = this.el.querySelector('#icon-play') as HTMLElement;
      const iconPause = this.el.querySelector('#icon-pause') as HTMLElement;
      if (iconPlay && iconPause) {
        iconPlay.style.display = s.playing ? 'none' : 'block';
        iconPause.style.display = s.playing ? 'block' : 'none';
      }
      this.annPlay.classList.toggle('daw-lcd-ann--on', s.playing);
    }

    if (s.loop !== undefined) {
      this.btnLoop.classList.toggle('daw-on', s.loop);
    }
    if (s.follow !== undefined) {
      this.btnFollow.classList.toggle('daw-on', s.follow);
    }
    if (s.speed !== undefined && this.changed('speed', s.speed)) {
      const sp = s.speed;
      this.el.querySelector('#btn-speed-025')?.classList.toggle('daw-on', Math.abs(sp - 0.25) < 0.01);
      this.el.querySelector('#btn-speed-05')?.classList.toggle('daw-on', Math.abs(sp - 0.5) < 0.01);
      this.el.querySelector('#btn-speed-1')?.classList.toggle('daw-on', Math.abs(sp - 1.0) < 0.01);
      this.el.querySelector('#btn-speed-2')?.classList.toggle('daw-on', Math.abs(sp - 2.0) < 0.01);
    }


    if (s.clipId !== undefined && this.changed('clipId', s.clipId)) {
      this.clipLabel.textContent = s.clipId || '—';
    }


    if (s.dirtyCount !== undefined) {
      if (s.dirtyCount > 0) {
        this.chipStatus.className = 'daw-chip daw-chip--warn';
        this.chipStatus.innerHTML = `<span>⚡ ${s.dirtyCount} SCENE${s.dirtyCount > 1 ? 'S' : ''} MODIFIED</span>`;
        this.chipStatus.title = `Modified:\n${(s.dirtyFiles ?? []).join('\n')}`;
      } else {
        this.chipStatus.className = 'daw-chip daw-chip--ok';
        this.chipStatus.innerHTML = '<span>● ALL COMMITTED</span>';
        this.chipStatus.title = 'All scenes committed';
      }
    }
  }

  setRenderStatus(status: {
    active: boolean;
    stage?: 'rendering' | 'encoding' | 'complete' | 'error' | 'aborted' | 'idle';
    percent?: number;
    fps?: number;
    etaS?: number;
  }) {
    const btn = this.el.querySelector('#btn-render') as HTMLButtonElement;
    if (!btn) return;

    // tone: red to start a render, the accent while one runs, green when the file is ready
    btn.classList.toggle('daw-on', status.active);
    btn.classList.toggle('daw-btn-ok', !status.active && status.stage === 'complete');
    btn.classList.toggle('daw-btn-err', !status.active && status.stage !== 'complete');
    if (status.active) {
      const pct = Math.round(status.percent ?? 0);
      const isEncoding = status.stage === 'encoding';
      btn.innerHTML = `<span class="nle-render-mark">⚡</span>${isEncoding ? 'ENCODING' : `RENDER ${pct}%`}`;
      btn.title = isEncoding
        ? 'Encoding final MP4 with audio... (Click to view)'
        : `Rendering video: ${pct}%${status.fps ? ` · ${status.fps.toFixed(1)} FPS` : ''}${status.etaS !== undefined ? ` · ETA ${status.etaS}s` : ''} (Click to view)`;
    } else if (status.stage === 'complete') {
      btn.innerHTML = `<span class="nle-render-mark">✓</span>READY`;
      btn.title = 'Render complete! Click to view output';
    } else {
      btn.innerHTML = `<span class="nle-render-mark">●</span>RENDER`;
      btn.title = 'Render video (Ctrl+Shift+R)';
    }
  }
  setFullscreen(isFs: boolean) {
    const btn = this.el.querySelector('#btn-fullscreen') as HTMLButtonElement;
    if (!btn) return;
    btn.classList.toggle('daw-on', isFs);
    btn.title = isFs ? 'Exit Fullscreen (Escape / F11)' : 'Fullscreen Preview (F11 / Double-click)';
    btn.querySelector('.icon-fs-enter')?.classList.toggle('sw-hidden', isFs);
    btn.querySelector('.icon-fs-exit')?.classList.toggle('sw-hidden', !isFs);
  }
}


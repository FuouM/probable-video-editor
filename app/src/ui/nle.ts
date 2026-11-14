// NLE Studio Manager for pve-next
// Coordinates: Engine, Audio clock, Program Monitor, WinForms Transport Bar, Multi-track Timeline, Agent Change Detector.
// Zero blur, zero ambient glow shadows, zero scale transforms.

import { Engine, type TimelineEntry } from '@pve/engine/engine';
import type { ProjectInputs } from '../inputs';
import { NleTimeline } from './timeline';
import { NleTransport } from './transport';
import { AgentChangeDetector } from './badges';
import { StudioAudioEngine } from './audio';
import { NotesEditor } from './notes';
import { updateSceneTimestamp } from '../project';
import { RenderDialog } from './render-dialog';
import { Metronome } from './metronome';
import { PerfGraph } from './perf-graph';
import { NleFullscreenControls } from './fs-controls';
export class NleStudio {
  private audio: StudioAudioEngine;
  private transport: NleTransport;
  private fsControls: NleFullscreenControls;
  private timeline: NleTimeline;
  private badges: AgentChangeDetector;
  private notesEditor: NotesEditor;
  private t = 0;
  private renderDialog: RenderDialog;
  private metronome: Metronome;
  private perfGraph: PerfGraph;
  private lastTickT = 0;
  private playing = false;
  private loop: [number, number] | null = null;
  private lastAudioT = 0;
  private lastPerf = 0;
  private frames = 0;
  private fpsT = performance.now();
  private fps = 60;
  private renderMsAvg = 16.6;
  private follow = true;
  private speed = 1.0;
  private static STORAGE_FOLLOW = 'pve.studio.follow';
  private static STORAGE_SPEED = 'pve.studio.speed';

  /** Resolves when the mix is decoded (the loading screen waits for it). */
  readonly audioReady: Promise<void>;

  constructor(
    private engine: Engine,
    private project: ProjectInputs,
    private timelineEntries: TimelineEntry[],
    private canvas: HTMLCanvasElement,
    initialT: number | null = null,
    audio: StudioAudioEngine,
  ) {
    this.t = initialT ?? 0;
    const savedFollow = localStorage.getItem(NleStudio.STORAGE_FOLLOW);
    this.follow = savedFollow !== null ? savedFollow === 'true' : true;
    const savedSpeed = localStorage.getItem(NleStudio.STORAGE_SPEED);
    this.speed = savedSpeed ? parseFloat(savedSpeed) || 1.0 : 1.0;

    // (main.ts starts the mix download before the scenes load)
    this.audio = audio;
    audio.onTimeUpdate = (t) => { this.t = t; };
    audio.onEndedCb = () => {
      this.playing = false;
      this.seek(0);
      this.transport.update({ playing: false, time: 0 });
    };
    this.audioReady = this.audio.ready;
    this.audio.setPlaybackRate(this.speed);

    // Agent change detector
    this.badges = new AgentChangeDetector(project.id);
    this.badges.setClipScenes(this.timelineEntries);

    // Mount WinForms Transport Bar
    const transportContainer = document.getElementById('transport-container')!;
    this.transport = new NleTransport(transportContainer, {
      onTogglePlay: () => this.toggle(),
      onStep: (frames) => this.seek(this.t + frames / 30),
      onSeekStart: () => this.seek(0),
      onToggleLoop: () => this.toggleLoop(),
      onToggleFollow: () => this.toggleFollow(),
      onZoom: (factor) => this.timeline.zoom(factor),
      onZoomFit: () => this.timeline.zoomFit(),
      onScaleChange: (scale) => this.setScale(scale),
      onSpeedChange: (speed) => this.setSpeed(speed),
      onRender: () => this.renderDialog.open(),
      onToggleFullscreen: () => this.toggleFullscreen(),
    });

    // Mount Fullscreen Bottom Hover Player Controls
    const canvasFrame = document.getElementById('canvas-frame')!;
    this.fsControls = new NleFullscreenControls(canvasFrame, {
      onTogglePlay: () => this.toggle(),
      onSeek: (targetT) => this.seek(targetT),
      onSeekStart: () => this.seek(0),
      onPrevSection: () => this.prevSection(),
      onNextSection: () => this.nextSection(),
      onToggleLoop: () => this.toggleLoop(),
      onVolumeChange: (vol, muted) => {
        this.audio.setVolume(muted ? 0 : vol);
      },
      onSpeedChange: (speed) => this.setSpeed(speed),
      onScaleChange: (scale) => this.setScale(scale),
      onToggleFullscreen: () => this.toggleFullscreen(),
    });
    this.fsControls.setSections(this.getSections(), engine.duration);
    this.fsControls.setSpeed(this.speed);

    // Mount Multi-Track Timeline Canvas
    const timelineCanvas = document.getElementById('timeline-canvas') as HTMLCanvasElement;
    this.timeline = new NleTimeline(
      timelineCanvas,
      {
        duration: engine.duration,
        timeline: timelineEntries,
        timing: project.timing,
        features: project.features,
        lyrics: engine.lyrics,
        dirtyClips: new Set(),
        reloadedClips: new Map(),
      },
      {
        onSeek: (targetT) => this.seek(targetT),
        onClipSelect: (clip, engageLoop) => {
          this.seek(clip.start);
          if (engageLoop) {
            this.loop = [clip.start, clip.end];
            this.timeline.setLoop(this.loop);
            this.transport.update({ loop: true });
          }
        },
        onClipDoubleClick: (clip) => {
          this.loop = [clip.start, clip.end];
          this.timeline.setLoop(this.loop);
          this.transport.update({ loop: true });
          this.seek(clip.start);
          if (!this.playing) this.toggle();
        },
      },
    );
    this.timeline.setFollow(this.follow);
    this.transport.update({ follow: this.follow });
    const menuFollow = document.getElementById('menu-follow');
    if (menuFollow) menuFollow.classList.toggle('active', this.follow);

    // Connect agent change badge updates
    this.badges.onChange((dirty, reloaded, files) => {
      this.timeline.updateData({ dirtyClips: dirty, reloadedClips: reloaded });
      this.transport.update({ dirtyCount: dirty.size, dirtyFiles: files });

      // Update top menubar chip
      const menuChip = document.getElementById('menu-status-chip');
      if (menuChip) {
        if (dirty.size > 0) {
          menuChip.className = 'nle-chip nle-chip--warn';
          menuChip.textContent = `⚡ ${dirty.size} MODIFIED`;
          menuChip.title = files.join('\n');
        } else {
          menuChip.className = 'nle-chip nle-chip--ok';
          menuChip.textContent = '● ALL COMMITTED';
          menuChip.title = 'Clean working tree';
        }
      }
    });

    this.notesEditor = new NotesEditor(project.id, {
      getTime: () => this.t,
      getClip: () => this.timelineEntries.find((c) => this.t >= c.start && this.t < c.end)?.id ?? '',
      getBarBeat: () => {
        const timing = this.project.timing;
        if (!timing || !timing.downbeats || timing.downbeats.length === 0) return { bar: 1, beat: 1 };
        let barIdx = 0;
        for (let i = 0; i < timing.downbeats.length; i++) {
          if (timing.downbeats[i]! <= this.t) barIdx = i;
          else break;
        }
        const db = timing.downbeats[barIdx]!;
        const nextDb = timing.downbeats[barIdx + 1] ?? db + (timing.downbeats[1] ? timing.downbeats[1] - timing.downbeats[0]! : 1.2);
        const beatProg = ((this.t - db) / (nextDb - db)) * 4;
        return { bar: barIdx, beat: beatProg };
      },
      pause: () => {
        if (this.playing) this.toggle();
      },
    });
    this.renderDialog = new RenderDialog({
      projectId: project.id,
      getLoopRange: () => this.loop,
      getCurrentClip: () => this.timelineEntries.find((c) => !c.over && this.t >= c.start && this.t < c.end)?.id ?? '',
      onProgressUpdate: (progressMap) => {
        this.timeline.updateData({ renderProgress: progressMap });
      },
      onRenderStateChange: (state) => {
        this.transport.setRenderStatus(state);
      },
      engine: this.engine,
      canvas: this.canvas,
      fps: (project.video && typeof project.video === 'object' && 'fps' in project.video && typeof project.video.fps === 'number') ? project.video.fps : 30,
      duration: this.engine.duration,
      timelineEntries: this.timelineEntries,
    });
    this.metronome = new Metronome();
    this.perfGraph = new PerfGraph();
    const tlTitle = document.getElementById('tl-title-info');
    if (tlTitle) {
      const fps = (project.video && typeof project.video === 'object' && 'fps' in project.video && typeof project.video.fps === 'number') ? project.video.fps : 30;
      const bpm = project.timing?.bpm ?? 200;
      tlTitle.textContent = `[${fps} fps · ${Math.round(bpm)} BPM]`;
    }
    this.bindGlobalKeys();
    this.seek(this.t);
    this.startTick();
    this.attachHmr();
  }

  private setScale(scale: number) {
    this.canvas.style.transform = scale === 1 ? 'none' : `scale(${scale})`;
    this.canvas.style.transformOrigin = 'center center';
    this.fsControls.setScale(scale);
  }

  private toggle() {
    if (this.renderDialog.isWebCodecsRendering()) return;
    if (!this.playing && this.t >= this.engine.duration - 0.05) {
      this.seek(0);
    }
    this.audio.toggle();
    this.playing = this.audio.playing;
    this.transport.update({ playing: this.playing });
  }

  private toggleLoop() {
    if (this.loop) {
      this.loop = null;
    } else {
      const activeClip = this.timelineEntries.find((c) => this.t >= c.start && this.t < c.end);
      if (activeClip) this.loop = [activeClip.start, activeClip.end];
    }
    this.audio.setLoop(this.loop);
    this.timeline.setLoop(this.loop);
    this.transport.update({ loop: this.loop !== null });
    this.fsControls.setLoop(this.loop !== null);
  }

  private toggleFollow() {
    this.follow = !this.follow;
    try {
      localStorage.setItem(NleStudio.STORAGE_FOLLOW, String(this.follow));
    } catch {}
    this.timeline.setFollow(this.follow);
    this.transport.update({ follow: this.follow });
    const menuFollow = document.getElementById('menu-follow');
    if (menuFollow) menuFollow.classList.toggle('active', this.follow);
  }
  private setSpeed(speed: number) {
    this.speed = speed;
    try {
      localStorage.setItem(NleStudio.STORAGE_SPEED, String(speed));
    } catch {}
    this.audio.setPlaybackRate(speed);
    this.transport.update({ speed });
    this.fsControls.setSpeed(speed);
  }

  private getSections(): Array<{ name: string; start: number; end: number }> {
    if (this.project.timing?.sections?.length) {
      return this.project.timing.sections;
    }
    return this.timelineEntries.map((c) => ({ name: c.id, start: c.start, end: c.end }));
  }

  private sectionAt(t: number): number {
    const sections = this.getSections();
    let i = -1;
    for (let k = 0; k < sections.length; k++) {
      if (sections[k]!.start <= t) i = k;
    }
    return i;
  }

  private prevSection() {
    const sections = this.getSections();
    if (!sections.length) {
      this.seek(0);
      return;
    }
    const i = this.sectionAt(this.t);
    const cur = sections[i];
    this.seek(cur && this.t - cur.start > 2 ? cur.start : (sections[i - 1]?.start ?? 0));
  }

  private nextSection() {
    const sections = this.getSections();
    if (!sections.length) return;
    const n = sections.find((s) => s.start > this.t + 0.01);
    if (n) this.seek(n.start);
  }


  private seek(targetT: number) {
    if (this.renderDialog.isWebCodecsRendering()) return;
    this.audio.seek(targetT);
    this.t = this.audio.currentTime;
    this.timeline.setTime(this.t);
    this.updateTransportStatus();
  }

  private updateTransportStatus() {
    const activeClip = this.timelineEntries.find((c) => this.t >= c.start && this.t < c.end);
    const sections = this.getSections();
    const activeSection = sections[this.sectionAt(this.t)];
    const sectionName = activeSection?.name ?? activeClip?.id ?? '';

    this.transport.update({
      time: this.t,
      duration: this.engine.duration,
      bpm: this.project.timing?.bpm ?? 200,
      bar: this.engine.audio.barAt(this.t),
      beat: this.engine.audio.beatAt(this.t),
      fps: this.fps,
      playing: this.playing,
      speed: this.speed,
      clipId: activeClip?.id ?? '',
    });

    this.fsControls.update({
      time: this.t,
      duration: this.engine.duration,
      playing: this.playing,
      loop: this.loop !== null,
      sectionName,
      fps: this.fps,
      renderMs: this.renderMsAvg,
      speed: this.speed,
      projectId: this.project.id,
    });
  }

  private bindGlobalKeys() {
    window.addEventListener('keydown', (ev) => {
      if (ev.target instanceof HTMLElement && ev.target.closest('.cm-editor, .cm-tooltip, input, textarea, select, [contenteditable="true"], #notes-pane, #render-dialog, .nle-modal-overlay')) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'r') {
        ev.preventDefault();
        this.renderDialog.toggle();
        return;
      }
      if (document.fullscreenElement) {
        if (ev.key === 'PageUp') {
          ev.preventDefault();
          this.prevSection();
          return;
        } else if (ev.key === 'PageDown') {
          ev.preventDefault();
          this.nextSection();
          return;
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          this.fsControls.stepVolume(0.05);
          return;
        } else if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          this.fsControls.stepVolume(-0.05);
          return;
        } else if (ev.key === 'm' || ev.key === 'M') {
          ev.preventDefault();
          this.fsControls.toggleMute();
          return;
        } else if (ev.key === 'f' || ev.key === 'F') {
          ev.preventDefault();
          this.toggleFullscreen();
          return;
        }
      } else {
        if (ev.key === 'PageUp') {
          ev.preventDefault();
          this.prevSection();
          return;
        } else if (ev.key === 'PageDown') {
          ev.preventDefault();
          this.nextSection();
          return;
        }
      }


      if (ev.key === ' ') {
        ev.preventDefault();
        this.toggle();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        this.seek(this.t + (ev.shiftKey ? 5 : 1));
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        this.seek(this.t - (ev.shiftKey ? 5 : 1));
      } else if (ev.key === '.') {
        ev.preventDefault();
        this.seek(this.t + 1 / 30);
      } else if (ev.key === ',') {
        ev.preventDefault();
        this.seek(this.t - 1 / 30);
      } else if (ev.key === 'l' || ev.key === 'L') {
        ev.preventDefault();
        this.toggleLoop();
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        this.seek(0);
      } else if (ev.key === ']') {
        ev.preventDefault();
        const next = this.timelineEntries.find((c) => c.start > this.t + 0.01);
        if (next) this.seek(next.start);
      } else if (ev.key === '[') {
        ev.preventDefault();
        const prev = [...this.timelineEntries].reverse().find((c) => c.start < this.t - 0.3);
        if (prev) this.seek(prev.start);
      } else if (ev.key === 'f' || ev.key === 'F') {
        ev.preventDefault();
        this.toggleFollow();
      } else if (ev.key === 'J' || (ev.key === '[' && ev.shiftKey)) {
        ev.preventDefault();
        const SPEEDS = [0.25, 0.5, 1.0, 2.0];
        const idx = SPEEDS.findIndex((s) => Math.abs(s - this.speed) < 0.01);
        if (idx > 0) this.setSpeed(SPEEDS[idx - 1]!);
      } else if ((ev.key === 'L' && ev.shiftKey) || (ev.key === ']' && ev.shiftKey)) {
        ev.preventDefault();
        const SPEEDS = [0.25, 0.5, 1.0, 2.0];
        const idx = SPEEDS.findIndex((s) => Math.abs(s - this.speed) < 0.01);
        if (idx >= 0 && idx < SPEEDS.length - 1) this.setSpeed(SPEEDS[idx + 1]!);
      } else if (ev.key === 'n' || ev.key === 'N') {
        ev.preventDefault();
        this.notesEditor.toggle();
      } else if (ev.key === 'F11' || (ev.key === 'F' && ev.shiftKey)) {
        ev.preventDefault();
        this.toggleFullscreen();
      } else if (ev.key === 'm' || ev.key === 'M') {
        ev.preventDefault();
        this.metronome.toggle();
      } else if (ev.key === 'g' || ev.key === 'G') {
        ev.preventDefault();
        this.perfGraph.toggle();
      }
    });

    // Canvas click toggles play
    this.canvas.addEventListener('click', () => this.toggle());

    // Top menu items
    document.getElementById('menu-loop')?.addEventListener('click', () => this.toggleLoop());
    document.getElementById('menu-follow')?.addEventListener('click', () => this.toggleFollow());
    document.getElementById('menu-notes')?.addEventListener('click', () => this.notesEditor.toggle());
    document.getElementById('menu-graph')?.addEventListener('click', () => this.perfGraph.toggle());
    document.getElementById('menu-fullscreen')?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    document.getElementById('canvas-frame')?.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button, select, input, #snippet-overlay, .pl-controls')) return;
      this.toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      const isFs = !!document.fullscreenElement;
      this.updateFullscreenState(isFs);
    });
  }

  private toggleFullscreen() {
    const frame = document.getElementById('canvas-frame');
    if (!frame) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void frame.requestFullscreen().catch(() => {});
    }
  }

  private updateFullscreenState(isFs: boolean) {
    const frame = document.getElementById('canvas-frame');
    frame?.classList.toggle('is-fullscreen', isFs);
    this.transport.setFullscreen(isFs);
    this.fsControls.setFullscreen(isFs);
    const menuFs = document.getElementById('menu-fullscreen');
    if (menuFs) {
      menuFs.classList.toggle('active', isFs);
      menuFs.textContent = isFs ? 'Exit Fullscreen (Escape)' : 'Fullscreen (F11)';
    }
  }

  private startTick() {
    const tick = () => {
      const tickT = performance.now();
      this.playing = this.audio.playing;
      if (this.playing) {
        this.t = this.audio.currentTime;
        if (!this.loop && this.t >= this.engine.duration) {
          this.audio.pause();
          this.seek(0);
          this.playing = false;
          this.transport.update({ playing: false, time: 0 });
        }
      }

      // Metronome beat tick & visual pulse
      const beat = this.engine.audio.beatAt(this.t);
      const bar = this.engine.audio.barAt(this.t);
      const barIdx = Math.floor(bar);
      const downbeats = this.engine.audio.downbeats;
      const beat0 = downbeats && downbeats[barIdx] !== undefined
        ? Math.round(this.engine.audio.beatAt(downbeats[barIdx]!))
        : barIdx * 4;
      const beatInBar = Math.max(0, Math.floor(beat)) - beat0 + 1;
      const isDownbeat = beatInBar === 1;
      this.metronome.tick(this.playing, beat, isDownbeat);

      // Render frame in engine with timing
      const t0 = performance.now();
      this.engine.render(this.t, 1 / 60);
      const renderMs = performance.now() - t0;
      this.renderMsAvg = this.renderMsAvg * 0.85 + renderMs * 0.15;
      // a reload of an edited scene may run in the time this frame left over
      const until = tickT + NleStudio.FRAME_MS;
      this.engine.paceLoads(until);
      if (this.budgetWaiter && performance.now() < until) {
        const go = this.budgetWaiter;
        this.budgetWaiter = null;
        go();
      }
      if (!this.pumping && this.nextJob()) void this.pump();
      this.timeline.setTime(this.t);

      // Measure playback FPS
      this.frames++;
      const now = performance.now();
      const intervalMs = this.lastTickT > 0 ? now - this.lastTickT : 16.67;
      this.lastTickT = now;
      if (now - this.fpsT > 250) {
        this.fps = (this.frames * 1000) / (now - this.fpsT);
        this.frames = 0;
        this.fpsT = now;
        this.updateMonitorFps();
      }
      this.perfGraph.record(renderMs, intervalMs, this.fps);
      this.updateTransportStatus();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  private updateMonitorFps() {
    const fpsEl = document.getElementById('monitor-fps');
    const msEl = document.getElementById('monitor-ms');
    if (!fpsEl || !msEl) return;
    fpsEl.textContent = `${this.fps.toFixed(1)} FPS`;
    msEl.textContent = `${this.renderMsAvg.toFixed(1)} ms`;
    fpsEl.style.color = this.fps >= 55 ? '#4ade80' : this.fps >= 30 ? '#fbbf24' : '#f87171';
  }


  /** Clips whose scene module changed: they draw the old scene until pump reloads them. */
  private stale = new Set<TimelineEntry>();
  private overlayStale = false;
  private reloadTimer = 0;
  private pumping = false;
  /** Resolves in the next tick that has time left after its frame (see frameBudget). */
  private budgetWaiter: (() => void) | null = null;
  /** The share of a 60 Hz frame that the render plus the scene loads may take. */
  private static FRAME_MS = 1000 / 60 - 2;

  private attachHmr() {
    if (!import.meta.hot) return;
    import.meta.hot.on('pve:scene-reload', (data: { projectId: string; scenes: string[]; versions: Record<string, string>; timestamp: number }) => {
      if (data.projectId !== this.project.id) return;
      for (const s of data.scenes) updateSceneTimestamp(s, data.timestamp);
      for (const e of this.timelineEntries) {
        if (!e.scene || !data.scenes.includes(e.scene)) continue;
        // the new code version: a memo of the old code is not used (no version: the clip computes)
        const v = data.versions[e.scene];
        if (v === undefined) delete e.version;
        else e.version = v;
        this.stale.add(e);
      }
      if (this.engine.overlayScene && data.scenes.includes(this.engine.overlayScene)) this.overlayStale = true;
      // an agent saves a file several times in a row: reload once after the burst (startTick starts the pump)
      clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => { this.reloadTimer = 0; }, 250);
    });
  }

  /** The next reload: the overlay, then clips at or 3 s ahead of the playhead, then (paused only) the others. */
  private nextJob(): TimelineEntry | 'overlay' | null {
    if (this.reloadTimer !== 0) return null;
    if (this.overlayStale) return 'overlay';
    const t = this.t;
    for (const e of this.stale) if (e.start <= t + 3 && e.end >= t) return e;
    if (this.playing) return null;
    for (const e of this.stale) return e;
    return null;
  }

  /** Waits for a tick whose frame left time over. */
  private frameBudget(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.budgetWaiter = resolve;
    return promise;
  }

  /**
   * Reloads edited scenes one at a time in the time frames leave over (a scene init is main-thread work). A load that awaits
   * ctx.slice() spreads over frames. One that does not runs whole, so the frame it starts in is late by its init time.
   */
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        await this.frameBudget();
        // (picked after the wait: the playhead may have moved)
        const job = this.nextJob();
        if (!job) break;
        if (job === 'overlay') {
          this.overlayStale = false;
          await this.engine.reloadOverlay();
        } else {
          this.stale.delete(job);
          await this.engine.reload(job.id);
          this.badges.markReloaded(job.id);
        }
        this.showErrors();
      }
    } finally {
      this.pumping = false;
    }
  }

  private showErrors() {
    const errs = document.getElementById('errs');
    if (!errs || !this.engine.errors.length) return;
    errs.textContent = this.engine.errors.join('\n\n');
    errs.classList.add('visible');
  }
}

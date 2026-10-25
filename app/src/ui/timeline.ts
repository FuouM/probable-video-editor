// Multi-track NLE Timeline Canvas for pve-next
// Implements Lyric-Sync standard timeline drawing:
// - Hierarchical Ruler with major/minor tick marks, timecode, and gold downbeats
// - Video Clips with 14px header bands, agent change badges, and HMR reload flashes
// - Sections with WinForms desktop pills
// - Syllable-level lyrics track with active syllable gold illumination
// - Peak-normalized mirrored waveform with baseline
// - Full-song overview mini-map scrollbar
// - Snapping with vertical dashed snap guides
// Zero blur, zero ambient glow shadows, zero scale transforms. Clean 1px desktop rendering.

import type { Features, SongTiming } from '@pve/core';
import type { TimelineEntry } from '@pve/engine/engine';
import type { Lyrics } from '@pve/engine/lyrics';

export interface TimelineData {
  duration: number;
  timeline: TimelineEntry[];
  timing: SongTiming;
  features?: Features;
  lyrics: Lyrics;
  dirtyClips: Set<string>;
  reloadedClips: Map<string, number>; // clipId -> timestamp reloaded
  renderProgress?: Map<string, { percent: number; status: 'pending' | 'rendering' | 'done' }>;
}

export interface TimelineCallbacks {
  onSeek: (t: number) => void;
  onClipSelect: (clip: TimelineEntry, loop: boolean) => void;
  onClipDoubleClick: (clip: TimelineEntry) => void;
}

const TRACK_RULER = { y: 0, h: 26 };
const TRACK_CLIPS = { y: 26, h: 52 };
const TRACK_OVER = { y: 78, h: 18 };
const TRACK_SECTIONS = { y: 96, h: 24 };
const TRACK_LYRICS = { y: 120, h: 44 };
const TRACK_WAVE = { y: 164, h: 54 };
const TRACK_OVERVIEW = { y: 218, h: 18 };
const TOTAL_H = 236;

const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

export class NleTimeline {
  private c: CanvasRenderingContext2D;
  private width = 800;
  private height = TOTAL_H;
  private viewStart = 0;
  private viewDuration = 30; // default 30s zoom window
  private currentTime = 0;
  private loop: [number, number] | null = null;
  private dragging: 'scrub' | 'pan' | 'overview' | null = null;
  private panStartX = 0;
  private panStartView = 0;
  private overviewDragOffset = 0;
  private snapGuide: { time: number; label: string } | null = null;
  private follow = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private data: TimelineData,
    private cb: TimelineCallbacks,
  ) {
    this.c = canvas.getContext('2d')!;
    this.viewDuration = Math.min(data.duration, 40);
    this.attachEvents();
    this.resize();
  }

  updateData(partial: Partial<TimelineData>) {
    Object.assign(this.data, partial);
    this.draw();
  }

  setFollow(enabled: boolean) {
    this.follow = enabled;
    if (this.follow && (this.currentTime > this.viewStart + this.viewDuration || this.currentTime < this.viewStart)) {
      this.viewStart = Math.max(0, Math.min(this.data.duration - this.viewDuration, this.currentTime - 2));
    }
    this.draw();
  }

  setTime(t: number) {
    this.currentTime = t;
    if (this.follow) {
      if (t > this.viewStart + this.viewDuration - 1) {
        this.viewStart = Math.min(this.data.duration - this.viewDuration, t - 2);
      } else if (t < this.viewStart) {
        this.viewStart = Math.max(0, t - 2);
      }
    }
    this.draw();
  }

  setLoop(range: [number, number] | null) {
    this.loop = range;
    this.draw();
  }

  zoom(factor: number) {
    const centerT = this.viewStart + this.viewDuration / 2;
    const newDur = Math.max(2, Math.min(this.data.duration, this.viewDuration * factor));
    this.viewStart = Math.max(0, Math.min(this.data.duration - newDur, centerT - newDur / 2));
    this.viewDuration = newDur;
    this.draw();
  }

  zoomFit() {
    this.viewStart = 0;
    this.viewDuration = this.data.duration;
    this.draw();
  }

  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = TOTAL_H;
    this.canvas.style.width = '100%';
    this.canvas.style.height = `${TOTAL_H}px`;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(TOTAL_H * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private tToX(t: number): number {
    return ((t - this.viewStart) / this.viewDuration) * this.width;
  }

  private xToT(x: number): number {
    return this.viewStart + (x / this.width) * this.viewDuration;
  }

  private findSnap(rawT: number): { time: number; label: string } {
    const tolPx = 8;
    const tol = (tolPx / this.width) * this.viewDuration;
    let best = { time: rawT, label: '', d: tol };

    // Snap to downbeats (bars)
    for (let i = 0; i < (this.data.timing?.downbeats?.length ?? 0); i++) {
      const db = this.data.timing.downbeats[i]!;
      const d = Math.abs(db - rawT);
      if (d < best.d) best = { time: db, label: `BAR ${i + 1}`, d };
    }

    // Snap to clip boundaries
    for (const clip of this.data.timeline) {
      for (const t of [clip.start, clip.end]) {
        const d = Math.abs(t - rawT);
        if (d < best.d) best = { time: t, label: clip.id.toUpperCase(), d };
      }
    }

    return best.label ? { time: best.time, label: best.label } : { time: rawT, label: '' };
  }

  draw() {
    const c = this.c;
    const w = this.width, h = this.height;
    if (w <= 0 || h <= 0) return;

    // Background
    c.fillStyle = '#0f1013';
    c.fillRect(0, 0, w, h);

    const now = performance.now();

    // 1. Grid lines (Beats & Downbeats)
    this.drawGrid(c);

    // 2. Loop region highlight
    // 2. Loop region highlight & high-contrast outside dimming
    if (this.loop) {
      const x0 = this.tToX(this.loop[0]), x1 = this.tToX(this.loop[1]);
      const contentTop = TRACK_RULER.h;
      const contentBottom = h - TRACK_OVERVIEW.h;

      // Dim regions outside loop for sharp focus
      c.fillStyle = 'rgba(0, 0, 0, 0.45)';
      if (x0 > 0) c.fillRect(0, contentTop, Math.min(w, x0), contentBottom - contentTop);
      if (x1 < w) c.fillRect(Math.max(0, x1), contentTop, w - Math.max(0, x1), contentBottom - contentTop);

      // Subtle warm highlight inside loop
      c.fillStyle = 'rgba(245, 158, 11, 0.08)';
      c.fillRect(Math.max(0, x0), contentTop, Math.min(w, x1) - Math.max(0, x0), contentBottom - contentTop);

      // Solid 2px amber boundary needles
      c.strokeStyle = '#f59e0b';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(Math.round(x0) + 0.5, 0); c.lineTo(Math.round(x0) + 0.5, contentBottom);
      c.moveTo(Math.round(x1) + 0.5, 0); c.lineTo(Math.round(x1) + 0.5, contentBottom);
      c.stroke();

      // Ruler Loop Ribbon (top 10px of ruler)
      if (x1 > 0 && x0 < w) {
        c.fillStyle = 'rgba(245, 158, 11, 0.28)';
        c.fillRect(x0, 0, x1 - x0, 10);
        c.strokeStyle = '#f59e0b';
        c.lineWidth = 1;
        c.strokeRect(x0, 0, x1 - x0, 10);

        // In flag (bracket arrow pointing right)
        c.fillStyle = '#f59e0b';
        c.beginPath();
        c.moveTo(x0, 0); c.lineTo(x0 + 7, 0); c.lineTo(x0, 10);
        c.closePath(); c.fill();

        // Out flag (bracket arrow pointing left)
        c.beginPath();
        c.moveTo(x1, 0); c.lineTo(x1 - 7, 0); c.lineTo(x1, 10);
        c.closePath(); c.fill();

        if (x1 - x0 > 45) {
          c.font = 'bold 8.5px "Cascadia Mono", Consolas, monospace';
          c.fillStyle = '#f59e0b';
          c.textBaseline = 'middle';
          c.fillText(`LOOP ${(this.loop[1] - this.loop[0]).toFixed(2)}s`, x0 + 10, 5);
        }
      }
    }

    // 3. Ruler Track (ticks, bar numbers, timecode)
    this.drawRuler(c, w);

    // 4. Video Clips Track (with live agent change badges)
    this.drawClips(c, now);
    this.drawTransitions(c);

    // 5. Sections Track
    this.drawSections(c);

    // 6. Lyrics Track (word & syllable blocks)
    this.drawLyrics(c);

    // 7. Waveform Track
    this.drawWaveform(c, w);

    // 8. Overview Mini-Map Scrollbar
    this.drawOverview(c, w);

    // 9. Snap Guide
    if (this.snapGuide?.label) {
      const sx = Math.round(this.tToX(this.snapGuide.time)) + 0.5;
      c.strokeStyle = '#00e5ff';
      c.setLineDash([4, 3]);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(sx, TRACK_RULER.h);
      c.lineTo(sx, h - TRACK_OVERVIEW.h);
      c.stroke();
      c.setLineDash([]);

      c.font = 'bold 9px "Segoe UI", sans-serif';
      const tw = c.measureText(this.snapGuide.label).width + 8;
      c.fillStyle = '#00e5ff';
      c.fillRect(sx + 3, TRACK_RULER.h + 2, tw, 13);
      c.fillStyle = '#001318';
      c.fillText(this.snapGuide.label, sx + 7, TRACK_RULER.h + 12);
    }

    // 10. Playhead needle across all tracks
    this.drawPlayhead(c, h);
  }

  private drawGrid(c: CanvasRenderingContext2D) {
    const timing = this.data.timing;
    if (!timing) return;
    const t0 = this.viewStart, t1 = this.viewStart + this.viewDuration;
    const contentBottom = this.height - TRACK_OVERVIEW.h;

    // Sub-beats
    c.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    c.lineWidth = 1;
    c.beginPath();
    for (const b of timing.beats ?? []) {
      if (b < t0 || b > t1) continue;
      const x = Math.round(this.tToX(b)) + 0.5;
      c.moveTo(x, TRACK_RULER.h);
      c.lineTo(x, contentBottom);
    }
    c.stroke();

    // Downbeats (Bars)
    c.strokeStyle = 'rgba(245, 158, 11, 0.22)';
    c.lineWidth = 1;
    c.beginPath();
    for (const db of timing.downbeats ?? []) {
      if (db < t0 || db > t1) continue;
      const x = Math.round(this.tToX(db)) + 0.5;
      c.moveTo(x, 0);
      c.lineTo(x, contentBottom);
    }
    c.stroke();
  }

  private drawRuler(c: CanvasRenderingContext2D, w: number) {
    c.fillStyle = '#14161c';
    c.fillRect(0, 0, w, TRACK_RULER.h);
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, TRACK_RULER.h + 0.5);
    c.lineTo(w, TRACK_RULER.h + 0.5);
    c.stroke();

    const pxPerSec = w / this.viewDuration;
    const step = RULER_STEPS.find((s) => s * pxPerSec >= 70) ?? 300;
    const minor = step / 5;

    // Major and minor tick marks (Lyric-Sync standard)
    c.strokeStyle = '#4a5160';
    c.lineWidth = 1;
    c.beginPath();
    const firstMinor = Math.floor(this.viewStart / minor) * minor;
    for (let t = firstMinor; t <= this.viewStart + this.viewDuration; t += minor) {
      if (t < 0) continue;
      const x = Math.round(this.tToX(t)) + 0.5;
      const isMajor = Math.abs(t / step - Math.round(t / step)) < 1e-5;
      c.moveTo(x, TRACK_RULER.h - (isMajor ? 10 : 4));
      c.lineTo(x, TRACK_RULER.h);
    }
    c.stroke();

    // Second time stamps
    c.font = '9px "Cascadia Mono", Consolas, monospace';
    c.fillStyle = '#64748b';
    c.textBaseline = 'top';
    const firstMajor = Math.floor(this.viewStart / step) * step;
    for (let t = firstMajor; t <= this.viewStart + this.viewDuration; t += step) {
      if (t < 0) continue;
      const x = this.tToX(t);
      const m = Math.floor(t / 60), s = t % 60;
      c.fillText(`${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`, x + 4, 13);
    }

    // Bar numbers in gold, dynamically culled so they never overlap
    const timing = this.data.timing;
    const downs = timing?.downbeats ?? [];
    if (downs.length > 1) {
      const beatInterval = downs[1]! - downs[0]!;
      const pxPerBar = pxPerSec * beatInterval;
      const every = pxPerBar >= 36 ? 1 : pxPerBar >= 18 ? 2 : pxPerBar >= 9 ? 4 : pxPerBar >= 4.5 ? 8 : 16;

      c.font = 'bold 9px "Cascadia Mono", Consolas, monospace';
      c.fillStyle = '#f59e0b';
      for (let i = 0; i < downs.length; i++) {
        const bar = i + 1;
        if (((bar - 1) % every) !== 0) continue;
        const db = downs[i]!;
        if (db < this.viewStart - beatInterval || db > this.viewStart + this.viewDuration) continue;
        const x = this.tToX(db);
        c.fillText(`B${bar}`, x + 4, 3);
      }
    }
  }

  private drawClips(c: CanvasRenderingContext2D, now: number) {
    const y0 = TRACK_CLIPS.y, th = TRACK_CLIPS.h;
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y0 + th + 0.5);
    c.lineTo(this.width, y0 + th + 0.5);
    c.stroke();

    const t0 = this.viewStart, t1 = this.viewStart + this.viewDuration;
    for (const clip of this.data.timeline) {
      if (clip.over) continue;
      if (clip.end < t0 || clip.start > t1) continue;
      const x0 = Math.max(0, this.tToX(clip.start));
      const x1 = Math.min(this.width, this.tToX(clip.end));
      const cw = Math.max(2, x1 - x0);

      const isDirty = this.data.dirtyClips.has(clip.id);
      const reloadTime = this.data.reloadedClips.get(clip.id);
      const isReloaded = reloadTime !== undefined && (now - reloadTime < 3000);
      const isLooping = this.loop !== null && Math.abs(clip.start - this.loop[0]) < 0.05 && Math.abs(clip.end - this.loop[1]) < 0.05;

      // WinForms NLE Clip Styling
      let fillCol = '#2d5f9a';
      let borderCol = '#3b82f6';
      let headCol = '#22476f';

      const prog = this.data.renderProgress?.get(clip.id);
      if (prog) {
        if (prog.status === 'done') {
          fillCol = '#064e3b';
          borderCol = '#10b981';
          headCol = '#10b981';
        } else if (prog.status === 'rendering') {
          fillCol = '#0f4c5c';
          borderCol = '#00e5ff';
          headCol = '#00e5ff';
        }
      } else if (isReloaded) {
        fillCol = '#0f4c5c';
        borderCol = '#00e5ff';
        headCol = '#00e5ff';
      } else if (isDirty) {
        fillCol = '#5a3810';
        borderCol = '#f59e0b';
        headCol = '#f59e0b';
      } else if (isLooping) {
        fillCol = '#2a3d5e';
        borderCol = '#f59e0b';
        headCol = '#d97706';
      }

      // Clip body
      c.fillStyle = fillCol;
      c.fillRect(x0 + 0.5, y0 + 1.5, cw - 1, th - 3);
      if (prog && prog.status === 'rendering') {
        c.fillStyle = 'rgba(0, 229, 255, 0.25)';
        c.fillRect(x0 + 0.5, y0 + 1.5, Math.max(0, (cw - 1) * (prog.percent / 100)), th - 3);
      }

      // Clip 1px border
      c.strokeStyle = borderCol;
      c.lineWidth = 1;
      c.strokeRect(x0 + 0.5, y0 + 1.5, cw - 1, th - 3);

      // Clip 13px header bar
      c.fillStyle = headCol;
      c.fillRect(x0 + 1.5, y0 + 2.5, cw - 3, 13);

      // Clip Label & Agent Badge
      if (cw > 18) {
        c.font = 'bold 9.5px "Cascadia Mono", Consolas, monospace';
        c.textBaseline = 'middle';

        if (prog && prog.status === 'done') {
          c.fillStyle = '#ffffff';
          c.fillText(`✓ ${clip.id}`, x0 + 4, y0 + 9);
        } else if (prog && prog.status === 'rendering') {
          c.fillStyle = '#000000';
          c.fillText(`${clip.id} ${prog.percent}%`, x0 + 4, y0 + 9);
        } else {
          c.fillStyle = (isReloaded || isDirty) ? '#000000' : isLooping ? '#ffffff' : '#cbd5e1';
          const prefix = isLooping ? '🔁 ' : '';
          c.fillText(`${prefix}${clip.id}`, x0 + 4, y0 + 9);
        }

        if (cw > 40) {
          c.font = '9px "Segoe UI", Tahoma, sans-serif';
          c.fillStyle = '#f1f5f9';
          c.fillText(`${(clip.end - clip.start).toFixed(2)}s`, x0 + 4, y0 + 26);

          const brief = clip.params?.brief as string | undefined;
          if (brief && cw > 110) {
            c.fillStyle = '#94a3b8';
            const bStr = brief.length > 25 ? brief.slice(0, 22) + '...' : brief;
            c.fillText(bStr, x0 + 4, y0 + 40);
          }
        }
      }
    }
  }

  /** Over transitions (video.json `transitions`): a hatched bar each, its cut marked. */
  private drawTransitions(c: CanvasRenderingContext2D) {
    const y0 = TRACK_OVER.y, th = TRACK_OVER.h;
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y0 + th + 0.5);
    c.lineTo(this.width, y0 + th + 0.5);
    c.stroke();
    const t0 = this.viewStart, t1 = this.viewStart + this.viewDuration;
    for (const tr of this.data.timeline) {
      if (!tr.over || tr.end < t0 || tr.start > t1) continue;
      const x0 = this.tToX(tr.start), x1 = this.tToX(tr.end), cw = Math.max(2, x1 - x0);
      const dirty = this.data.dirtyClips.has(tr.id);
      c.save();
      c.beginPath();
      c.rect(x0 + 0.5, y0 + 2.5, cw - 1, th - 5);
      c.clip();
      c.fillStyle = dirty ? '#5a3810' : '#3b2a52';
      c.fillRect(x0, y0 + 2, cw, th - 4);
      c.strokeStyle = 'rgba(255,255,255,0.10)';
      c.beginPath();
      for (let x = x0 - th; x < x1; x += 6) { c.moveTo(x, y0 + th); c.lineTo(x + th, y0); }
      c.stroke();
      c.restore();
      c.strokeStyle = dirty ? '#f59e0b' : '#a78bfa';
      c.strokeRect(x0 + 0.5, y0 + 2.5, cw - 1, th - 5);
      const at = tr.params?.at as number | undefined;
      if (at !== undefined) {
        const xa = Math.round(this.tToX(at)) + 0.5;
        c.beginPath();
        c.moveTo(xa, y0 + 1);
        c.lineTo(xa, y0 + th - 1);
        c.stroke();
      }
      if (cw > 24) {
        c.font = 'bold 9px "Cascadia Mono", Consolas, monospace';
        c.textBaseline = 'middle';
        c.fillStyle = '#e9d5ff';
        c.fillText(tr.id, x0 + 4, y0 + th / 2);
      }
    }
  }

  private drawSections(c: CanvasRenderingContext2D) {
    const y0 = TRACK_SECTIONS.y, th = TRACK_SECTIONS.h;
    c.fillStyle = '#14161c';
    c.fillRect(0, y0, this.width, th);
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y0 + th + 0.5);
    c.lineTo(this.width, y0 + th + 0.5);
    c.stroke();

    const sections = this.data.timing?.sections;
    if (!sections) return;
    const t0 = this.viewStart, t1 = this.viewStart + this.viewDuration;

    c.font = '9.5px "Segoe UI", Tahoma, sans-serif';
    c.textBaseline = 'middle';

    for (const sec of sections) {
      if (sec.end < t0 || sec.start > t1) continue;
      const x0 = Math.max(0, this.tToX(sec.start));
      const x1 = Math.min(this.width, this.tToX(sec.end));
      const cw = x1 - x0;

      c.fillStyle = '#1e293b';
      c.fillRect(x0 + 0.5, y0 + 2.5, cw - 1, th - 5);
      c.strokeStyle = '#334155';
      c.strokeRect(x0 + 0.5, y0 + 2.5, cw - 1, th - 5);

      if (cw > 26) {
        c.fillStyle = '#e2e8f0';
        c.fillText(sec.name, x0 + 6, y0 + th / 2);
      }
    }
  }

  private drawLyrics(c: CanvasRenderingContext2D) {
    const y0 = TRACK_LYRICS.y, th = TRACK_LYRICS.h;
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y0 + th + 0.5);
    c.lineTo(this.width, y0 + th + 0.5);
    c.stroke();

    const lyrics = this.data.lyrics;
    if (!lyrics) return;
    const t0 = this.viewStart, t1 = this.viewStart + this.viewDuration;
    const now = this.currentTime;

    c.font = '9.5px "Segoe UI", Tahoma, sans-serif';
    c.textBaseline = 'middle';

    for (const line of lyrics.lines) {
      if (line.end < t0 || line.start > t1) continue;
      for (const word of line.words) {
        if (word.end < t0 || word.start > t1) continue;
        const x0 = this.tToX(word.start);
        const x1 = this.tToX(word.end);
        const cw = Math.max(2, x1 - x0);
        const active = now >= word.start && now < word.end;

        c.fillStyle = active ? '#78350f' : '#1e293b';
        c.fillRect(x0 + 0.5, y0 + 3.5, cw - 1, th - 7);
        c.strokeStyle = active ? '#f59e0b' : '#334155';
        c.strokeRect(x0 + 0.5, y0 + 3.5, cw - 1, th - 7);

        if (cw > 14) {
          c.fillStyle = active ? '#fbbf24' : '#cbd5e1';
          c.fillText(word.w, x0 + 3, y0 + th / 2);
        }
      }
    }
  }

  private drawWaveform(c: CanvasRenderingContext2D, w: number) {
    const y0 = TRACK_WAVE.y, th = TRACK_WAVE.h;
    c.fillStyle = '#111317';
    c.fillRect(0, y0, w, th);
    c.strokeStyle = '#282c37';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, y0 + th + 0.5);
    c.lineTo(w, y0 + th + 0.5);
    c.stroke();

    const rms = this.data.features?.envelopes?.rms;
    if (!rms || rms.length === 0) return;

    const midY = y0 + th / 2;
    const maxAmp = (th / 2) - 4;
    const t0 = this.viewStart, dt = this.viewDuration / w;

    // Baseline
    c.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    c.beginPath();
    c.moveTo(0, midY); c.lineTo(w, midY);
    c.stroke();

    // Peak waveform
    c.fillStyle = '#208b7e';
    for (let px = 0; px < w; px++) {
      const t = t0 + px * dt;
      const idx = Math.floor(t * 100);
      if (idx < 0 || idx >= rms.length) continue;
      const amp = rms[idx]! * maxAmp;
      if (amp >= 0.5) c.fillRect(px, midY - amp, 1, amp * 2);
    }
  }

  private drawOverview(c: CanvasRenderingContext2D, w: number) {
    const y0 = TRACK_OVERVIEW.y, th = TRACK_OVERVIEW.h;
    const total = Math.max(1, this.data.duration);

    c.fillStyle = '#0a0b0e';
    c.fillRect(0, y0, w, th);
    c.strokeStyle = '#1e293b';
    c.lineWidth = 1;
    c.strokeRect(0, y0 + 0.5, w, th - 1);

    // Mini clip blocks
    for (const clip of this.data.timeline) {
      if (clip.over) continue;
      const x0 = (clip.start / total) * w, x1 = (clip.end / total) * w;
      const isDirty = this.data.dirtyClips.has(clip.id);
      c.fillStyle = isDirty ? '#f59e0b' : '#334155';
      c.fillRect(x0, y0 + 2, Math.max(1, x1 - x0), th - 4);
    }

    // Loop region in overview
    if (this.loop) {
      const lx0 = (this.loop[0] / total) * w, lx1 = (this.loop[1] / total) * w;
      c.fillStyle = 'rgba(245, 158, 11, 0.35)';
      c.fillRect(lx0, y0 + 1, Math.max(2, lx1 - lx0), th - 2);
      c.strokeStyle = '#f59e0b';
      c.lineWidth = 1;
      c.strokeRect(lx0, y0 + 1, Math.max(2, lx1 - lx0), th - 2);
    }

    // Viewport box
    const vx0 = (this.viewStart / total) * w;
    const vx1 = ((this.viewStart + this.viewDuration) / total) * w;
    const vw = Math.max(6, vx1 - vx0);

    c.fillStyle = 'rgba(255, 255, 255, 0.08)';
    c.fillRect(vx0, y0 + 1, vw, th - 2);
    c.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    c.lineWidth = 1;
    c.strokeRect(vx0 + 0.5, y0 + 1.5, vw - 1, th - 3);

    // Playhead in overview
    const px = (this.currentTime / total) * w;
    c.fillStyle = '#ff3b30';
    c.fillRect(px - 1, y0, 2, th);
  }

  private drawPlayhead(c: CanvasRenderingContext2D, h: number) {
    const px = Math.round(this.tToX(this.currentTime)) + 0.5;
    if (px < -6 || px > this.width + 6) return;

    const contentBottom = h - TRACK_OVERVIEW.h;

    // Needle line
    c.strokeStyle = '#ff3b30';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(px, TRACK_RULER.y + 12);
    c.lineTo(px, contentBottom);
    c.stroke();

    // Top arrow badge (Lyric-Sync standard)
    c.fillStyle = '#ff3b30';
    c.beginPath();
    c.moveTo(px - 6, TRACK_RULER.y + 2);
    c.lineTo(px + 6, TRACK_RULER.y + 2);
    c.lineTo(px + 6, TRACK_RULER.y + 9);
    c.lineTo(px, TRACK_RULER.y + 15);
    c.lineTo(px - 6, TRACK_RULER.y + 9);
    c.closePath();
    c.fill();
  }

  private attachEvents() {
    const el = this.canvas;

    el.addEventListener('mousedown', (ev) => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;

      // Click on Overview Track
      if (y >= TRACK_OVERVIEW.y) {
        this.dragging = 'overview';
        const total = Math.max(1, this.data.duration);
        const vx0 = (this.viewStart / total) * this.width;
        const vx1 = ((this.viewStart + this.viewDuration) / total) * this.width;
        if (x >= vx0 && x <= vx1) {
          this.overviewDragOffset = x - vx0;
        } else {
          this.viewStart = Math.max(0, Math.min(this.data.duration - this.viewDuration, (x / this.width) * total - this.viewDuration / 2));
          this.overviewDragOffset = (this.viewDuration / 2 / total) * this.width;
        }
        this.draw();
        return;
      }

      // Middle click or Alt+click: pan view
      if (ev.button === 1 || ev.altKey) {
        this.dragging = 'pan';
        this.panStartX = x;
        this.panStartView = this.viewStart;
        return;
      }

      // Click on the clips or transitions track: select it (shift: loop it)
      const hit = this.entryAt(x, y);
      if (hit) {
        this.cb.onClipSelect(hit, ev.shiftKey);
        return;
      }

      // Scrub playhead with snapping
      this.dragging = 'scrub';
      const rawT = this.xToT(x);
      const snap = this.findSnap(rawT);
      this.snapGuide = snap.label ? snap : null;
      this.cb.onSeek(snap.time);
    });

    // Double-click on Video Clips Track: engage loop and seek
    el.addEventListener('dblclick', (ev) => {
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      const hit = this.entryAt(x, y);
      if (hit) this.cb.onClipDoubleClick(hit);
    });

    window.addEventListener('mousemove', (ev) => {
      if (!this.dragging) return;
      const rect = el.getBoundingClientRect();
      const x = ev.clientX - rect.left;

      if (this.dragging === 'scrub') {
        const rawT = Math.max(0, Math.min(this.data.duration, this.xToT(x)));
        const snap = this.findSnap(rawT);
        this.snapGuide = snap.label ? snap : null;
        this.cb.onSeek(snap.time);
      } else if (this.dragging === 'pan') {
        const dx = x - this.panStartX;
        const dt = (dx / this.width) * this.viewDuration;
        this.viewStart = Math.max(0, Math.min(this.data.duration - this.viewDuration, this.panStartView - dt));
        this.draw();
      } else if (this.dragging === 'overview') {
        const total = Math.max(1, this.data.duration);
        const targetVx = x - this.overviewDragOffset;
        this.viewStart = Math.max(0, Math.min(this.data.duration - this.viewDuration, (targetVx / this.width) * total));
        this.draw();
      }
    });

    window.addEventListener('mouseup', () => {
      this.dragging = null;
      this.snapGuide = null;
      this.draw();
    });

    // Zoom & Pan via Mouse Wheel
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = ev.clientX - rect.left;
      const mouseT = this.xToT(mouseX);

      if (ev.ctrlKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
        const zoomFactor = ev.deltaY < 0 ? 0.8 : 1.25;
        const newDur = Math.max(2, Math.min(this.data.duration, this.viewDuration * zoomFactor));
        const ratio = mouseX / this.width;
        this.viewStart = Math.max(0, Math.min(this.data.duration - newDur, mouseT - ratio * newDur));
        this.viewDuration = newDur;
      } else {
        const dt = (ev.deltaX / this.width) * this.viewDuration;
        this.viewStart = Math.max(0, Math.min(this.data.duration - this.viewDuration, this.viewStart + dt));
      }
      this.draw();
    }, { passive: false });

    window.addEventListener('resize', () => this.resize());
  }

  /** The clip (clips track) or Over transition (transitions track) under a point of the canvas. */
  private entryAt(x: number, y: number) {
    const over = y >= TRACK_OVER.y && y < TRACK_OVER.y + TRACK_OVER.h;
    if (!over && !(y >= TRACK_CLIPS.y && y < TRACK_CLIPS.y + TRACK_CLIPS.h)) return undefined;
    const t = this.xToT(x);
    return this.data.timeline.find((c) => !!c.over === over && t >= c.start && t < c.end);
  }
}

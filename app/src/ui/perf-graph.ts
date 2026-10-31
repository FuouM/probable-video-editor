// app/src/ui/perf-graph.ts
// Real-time Frametime (ms) & FPS rolling graph docked side pane for pve Studio NLE.
// Deterministic ring buffer, sub-millisecond precision, 16.7ms (60fps) and 33.3ms (30fps) budget thresholds.
// Positioned outside preview as a dedicated dock pane, matching Notes pane lifecycle.

export type PerfGraphMode = 'frametime' | 'fps';

export class PerfGraph {
  private static STORAGE_KEY = 'pve.studio.graph';
  private static STORAGE_MODE_KEY = 'pve.studio.graph.mode';
  private static BUFFER_SIZE = 180; // ~3 seconds at 60fps, ~6 seconds at 30fps

  private enabled = false;
  private mode: PerfGraphMode = 'frametime';

  // Ring buffers
  private renderTimes = new Float32Array(PerfGraph.BUFFER_SIZE);
  private frameTimes = new Float32Array(PerfGraph.BUFFER_SIZE);
  private head = 0;
  private count = 0;

  // DOM Elements
  private containerEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private modeBtn: HTMLButtonElement | null = null;
  private chipFps: HTMLElement | null = null;
  private chipCpu: HTMLElement | null = null;
  private btnClose: HTMLButtonElement | null = null;
  private footerEl: HTMLElement | null = null;
  private menuBtn: HTMLElement | null = null;
  private monitorFpsEl: HTMLElement | null = null;
  private monitorMsEl: HTMLElement | null = null;

  // Stat rows
  private valCpu: HTMLElement | null = null;
  private valAvg: HTMLElement | null = null;
  private valPeak: HTMLElement | null = null;
  private valSlow: HTMLElement | null = null;

  // Throttled DOM stats update
  private lastDomUpdateT = 0;

  constructor() {
    this.containerEl = document.getElementById('perf-pane');
    this.canvasEl = document.getElementById('perf-graph-canvas') as HTMLCanvasElement | null;
    this.modeBtn = document.getElementById('perf-graph-mode') as HTMLButtonElement | null;
    this.chipFps = document.getElementById('perf-graph-fps');
    this.chipCpu = document.getElementById('perf-graph-cpu');
    this.btnClose = document.getElementById('perf-graph-close') as HTMLButtonElement | null;
    this.footerEl = document.getElementById('perf-graph-footer');
    this.menuBtn = document.getElementById('menu-graph');
    this.monitorFpsEl = document.getElementById('monitor-fps');
    this.monitorMsEl = document.getElementById('monitor-ms');

    this.valCpu = document.getElementById('perf-val-cpu');
    this.valAvg = document.getElementById('perf-val-avg');
    this.valPeak = document.getElementById('perf-val-peak');
    this.valSlow = document.getElementById('perf-val-slow');

    if (this.canvasEl) {
      this.ctx = this.canvasEl.getContext('2d');
    }

    // Restore mode
    try {
      const savedMode = localStorage.getItem(PerfGraph.STORAGE_MODE_KEY);
      if (savedMode === 'fps' || savedMode === 'frametime') {
        this.mode = savedMode;
      }
    } catch {}

    // Restore enabled state
    try {
      const saved = localStorage.getItem(PerfGraph.STORAGE_KEY);
      if (saved === 'true') {
        this.setEnabled(true);
      } else {
        this.setEnabled(false);
      }
    } catch {
      this.setEnabled(false);
    }

    this.bindEvents();
    this.updateModeButton();
  }

  private bindEvents() {
    // Monitor FPS/MS in groupbox title
    this.monitorFpsEl?.addEventListener('click', () => this.toggle());
    this.monitorMsEl?.addEventListener('click', () => this.toggle());

    // Close button
    this.btnClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setEnabled(false);
    });

    // Mode toggle button
    this.modeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMode();
    });
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    this.containerEl?.classList.toggle('hidden', !this.enabled);
    this.menuBtn?.classList.toggle('active', this.enabled);
    this.menuBtn?.setAttribute('aria-pressed', String(this.enabled));

    try {
      localStorage.setItem(PerfGraph.STORAGE_KEY, String(this.enabled));
    } catch {}

    if (this.enabled) {
      this.draw(0, 16.67);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  toggleMode() {
    this.mode = this.mode === 'frametime' ? 'fps' : 'frametime';
    try {
      localStorage.setItem(PerfGraph.STORAGE_MODE_KEY, this.mode);
    } catch {}
    this.updateModeButton();
    if (this.enabled) {
      const lastIdx = (this.head - 1 + PerfGraph.BUFFER_SIZE) % PerfGraph.BUFFER_SIZE;
      this.draw(this.renderTimes[lastIdx] ?? 0, this.frameTimes[lastIdx] ?? 16.67);
    }
  }

  private updateModeButton() {
    if (this.modeBtn) {
      this.modeBtn.textContent = this.mode === 'frametime' ? 'ms' : 'fps';
      this.modeBtn.title = `Mode: ${this.mode === 'frametime' ? 'Frametime (ms)' : 'FPS'} · Click to switch`;
    }
  }

  /**
   * Record one frame metrics and redraw graph if visible.
   * Minimal overhead: typed array push is ~0.0005 ms.
   */
  record(renderMs: number, intervalMs: number, currentFps?: number) {
    this.renderTimes[this.head] = renderMs;
    this.frameTimes[this.head] = intervalMs;
    this.head = (this.head + 1) % PerfGraph.BUFFER_SIZE;
    if (this.count < PerfGraph.BUFFER_SIZE) this.count++;

    if (this.enabled) {
      this.draw(renderMs, intervalMs, currentFps);
    }
  }

  private draw(renderMs: number, intervalMs: number, currentFps?: number) {
    const cv = this.canvasEl;
    const ctx = this.ctx;
    if (!cv || !ctx) return;

    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w <= 0 || h <= 0) return;

    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }

    // Clear background
    ctx.fillStyle = '#0b0d11';
    ctx.fillRect(0, 0, w, h);

    const now = performance.now();
    const font = `${Math.round(8 * dpr)}px Cascadia Mono, Consolas, monospace`;

    if (this.mode === 'frametime') {
      // Find peak render time in buffer for scale
      let peakMs = 0;
      let sumMs = 0;
      let missed33 = 0;

      for (let i = 0; i < this.count; i++) {
        const idx = (this.head - 1 - i + PerfGraph.BUFFER_SIZE) % PerfGraph.BUFFER_SIZE;
        const v = this.renderTimes[idx]!;
        if (v > peakMs) peakMs = v;
        sumMs += v;
        if (v > 33.33) missed33++;
      }

      const avgMs = this.count > 0 ? sumMs / this.count : 0;
      const maxScale = Math.max(40, Math.ceil((peakMs * 1.15) / 10) * 10);

      // Reference line: 16.7 ms (60 FPS target)
      const y60 = h - (16.67 / maxScale) * h;
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([2 * dpr, 2 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y60);
      ctx.lineTo(w, y60);
      ctx.stroke();

      ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
      ctx.font = font;
      ctx.fillText('16.7ms (60fps)', 4 * dpr, y60 - 2 * dpr);

      // Reference line: 33.3 ms (30 FPS budget)
      const y30 = h - (33.33 / maxScale) * h;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.beginPath();
      ctx.moveTo(0, y30);
      ctx.lineTo(w, y30);
      ctx.stroke();

      ctx.fillStyle = 'rgba(251, 191, 36, 0.75)';
      ctx.fillText('33.3ms (30fps)', 4 * dpr, y30 - 2 * dpr);
      ctx.setLineDash([]);

      // Top scale indicator
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.fillText(`${maxScale.toFixed(0)}ms`, w - 24 * dpr, 9 * dpr);

      // Draw bars
      const barW = w / PerfGraph.BUFFER_SIZE;
      const startIdx = (this.head - this.count + PerfGraph.BUFFER_SIZE) % PerfGraph.BUFFER_SIZE;

      for (let i = 0; i < this.count; i++) {
        const idx = (startIdx + i) % PerfGraph.BUFFER_SIZE;
        const rMs = this.renderTimes[idx]!;
        const iMs = this.frameTimes[idx]!;
        const x = i * barW;
        const barH = Math.min(h, (rMs / maxScale) * h);
        const y = h - barH;

        // Color coding
        if (rMs <= 16.67) {
          ctx.fillStyle = '#4ade80'; // Green
        } else if (rMs <= 33.33) {
          ctx.fillStyle = '#fbbf24'; // Amber
        } else {
          ctx.fillStyle = '#f87171'; // Red
        }

        ctx.fillRect(x, y, Math.max(1, Math.ceil(barW)), barH);

        // Frame interval stalk if significantly delayed
        if (iMs > rMs + 4) {
          const iH = Math.min(h, (iMs / maxScale) * h);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.fillRect(x, h - iH, Math.max(1, Math.ceil(barW)), 1 * dpr);
        }
      }

      // Throttled DOM text update
      if (now - this.lastDomUpdateT > 100) {
        this.lastDomUpdateT = now;
        const fpsVal = currentFps ?? (intervalMs > 0 ? 1000 / intervalMs : 60);

        if (this.chipFps) {
          this.chipFps.textContent = `${fpsVal.toFixed(1)} FPS`;
          this.chipFps.className = `nle-perf-chip ${fpsVal >= 55 ? 'nle-perf-chip--ok' : fpsVal >= 30 ? 'nle-perf-chip--warn' : 'nle-perf-chip--bad'}`;
        }
        if (this.chipCpu) {
          this.chipCpu.textContent = `${renderMs.toFixed(1)} ms`;
          this.chipCpu.className = `nle-perf-chip ${renderMs <= 16.67 ? 'nle-perf-chip--ok' : renderMs <= 33.33 ? 'nle-perf-chip--warn' : 'nle-perf-chip--bad'}`;
        }

        // Stats grid rows
        if (this.valCpu) {
          this.valCpu.textContent = `${renderMs.toFixed(1)} ms`;
          this.valCpu.style.color = renderMs <= 16.67 ? '#4ade80' : renderMs <= 33.33 ? '#fbbf24' : '#f87171';
        }
        if (this.valAvg) this.valAvg.textContent = `${avgMs.toFixed(1)} ms`;
        if (this.valPeak) {
          this.valPeak.textContent = `${peakMs.toFixed(1)} ms`;
          this.valPeak.style.color = peakMs <= 33.33 ? 'var(--sys-text)' : '#f87171';
        }
        if (this.valSlow) {
          this.valSlow.textContent = String(missed33);
          this.valSlow.style.color = missed33 > 0 ? '#f87171' : 'var(--sys-text)';
        }

        if (this.footerEl) {
          const tag = missed33 === 0 ? '● REAL-TIME' : '▲ SPOTS DETECTED';
          const color = missed33 === 0 ? 'var(--sys-ok)' : 'var(--sys-warn)';
          this.footerEl.innerHTML = `<span>180 frames · ~3.0s</span><span style="color:${color}">${tag}</span>`;
        }
      }
    } else {
      // FPS Mode
      const maxFps = 90;
      const y60 = h - (60 / maxFps) * h;
      const y30 = h - (30 / maxFps) * h;

      // 60 FPS reference line
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
      ctx.lineWidth = 1 * dpr;
      ctx.setLineDash([2 * dpr, 2 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y60);
      ctx.lineTo(w, y60);
      ctx.stroke();

      ctx.fillStyle = 'rgba(74, 222, 128, 0.75)';
      ctx.font = font;
      ctx.fillText('60 FPS', 4 * dpr, y60 - 2 * dpr);

      // 30 FPS reference line
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)';
      ctx.beginPath();
      ctx.moveTo(0, y30);
      ctx.lineTo(w, y30);
      ctx.stroke();

      ctx.fillStyle = 'rgba(251, 191, 36, 0.75)';
      ctx.fillText('30 FPS', 4 * dpr, y30 - 2 * dpr);
      ctx.setLineDash([]);

      const barW = w / PerfGraph.BUFFER_SIZE;
      const startIdx = (this.head - this.count + PerfGraph.BUFFER_SIZE) % PerfGraph.BUFFER_SIZE;

      let sumFps = 0;
      let minFps = 999;

      for (let i = 0; i < this.count; i++) {
        const idx = (startIdx + i) % PerfGraph.BUFFER_SIZE;
        const iMs = this.frameTimes[idx]!;
        const fps = iMs > 0 ? Math.min(maxFps, 1000 / iMs) : 60;
        sumFps += fps;
        if (fps < minFps) minFps = fps;

        const x = i * barW;
        const barH = (fps / maxFps) * h;
        const y = h - barH;

        if (fps >= 55) ctx.fillStyle = '#4ade80';
        else if (fps >= 30) ctx.fillStyle = '#fbbf24';
        else ctx.fillStyle = '#f87171';

        ctx.fillRect(x, y, Math.max(1, Math.ceil(barW)), barH);
      }

      const avgFps = this.count > 0 ? sumFps / this.count : 60;

      if (now - this.lastDomUpdateT > 100) {
        this.lastDomUpdateT = now;
        const fpsVal = currentFps ?? (intervalMs > 0 ? 1000 / intervalMs : 60);
        if (this.chipFps) {
          this.chipFps.textContent = `${fpsVal.toFixed(1)} FPS`;
          this.chipFps.className = `nle-perf-chip ${fpsVal >= 55 ? 'nle-perf-chip--ok' : fpsVal >= 30 ? 'nle-perf-chip--warn' : 'nle-perf-chip--bad'}`;
        }
        if (this.chipCpu) {
          this.chipCpu.textContent = `${renderMs.toFixed(1)} ms`;
          this.chipCpu.className = `nle-perf-chip ${renderMs <= 16.67 ? 'nle-perf-chip--ok' : renderMs <= 33.33 ? 'nle-perf-chip--warn' : 'nle-perf-chip--bad'}`;
        }

        if (this.valCpu) {
          this.valCpu.textContent = `${fpsVal.toFixed(1)} FPS`;
          this.valCpu.style.color = fpsVal >= 55 ? '#4ade80' : fpsVal >= 30 ? '#fbbf24' : '#f87171';
        }
        if (this.valAvg) this.valAvg.textContent = `${avgFps.toFixed(1)} FPS`;
        if (this.valPeak) this.valPeak.textContent = `${minFps.toFixed(1)} FPS`;
        if (this.valSlow) this.valSlow.textContent = `${(this.renderTimes[this.head] ?? 0).toFixed(1)} ms`;

        if (this.footerEl) {
          this.footerEl.innerHTML = `<span>Avg: <strong>${avgFps.toFixed(1)}</strong> FPS</span><span>Min: <strong>${minFps.toFixed(1)}</strong> FPS</span>`;
        }
      }
    }
  }
}

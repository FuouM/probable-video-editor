// WinForms / DAW Render & Export Dialog for pve-next NLE
// Triggers WebCodecs direct GPU video encoding or headless backend render with live progress.
import type { Engine, TimelineEntry } from '@pve/engine/engine';

export interface ClipProgressItem {
  id: string;
  f0: number;
  f1: number;
  total: number;
  rendered?: number;
  percent?: number;
  status: 'pending' | 'rendering' | 'done' | 'stale';
  hasSegment?: boolean;
  isStale?: boolean;
  sizeBytes?: number;
  segFile?: string | null;
}

export interface RenderProgressPayload {
  projectId?: string;
  status: 'starting' | 'rendering' | 'encoding' | 'complete' | 'error' | 'aborted';
  totalFrames?: number;
  renderedFrames?: number;
  fps?: number;
  elapsedS?: number;
  etaS?: number;
  activeClip?: string;
  clips?: ClipProgressItem[];
  allRendered?: boolean;
  finalMp4?: { path: string; size: number; mtime: number } | null;
  outputFile?: string;
  error?: string;
}

export interface RenderStateNotification {
  active: boolean;
  stage?: 'rendering' | 'encoding' | 'complete' | 'error' | 'aborted' | 'idle';
  percent?: number;
  fps?: number;
  etaS?: number;
  outputFile?: string;
  error?: string;
}

export interface RenderDialogOptions {
  projectId: string;
  getLoopRange: () => [number, number] | null;
  getCurrentClip: () => string;
  onProgressUpdate: (progressMap: Map<string, { percent: number; status: 'pending' | 'rendering' | 'done' }>) => void;
  onRenderStateChange?: (state: RenderStateNotification) => void;
  engine?: Engine;
  canvas?: HTMLCanvasElement;
  fps?: number;
  duration?: number;
  timelineEntries?: TimelineEntry[];
}

const STORAGE_KEY_PIPELINE = 'pve:render-pipeline';
const STORAGE_KEY_QUALITY = 'pve:render-quality';
const STORAGE_KEY_SCALE = 'pve:render-scale';

export class RenderDialog {
  private overlayEl: HTMLElement;
  private dialogEl: HTMLElement;
  private floatingPillEl: HTMLElement;
  private pillTextEl: HTMLElement;
  private headerBadgeEl: HTMLElement;
  private btnClose: HTMLButtonElement;
  private btnMinimize: HTMLButtonElement;
  private btnHide: HTMLButtonElement;
  private isOpen = false;
  private isRendering = false;
  private webCodecsActive = false;
  private cancelRequested = false;
  private pipelineSelect: HTMLSelectElement;
  private rangeSelect: HTMLSelectElement;
  private qualitySelect: HTMLSelectElement;
  private scaleSelect: HTMLSelectElement;
  private btnStart: HTMLButtonElement;
  private btnEncode: HTMLButtonElement;
  private btnCancel: HTMLButtonElement;
  private progressSection: HTMLElement;
  private overallBar: HTMLElement;
  private overallText: HTMLElement;
  private statusText: HTMLElement;
  private clipTableBody: HTMLElement;
  private resultSection: HTMLElement;
  private mp4Banner: HTMLElement;
  private mp4Text: HTMLElement;
  private selectAllCb: HTMLInputElement;
  private clipsData: ClipProgressItem[] = [];
  private selectedClipIds = new Set<string>();
  private initializedSelections = false;
  private pollTimer: number | null = null;
  private pillDismissTimer: number | null = null;

  constructor(private opts: RenderDialogOptions) {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'nle-modal-overlay hidden';
    this.overlayEl.id = 'render-modal-overlay';

    this.overlayEl.innerHTML = `
      <div class="nle-modal-dialog" id="render-dialog" role="dialog" aria-labelledby="render-title" tabindex="-1">
        <div class="nle-modal-header">
          <div class="nle-modal-title" id="render-title">
            <span style="color:#ef4444;font-size:12px;margin-right:2px">●</span>
            <span>RENDER & EXPORT — ${opts.projectId}</span>
            <span id="render-header-badge" class="nle-badge-status nle-badge-status--active hidden" style="margin-left:8px">● RENDERING</span>
          </div>
          <div class="nle-header-controls">
            <button class="nle-modal-btn" id="btn-render-minimize" title="Minimize dialog (render continues in background)">─</button>
            <button class="nle-modal-btn nle-modal-btn--close" id="btn-render-close" title="Close (Escape)">✕</button>
          </div>
        </div>

        <div class="nle-modal-body">
          <!-- Final MP4 Banner -->
          <div class="nle-mp4-banner hidden" id="render-mp4-banner">
            <div>
              <span class="nle-chip nle-chip--ok" style="margin-right:8px">✓ FINAL MP4 READY</span>
              <span id="render-mp4-text" style="color:var(--sys-text);font-size:11px"></span>
            </div>
            <div style="display:flex;gap:4px">
              <button class="nle-scene-btn-single" id="btn-open-final-mp4" title="Open MP4 in new browser tab">Play ↗</button>
            </div>
          </div>

          <!-- Setup Options -->
          <div class="group-box nle-render-group" id="render-setup-box">
            <div class="group-box-title">EXPORT CONFIGURATION</div>
            <div class="nle-render-form">
              <div class="nle-form-row">
                <label for="render-pipeline-select">Export Engine:</label>
                <select id="render-pipeline-select" class="nle-select">
                  <option value="webcodecs">⚡ WebCodecs Hardware (Direct GPU Encode · Fast MP4)</option>
                  <option value="ffmpeg">Master Pipeline (Lossless FFV1 Segments + FFmpeg)</option>
                </select>
              </div>

              <div class="nle-form-row">
                <label for="render-range-select">Timeline Scope:</label>
                <select id="render-range-select" class="nle-select">
                  <option value="full">Full Video (All Scenes)</option>
                  <option value="stale">Only Modified / Stale Scenes</option>
                  <option value="selected">Selected Scenes (via checkboxes)</option>
                  <option value="clip">Active Scene</option>
                  <option value="loop">Loop Range (In / Out)</option>
                </select>
              </div>

              <div class="nle-form-row">
                <label for="render-quality-select">Quality / Samples:</label>
                <select id="render-quality-select" class="nle-select">
                  <option value="12">Production Fast (12 fixed samples · 15+ FPS with motion blur)</option>
                  <option value="auto">Production Master (Auto adaptive 4–324 samples · Motion blur)</option>
                  <option value="1">Draft (1 sample/frame · 30+ FPS Real-time)</option>
                </select>
              </div>

              <div class="nle-form-row">
                <label for="render-scale-select">Resolution Scale:</label>
                <select id="render-scale-select" class="nle-select">
                  <option value="2">2.0× 4K Ultra HD (3840 × 2160)</option>
                  <option value="1">1.0× Full HD (1920 × 1080)</option>
                  <option value="0.5">0.5× Half HD (960 × 540)</option>
                </select>
              </div>

              <div class="nle-form-actions">
                <button class="daw-tbtn daw-tbtn--render" id="btn-render-start">
                  <span style="color:#ef4444;margin-right:4px">●</span>Render Video
                </button>
                <button class="daw-tbtn daw-tbtn--encode" id="btn-render-encode" disabled title="Encodes all rendered scene segments into the final MP4 with audio">
                  ★ Render Final MP4
                </button>
                <button class="daw-tbtn daw-tbtn--secondary hidden" id="btn-render-hide" title="Keep rendering in background and close dialog">
                  Run in Background
                </button>
                <button class="daw-tbtn daw-tbtn--danger" id="btn-render-cancel" disabled>
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>

          <!-- Scenes Status Table (Always visible) -->
          <div class="group-box nle-render-group" id="render-scenes-box">
            <div class="group-box-title">PROJECT SCENES & SEGMENTS</div>
            <div class="nle-scenes-toolbar">
              <span id="render-scenes-summary" style="font-size:10px;color:var(--sys-text-muted);font-weight:normal">Loading status...</span>
              <div class="nle-scenes-actions">
                <button class="nle-scene-btn-single" id="btn-render-select-stale" title="Select only modified / unrendered scenes">Select Modified</button>
                <button class="nle-scene-btn-single" id="btn-render-refresh" title="Re-check disk for deleted/new render files">⟳ Refresh</button>
                <button class="nle-scene-btn-single" id="btn-render-clear-all" title="Delete all rendered segments from disk" style="color:#ef4444">Clear Segments</button>
              </div>
            </div>
            <div class="nle-scene-table-container">
              <table class="nle-scene-table">
                <thead>
                  <tr>
                    <th style="width:32px;text-align:center"><input type="checkbox" id="render-select-all" checked title="Select All"></th>
                    <th style="width:120px">SCENE</th>
                    <th style="width:140px">FRAMES</th>
                    <th style="width:90px">ON DISK</th>
                    <th>PROGRESS</th>
                    <th style="width:95px">STATUS</th>
                    <th style="width:85px;text-align:right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody id="render-clip-tbody">
                  <!-- Populated dynamically from disk check -->
                </tbody>
              </table>
            </div>
          </div>

          <!-- Progress Section -->
          <div class="group-box nle-render-group hidden" id="render-progress-box">
            <div class="group-box-title">PROGRESS & METRICS</div>
            <div class="nle-render-progress-body">
              <div class="nle-progress-overall">
                <div class="nle-progress-info">
                  <span id="render-status-label" class="nle-chip nle-chip--ok">READY</span>
                  <span id="render-progress-stats" style="font-family:var(--sys-mono);font-size:11px">0 / 0 frames (0%)</span>
                </div>
                <div class="nle-progress-track">
                  <div class="nle-progress-fill" id="render-overall-fill" style="width:0%"></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Output Result Section -->
          <div class="nle-render-result hidden" id="render-result-box">
            <div class="nle-render-result-row">
              <div class="nle-chip nle-chip--ok" id="render-result-chip">✓ RENDER COMPLETE</div>
              <div style="display:flex;gap:4px">
                <button class="nle-scene-btn-single" id="btn-copy-result-path" title="Copy output path to clipboard">Copy Path</button>
                <button class="nle-scene-btn-single" id="btn-play-result" title="Open in browser">Play ↗</button>
              </div>
            </div>
            <div class="nle-render-result-path" id="render-result-path"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlayEl);

    // Floating background render pill
    this.floatingPillEl = document.createElement('div');
    this.floatingPillEl.className = 'nle-render-floating-pill hidden';
    this.floatingPillEl.id = 'render-floating-pill';
    this.floatingPillEl.innerHTML = `
      <span class="nle-pill-dot" style="color:#00e5ff">⚡</span>
      <span class="nle-pill-text" id="render-pill-text">Exporting: 0%</span>
      <div class="nle-pill-actions">
        <button class="nle-scene-btn-single" id="btn-pill-open" title="Open Render Dialog">View ↗</button>
        <button class="nle-scene-btn-single" id="btn-pill-cancel" title="Cancel Export" style="color:#ef4444">✕</button>
      </div>
    `;
    document.body.appendChild(this.floatingPillEl);

    this.dialogEl = this.overlayEl.querySelector('#render-dialog')!;
    this.pipelineSelect = this.overlayEl.querySelector('#render-pipeline-select') as HTMLSelectElement;
    this.rangeSelect = this.overlayEl.querySelector('#render-range-select') as HTMLSelectElement;
    this.qualitySelect = this.overlayEl.querySelector('#render-quality-select') as HTMLSelectElement;
    this.scaleSelect = this.overlayEl.querySelector('#render-scale-select') as HTMLSelectElement;
    this.btnStart = this.overlayEl.querySelector('#btn-render-start') as HTMLButtonElement;
    this.btnEncode = this.overlayEl.querySelector('#btn-render-encode') as HTMLButtonElement;
    this.btnCancel = this.overlayEl.querySelector('#btn-render-cancel') as HTMLButtonElement;
    this.btnHide = this.overlayEl.querySelector('#btn-render-hide') as HTMLButtonElement;
    this.btnClose = this.overlayEl.querySelector('#btn-render-close') as HTMLButtonElement;
    this.btnMinimize = this.overlayEl.querySelector('#btn-render-minimize') as HTMLButtonElement;
    this.headerBadgeEl = this.overlayEl.querySelector('#render-header-badge')!;
    this.progressSection = this.overlayEl.querySelector('#render-progress-box')!;
    this.overallBar = this.overlayEl.querySelector('#render-overall-fill')!;
    this.overallText = this.overlayEl.querySelector('#render-progress-stats')!;
    this.statusText = this.overlayEl.querySelector('#render-status-label')!;
    this.clipTableBody = this.overlayEl.querySelector('#render-clip-tbody')!;
    this.resultSection = this.overlayEl.querySelector('#render-result-box')!;
    this.mp4Banner = this.overlayEl.querySelector('#render-mp4-banner')!;
    this.mp4Text = this.overlayEl.querySelector('#render-mp4-text')!;
    this.selectAllCb = this.overlayEl.querySelector('#render-select-all') as HTMLInputElement;
    this.pillTextEl = this.floatingPillEl.querySelector('#render-pill-text')!;

    this.initSavedSettings();
    this.bindEvents();
    this.attachHmr();
    this.startAutoRefresh();
  }

  isWebCodecsRendering(): boolean {
    return this.isRendering && this.webCodecsActive;
  }

  private initSavedSettings() {
    try {
      const savedPipeline = localStorage.getItem(STORAGE_KEY_PIPELINE);
      if (savedPipeline && (savedPipeline === 'webcodecs' || savedPipeline === 'ffmpeg')) {
        this.pipelineSelect.value = savedPipeline;
      } else {
        this.pipelineSelect.value = typeof VideoEncoder !== 'undefined' ? 'webcodecs' : 'ffmpeg';
      }

      const savedQuality = localStorage.getItem(STORAGE_KEY_QUALITY);
      if (savedQuality) this.qualitySelect.value = savedQuality;

      const savedScale = localStorage.getItem(STORAGE_KEY_SCALE);
      if (savedScale && ['0.5', '1', '2'].includes(savedScale)) {
        this.scaleSelect.value = savedScale;
      } else {
        const urlScale = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('scale') : null;
        this.scaleSelect.value = urlScale === '2' ? '2' : '1';
      }
    } catch {}

    this.pipelineSelect.addEventListener('change', () => {
      try { localStorage.setItem(STORAGE_KEY_PIPELINE, this.pipelineSelect.value); } catch {}
    });
    this.qualitySelect.addEventListener('change', () => {
      try { localStorage.setItem(STORAGE_KEY_QUALITY, this.qualitySelect.value); } catch {}
    });
    this.scaleSelect.addEventListener('change', () => {
      try { localStorage.setItem(STORAGE_KEY_SCALE, this.scaleSelect.value); } catch {}
      void this.fetchStatus();
    });
  }

  private bindEvents() {
    // Closing never aborts the render: it hides dialog and continues in background
    this.btnClose.addEventListener('click', () => this.close());
    this.btnMinimize.addEventListener('click', () => this.close());
    this.btnHide.addEventListener('click', () => this.close());

    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    this.btnStart.addEventListener('click', () => {
      void this.startRender();
    });

    this.btnEncode.addEventListener('click', () => {
      void this.startEncode();
    });

    this.btnCancel.addEventListener('click', () => {
      void this.cancelRender();
    });

    this.selectAllCb.addEventListener('change', () => {
      const isChecked = this.selectAllCb.checked;
      this.selectAllCb.indeterminate = false;
      if (isChecked) {
        for (const c of this.clipsData) this.selectedClipIds.add(c.id);
      } else {
        this.selectedClipIds.clear();
      }
      const cbs = this.clipTableBody.querySelectorAll<HTMLInputElement>('.nle-clip-cb');
      for (const cb of cbs) cb.checked = isChecked;
    });

    this.overlayEl.querySelector('#btn-render-select-stale')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectedClipIds.clear();
      for (const c of this.clipsData) {
        if (!c.hasSegment || c.isStale) this.selectedClipIds.add(c.id);
      }
      const cbs = this.clipTableBody.querySelectorAll<HTMLInputElement>('.nle-clip-cb');
      for (const cb of cbs) {
        const cid = cb.getAttribute('data-clip');
        cb.checked = cid ? this.selectedClipIds.has(cid) : false;
      }
      this.syncSelectAllCheckbox();
    });

    this.overlayEl.querySelector('#btn-render-refresh')?.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.fetchStatus();
    });

    this.overlayEl.querySelector('#btn-render-clear-all')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete all rendered scene segments from disk?')) return;
      try {
        const scale = parseFloat(this.scaleSelect.value) || 1;
        const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ all: true, scale }),
        });
        if (res.ok) {
          void this.fetchStatus();
        }
      } catch {}
    });

    this.overlayEl.querySelector('#btn-copy-result-path')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const pathEl = this.overlayEl.querySelector('#render-result-path');
      const text = pathEl?.textContent || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const btn = this.overlayEl.querySelector('#btn-copy-result-path') as HTMLButtonElement;
          if (btn) {
            const old = btn.textContent;
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = old; }, 2000);
          }
        }).catch(() => {});
      }
    });

    this.overlayEl.querySelector('#btn-play-result')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const scale = parseFloat(this.scaleSelect.value) || 1;
      const subDir = scale > 1 ? (scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`) : 'full';
      const name = scale > 1 ? (scale === 2 ? `${encodeURIComponent(this.opts.projectId)}-4k.mp4` : `${encodeURIComponent(this.opts.projectId)}-${Math.round(scale * 1080)}p.mp4`) : `${encodeURIComponent(this.opts.projectId)}-full.mp4`;
      const url = `/projects/${encodeURIComponent(this.opts.projectId)}/out/render/${subDir}/${name}`;
      window.open(url, '_blank');
    });

    this.overlayEl.querySelector('#btn-open-final-mp4')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = `/projects/${encodeURIComponent(this.opts.projectId)}/out/render/full/${encodeURIComponent(this.opts.projectId)}-full.mp4`;
      window.open(url, '_blank');
    });

    // Floating pill controls
    this.floatingPillEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'btn-pill-cancel') {
        e.stopPropagation();
        void this.cancelRender();
        return;
      }
      this.open();
    });
  }

  private startAutoRefresh() {
    window.addEventListener('focus', () => {
      if (this.isOpen && !this.isRendering) void this.fetchStatus();
    });
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      if (this.isOpen || this.isRendering) void this.fetchStatus();
    }, 2000);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private attachHmr() {
    if (import.meta.hot) {
      import.meta.hot.on('pve:render-progress', (data: RenderProgressPayload) => {
        if (data.projectId && data.projectId !== this.opts.projectId) return;
        this.updateProgress(data);
      });
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.overlayEl.classList.remove('hidden');
    this.hideFloatingPill();

    const loop = this.opts.getLoopRange();
    const loopOpt = this.rangeSelect.querySelector('option[value="loop"]') as HTMLOptionElement;
    if (loopOpt) {
      if (loop) {
        loopOpt.disabled = false;
        loopOpt.textContent = `Loop Range (${loop[0].toFixed(2)}s – ${loop[1].toFixed(2)}s)`;
      } else {
        loopOpt.disabled = true;
        loopOpt.textContent = 'Loop Range (No loop set)';
      }
    }

    const curClip = this.opts.getCurrentClip();
    const clipOpt = this.rangeSelect.querySelector('option[value="clip"]') as HTMLOptionElement;
    if (clipOpt) {
      clipOpt.textContent = curClip ? `Active Scene (${curClip})` : 'Active Scene (None)';
      clipOpt.disabled = !curClip;
    }

    void this.fetchStatus();
    this.startPolling();
    this.updateControls();
    this.dialogEl.focus();
  }

  close() {
    this.isOpen = false;
    this.overlayEl.classList.add('hidden');

    if (this.isRendering) {
      this.showFloatingPill();
    } else {
      this.stopPolling();
      this.hideFloatingPill();
    }
  }

  dispose() {
    this.stopPolling();
    this.overlayEl.remove();
    this.floatingPillEl.remove();
  }

  private showFloatingPill() {
    if (this.pillDismissTimer !== null) {
      clearTimeout(this.pillDismissTimer);
      this.pillDismissTimer = null;
    }
    this.floatingPillEl.classList.remove('hidden');
  }

  private hideFloatingPill() {
    if (this.pillDismissTimer !== null) {
      clearTimeout(this.pillDismissTimer);
      this.pillDismissTimer = null;
    }
    this.floatingPillEl.classList.add('hidden');
  }

  private updateControls() {
    if (this.isRendering) {
      this.btnStart.disabled = true;
      this.btnEncode.disabled = true;
      this.btnCancel.disabled = false;
      this.btnHide.classList.remove('hidden');
      this.progressSection.classList.remove('hidden');
      this.headerBadgeEl.classList.remove('hidden');
      this.btnClose.title = 'Hide dialog (render continues in background)';
      this.btnMinimize.title = 'Hide dialog (render continues in background)';
    } else {
      this.btnStart.disabled = false;
      this.btnEncode.disabled = !this.clipsData.every((c) => c.hasSegment);
      this.btnCancel.disabled = true;
      this.btnHide.classList.add('hidden');
      this.headerBadgeEl.classList.add('hidden');
      this.btnClose.title = 'Close (Escape)';
      this.btnMinimize.title = 'Minimize dialog';
    }
  }

  async fetchStatus() {
    try {
      const scale = parseFloat(this.scaleSelect?.value) || 1;
      const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/status?scale=${scale}`);
      if (!res.ok) return;
      const data: {
        active: boolean;
        status: RenderProgressPayload | null;
        clips?: ClipProgressItem[];
        allRendered?: boolean;
        finalMp4?: { path: string; size: number; mtime: number } | null;
      } = await res.json();

      if (data.clips && data.clips.length) {
        this.clipsData = data.clips;
        this.renderClipsTable(data.clips);
      }

      if (data.finalMp4) {
        this.mp4Banner.classList.remove('hidden');
        const sizeMb = (data.finalMp4.size / (1024 * 1024)).toFixed(1);
        this.mp4Text.textContent = `${data.finalMp4.path} (${sizeMb} MB)`;
      } else {
        this.mp4Banner.classList.add('hidden');
      }

      const allReady = !!data.allRendered;
      this.btnEncode.disabled = !allReady || this.isRendering;
      if (allReady && !this.isRendering) {
        this.btnEncode.title = 'All scenes rendered! Click to encode the final MP4 with audio.';
      }

      // If backend reports an active render, sync up
      if (data.active && data.status) {
        this.isRendering = true;
        this.updateControls();
        this.updateProgress(data.status);
      } else if (!data.active && this.isRendering && !this.webCodecsActive) {
        // Backend render completed
        this.isRendering = false;
        this.updateControls();
      }
    } catch {}
  }

  private syncSelectAllCheckbox() {
    const total = this.clipsData.length;
    const count = this.selectedClipIds.size;
    if (count === 0) {
      this.selectAllCb.checked = false;
      this.selectAllCb.indeterminate = false;
    } else if (count === total && total > 0) {
      this.selectAllCb.checked = true;
      this.selectAllCb.indeterminate = false;
    } else {
      this.selectAllCb.checked = false;
      this.selectAllCb.indeterminate = true;
    }
  }

  private bindTableActionButtons() {
    this.clipTableBody.querySelectorAll<HTMLButtonElement>('[data-render-clip]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-render-clip');
        if (cid) void this.startRender([cid]);
      };
    });

    this.clipTableBody.querySelectorAll<HTMLButtonElement>('[data-delete-clip]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const cid = btn.getAttribute('data-delete-clip');
        if (!cid) return;
        try {
          const scale = parseFloat(this.scaleSelect.value) || 1;
          const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ clipId: cid, scale }),
          });
          if (res.ok) {
            void this.fetchStatus();
          }
        } catch {}
      };
    });
  }

  private renderClipsTable(clips: ClipProgressItem[]) {
    if (!this.initializedSelections) {
      for (const c of clips) {
        if (!c.hasSegment || c.isStale) this.selectedClipIds.add(c.id);
      }
      this.initializedSelections = true;
      this.syncSelectAllCheckbox();
    }

    let renderedCount = 0;
    let staleCount = 0;

    // If rows already exist in DOM, update cells in-place so checkbox selections are NEVER reset by polling
    if (this.clipTableBody.children.length === clips.length) {
      for (const c of clips) {
        const hasOnDisk = !!c.hasSegment && (c.sizeBytes ?? 0) > 0;
        if (hasOnDisk && !c.isStale) renderedCount++;
        if (c.isStale) staleCount++;

        const isDone = c.status === 'done' || (hasOnDisk && !c.isStale);
        const isStale = c.status === 'stale' || c.isStale;
        const pct = c.percent ?? (isDone ? 100 : 0);

        const row = this.clipTableBody.querySelector(`#row-clip-${c.id}`);
        if (row) {
          const diskEl = row.querySelector('.nle-col-disk');
          if (diskEl) {
            diskEl.innerHTML = hasOnDisk
              ? `<span style="color:#10b981;font-weight:600" title="${c.segFile ?? 'Segment on disk'}">${((c.sizeBytes ?? 0) / (1024 * 1024)).toFixed(1)} MB</span>`
              : '<span style="color:var(--sys-text-muted)">—</span>';
          }
          const fill = row.querySelector<HTMLElement>(`#fill-clip-${c.id}`);
          if (fill) {
            fill.style.width = `${pct}%`;
            fill.classList.toggle('nle-mini-fill--done', isDone);
          }
          const badge = row.querySelector(`#badge-clip-${c.id}`);
          if (badge) {
            badge.innerHTML =
              c.status === 'rendering'
                ? `<span class="nle-badge-status nle-badge-status--active">⚡ ${pct}%</span>`
                : !hasOnDisk
                ? '<span class="nle-badge-status nle-badge-status--pending">○ Not Rendered</span>'
                : isStale
                ? '<span class="nle-badge-status nle-badge-status--stale" title="Scene code edited since segment was rendered">⚠ Modified</span>'
                : '<span class="nle-badge-status nle-badge-status--ok" title="Up to date on disk">✓ Rendered</span>';
          }
          const actionsEl = row.querySelector('.nle-col-actions');
          if (actionsEl) {
            const deleteBtn = hasOnDisk
              ? `<button class="nle-scene-btn-single" data-delete-clip="${c.id}" title="Delete ${c.id} segment from disk" style="color:#ef4444;margin-left:4px">✕</button>`
              : '';
            actionsEl.innerHTML = `
              <button class="nle-scene-btn-single" data-render-clip="${c.id}" title="Render only ${c.id}">Render</button>
              ${deleteBtn}
            `;
          }
        }
      }
      this.bindTableActionButtons();
    } else {
      let html = '';
      for (const c of clips) {
        const hasOnDisk = !!c.hasSegment && (c.sizeBytes ?? 0) > 0;
        if (hasOnDisk && !c.isStale) renderedCount++;
        if (c.isStale) staleCount++;

        const isDone = c.status === 'done' || (hasOnDisk && !c.isStale);
        const isStale = c.status === 'stale' || c.isStale;
        const pct = c.percent ?? (isDone ? 100 : 0);

        const statusBadge =
          c.status === 'rendering'
            ? `<span class="nle-badge-status nle-badge-status--active">⚡ ${pct}%</span>`
            : !hasOnDisk
            ? '<span class="nle-badge-status nle-badge-status--pending">○ Not Rendered</span>'
            : isStale
            ? '<span class="nle-badge-status nle-badge-status--stale" title="Scene code edited since segment was rendered">⚠ Modified</span>'
            : '<span class="nle-badge-status nle-badge-status--ok" title="Up to date on disk">✓ Rendered</span>';

        const diskSizeText = hasOnDisk
          ? `<span style="color:#10b981;font-weight:600" title="${c.segFile ?? 'Segment on disk'}">${((c.sizeBytes ?? 0) / (1024 * 1024)).toFixed(1)} MB</span>`
          : '<span style="color:var(--sys-text-muted)">—</span>';

        const deleteBtn = hasOnDisk
          ? `<button class="nle-scene-btn-single" data-delete-clip="${c.id}" title="Delete ${c.id} segment from disk" style="color:#ef4444;margin-left:4px">✕</button>`
          : '';

        html += `
          <tr class="nle-scene-row" id="row-clip-${c.id}">
            <td style="text-align:center"><input type="checkbox" class="nle-clip-cb" data-clip="${c.id}" ${this.selectedClipIds.has(c.id) ? 'checked' : ''}></td>
            <td class="nle-col-clip"><strong>${c.id}</strong></td>
            <td class="nle-col-frames">${c.f0}–${c.f1} (${c.total}f)</td>
            <td class="nle-col-disk">${diskSizeText}</td>
            <td class="nle-col-prog">
              <div class="nle-mini-track">
                <div class="nle-mini-fill ${isDone ? 'nle-mini-fill--done' : ''}" id="fill-clip-${c.id}" style="width:${pct}%"></div>
              </div>
            </td>
            <td class="nle-col-status" id="badge-clip-${c.id}">${statusBadge}</td>
            <td class="nle-col-actions" style="text-align:right">
              <button class="nle-scene-btn-single" data-render-clip="${c.id}" title="Render only ${c.id}">Render</button>
              ${deleteBtn}
            </td>
          </tr>
        `;
      }

      this.clipTableBody.innerHTML = html;

      this.clipTableBody.querySelectorAll<HTMLInputElement>('.nle-clip-cb').forEach((cb) => {
        cb.addEventListener('change', () => {
          const cid = cb.getAttribute('data-clip');
          if (!cid) return;
          if (cb.checked) {
            this.selectedClipIds.add(cid);
          } else {
            this.selectedClipIds.delete(cid);
          }
          this.syncSelectAllCheckbox();
        });
      });

      this.bindTableActionButtons();
      this.syncSelectAllCheckbox();
    }

    const summaryEl = this.overlayEl.querySelector('#render-scenes-summary');
    if (summaryEl) {
      summaryEl.textContent = `${renderedCount} / ${clips.length} rendered${staleCount > 0 ? ` · ${staleCount} modified` : ''}`;
    }
  }

  private async startRender(explicitClips?: string[]) {
    if (this.pipelineSelect.value === 'webcodecs' && typeof VideoEncoder !== 'undefined' && this.opts.engine && this.opts.canvas) {
      await this.startWebCodecsRender(explicitClips);
    } else {
      await this.startBackendRender(explicitClips);
    }
  }

  private async startWebCodecsRender(explicitClips?: string[]) {
    const engine = this.opts.engine;
    const canvas = this.opts.canvas;
    if (!engine || !canvas) return;

    this.isRendering = true;
    this.webCodecsActive = true;
    this.cancelRequested = false;
    this.updateControls();

    this.resultSection.classList.add('hidden');
    this.statusText.className = 'nle-chip nle-chip--cyan';
    this.statusText.textContent = '⚡ WEBCODECS STARTING...';
    this.headerBadgeEl.textContent = '● WEBCODECS 0%';
    this.overallBar.style.width = '0%';
    this.pillTextEl.textContent = 'WebCodecs GPU: Starting...';
    if (!this.isOpen) this.showFloatingPill();

    this.opts.onRenderStateChange?.({
      active: true,
      stage: 'rendering',
      percent: 0,
    });

    const fps = this.opts.fps ?? 30;
    const duration = this.opts.duration ?? 10;
    const range = this.rangeSelect.value;
    let from = 0, to = duration;

    const targetClips: string[] = [];
    if (explicitClips && explicitClips.length && this.opts.timelineEntries) {
      targetClips.push(...explicitClips);
      const matched = this.opts.timelineEntries.filter((e) => explicitClips.includes(e.id));
      if (matched.length) {
        from = Math.min(...matched.map((e) => e.start));
        to = Math.max(...matched.map((e) => e.end));
      }
    } else if (range === 'loop') {
      const loop = this.opts.getLoopRange();
      if (loop) { from = loop[0]; to = loop[1]; }
    } else if (range === 'clip') {
      const cur = this.opts.getCurrentClip();
      if (cur) targetClips.push(cur);
      const matched = this.opts.timelineEntries?.find((e) => e.id === cur);
      if (matched) { from = matched.start; to = matched.end; }
    } else if ((range === 'stale' || range === 'selected') && this.opts.timelineEntries) {
      if (range === 'stale') {
        targetClips.push(...this.clipsData.filter((c) => c.isStale || !c.hasSegment).map((c) => c.id));
      } else {
        targetClips.push(...Array.from(this.selectedClipIds));
      }
      if (targetClips.length) {
        const matched = this.opts.timelineEntries.filter((e) => targetClips.includes(e.id));
        if (matched.length) {
          from = Math.min(...matched.map((e) => e.start));
          to = Math.max(...matched.map((e) => e.end));
        }
      }
    }

    const f0 = Math.round(from * fps);
    const f1 = Math.round(to * fps);
    const totalFrames = Math.max(1, f1 - f0);
    const scale = parseFloat(this.scaleSelect.value) || 1;
    const targetW = Math.round(1920 * scale);
    const targetH = Math.round(1080 * scale);
    const quality = this.qualitySelect.value;
    const samples = quality === 'auto' ? { min: 4, max: 324, tol: 3, refine: 'tiles' as const } : (Number(quality) || 1);

    let sessionId = '';
    try {
      const startRes = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/webcodecs/start?fps=${fps}&from=${from.toFixed(3)}&to=${to.toFixed(3)}&scale=${scale}`, {
        method: 'POST',
      });
      if (!startRes.ok) {
        const err = (await startRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || 'Failed to start WebCodecs render session');
      }
      const startJson = (await startRes.json()) as { sessionId: string };
      sessionId = startJson.sessionId;
    } catch (err) {
      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--err';
      this.statusText.textContent = 'ERROR';
      this.overallText.textContent = (err as Error).message;
      this.opts.onRenderStateChange?.({ active: false, stage: 'error', error: (err as Error).message });
      return;
    }

    let pendingChunks: BlobPart[] = [];
    let pendingBytes = 0;

    const flushChunks = async () => {
      if (pendingChunks.length === 0) return;
      const blob = new Blob(pendingChunks as BlobPart[]);
      pendingChunks = [];
      pendingBytes = 0;
      const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/webcodecs/chunk?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        body: blob,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || 'Failed to send video chunk to backend');
      }
    };

    let encoder: VideoEncoder | null = null;
    try {
      encoder = new VideoEncoder({
        output: (chunk) => {
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          pendingChunks.push(buf);
          pendingBytes += buf.byteLength;
        },
        error: (err) => console.error('VideoEncoder error:', err),
      });

      const codec = scale >= 2 ? 'avc1.640033' : 'avc1.640028';
      const bitrate = scale >= 2 ? 50_000_000 : Math.round(16_000_000 * (scale === 1 ? 1 : 0.6));

      encoder.configure({
        codec,
        width: targetW,
        height: targetH,
        bitrate,
        framerate: fps,
        avc: { format: 'annexb' },
        hardwareAcceleration: 'prefer-hardware',
      });
      const tStart = performance.now();
      let lastUiTime = tStart;
      let lastActiveClipId: string | null = null;
      const clipProgressMap = new Map<string, { percent: number; status: 'pending' | 'rendering' | 'done' }>();
      let offscreenCanvas: HTMLCanvasElement | null = null;
      let offscreenCtx: CanvasRenderingContext2D | null = null;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = targetW;
        offscreenCanvas.height = targetH;
        offscreenCtx = offscreenCanvas.getContext('2d', { alpha: false });
      }

      for (let n = f0; n < f1; n++) {
        if (this.cancelRequested) break;

        // GPU backpressure
        while (encoder.encodeQueueSize >= 4) {
          const { promise: dqPromise, resolve: dqResolve } = Promise.withResolvers<void>();
          encoder.addEventListener('dequeue', () => dqResolve(), { once: true });
          await dqPromise;
          if (this.cancelRequested) break;
        }
        if (this.cancelRequested) break;

        // Network chunk backpressure
        if (pendingBytes >= 1024 * 1024) {
          await flushChunks();
        }
        if (this.cancelRequested) break;

        const t = n / fps;
        engine.render(t, 1 / fps, true, samples, 0.5);
        let frameSource: CanvasImageSource = canvas;
        if (offscreenCanvas && offscreenCtx) {
          offscreenCtx.drawImage(canvas, 0, 0, targetW, targetH);
          frameSource = offscreenCanvas;
        }
        const vf = new VideoFrame(frameSource, { timestamp: Math.round(n * (1_000_000 / fps)) });
        encoder.encode(vf, { keyFrame: (n - f0) % 30 === 0 });
        vf.close();
        const now = performance.now();
        if (now - lastUiTime > 120 || n === f1 - 1) {
          lastUiTime = now;
          const done = n - f0 + 1;
          const pct = Math.min(100, Math.round((done / totalFrames) * 100));
          const elapsedS = (now - tStart) / 1000;
          const curFps = elapsedS > 0 ? (done / elapsedS).toFixed(1) : '0';
          const etaS = elapsedS > 0 ? Math.round((totalFrames - done) / (done / elapsedS)) : 0;

          this.overallBar.style.width = `${pct}%`;
          this.overallText.textContent = `${done} / ${totalFrames} frames (${pct}%) · ${curFps} FPS · ETA ${etaS}s`;
          this.statusText.textContent = `⚡ WEBCODECS (${curFps} FPS)`;
          this.headerBadgeEl.textContent = `● WEBCODECS ${pct}%`;
          this.pillTextEl.textContent = `WebCodecs GPU: ${pct}% · ${curFps} FPS · ETA ${etaS}s`;

          // Track active clip in scenes table & timeline
          const activeEntry = this.opts.timelineEntries?.find((e) => !e.over && t >= e.start && t < e.end);
          if (activeEntry) {
            if (lastActiveClipId && lastActiveClipId !== activeEntry.id) {
              const oldRow = this.clipTableBody.querySelector(`#row-clip-${lastActiveClipId}`);
              oldRow?.classList.remove('nle-scene-row--active');
              const oldBadge = this.clipTableBody.querySelector(`#badge-clip-${lastActiveClipId}`);
              if (oldBadge) oldBadge.innerHTML = '<span class="nle-badge-status nle-badge-status--ok">✓ Rendered</span>';
              clipProgressMap.set(lastActiveClipId, { percent: 100, status: 'done' });
            }
            lastActiveClipId = activeEntry.id;

            const clipDuration = Math.max(0.01, activeEntry.end - activeEntry.start);
            const clipElapsed = Math.max(0, t - activeEntry.start);
            const clipPct = Math.min(100, Math.round((clipElapsed / clipDuration) * 100));
            clipProgressMap.set(activeEntry.id, { percent: clipPct, status: 'rendering' });

            const row = this.clipTableBody.querySelector(`#row-clip-${activeEntry.id}`);
            row?.classList.add('nle-scene-row--active');
            const fill = this.clipTableBody.querySelector<HTMLElement>(`#fill-clip-${activeEntry.id}`);
            if (fill) fill.style.width = `${clipPct}%`;
            const badge = this.clipTableBody.querySelector(`#badge-clip-${activeEntry.id}`);
            if (badge) badge.innerHTML = `<span class="nle-badge-status nle-badge-status--active">⚡ ${clipPct}%</span>`;

            this.opts.onProgressUpdate(clipProgressMap);
          }

          this.opts.onRenderStateChange?.({
            active: true,
            stage: 'rendering',
            percent: pct,
            fps: Number(curFps),
            etaS,
          });

          const { promise: yieldPromise, resolve: yieldResolve } = Promise.withResolvers<void>();
          setTimeout(yieldResolve, 0);
          await yieldPromise;
        }
      }

      if (this.cancelRequested) {
        encoder.close();
        await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/webcodecs/cancel?session=${encodeURIComponent(sessionId)}`, {
          method: 'POST',
        }).catch(() => {});
        this.statusText.className = 'nle-chip nle-chip--warn';
        this.statusText.textContent = 'CANCELLED';
        this.pillTextEl.textContent = 'Export cancelled';
        this.isRendering = false;
        this.webCodecsActive = false;
        this.updateControls();
        this.opts.onRenderStateChange?.({ active: false, stage: 'aborted' });
        this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 2500);
        return;
      }

      await encoder.flush();
      encoder.close();
      await flushChunks();

      this.statusText.className = 'nle-chip nle-chip--warn';
      this.statusText.textContent = 'FINALIZING MP4...';
      this.headerBadgeEl.textContent = '● FINALIZING';
      this.pillTextEl.textContent = 'Finalizing MP4...';
      this.opts.onRenderStateChange?.({ active: true, stage: 'encoding', percent: 100 });

      const finishRes = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/webcodecs/finish?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      });
      if (!finishRes.ok) {
        const errJson = (await finishRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errJson?.error || 'Failed to finalize MP4 export');
      }
      const data: { ok: boolean; outputFile: string; size: number } = await finishRes.json();

      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();

      this.statusText.className = 'nle-chip nle-chip--ok';
      this.statusText.textContent = 'COMPLETE';
      this.overallBar.style.width = '100%';
      this.overallText.textContent = `Rendered & encoded in ${((performance.now() - tStart) / 1000).toFixed(1)}s`;

      this.resultSection.classList.remove('hidden');
      const pathEl = this.resultSection.querySelector('#render-result-path')!;
      const mb = (data.size / (1024 * 1024)).toFixed(1);
      pathEl.textContent = `${data.outputFile} (${mb} MB)`;

      // Update floating pill for completed state
      this.floatingPillEl.className = 'nle-render-floating-pill nle-render-floating-pill--done';
      this.pillTextEl.textContent = `✓ Export ready (${mb} MB)`;
      if (!this.isOpen) this.showFloatingPill();
      this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 8000);

      this.opts.onRenderStateChange?.({
        active: false,
        stage: 'complete',
        percent: 100,
        outputFile: data.outputFile,
      });

      void this.fetchStatus();
    } catch (err) {
      if (encoder && encoder.state !== 'closed') encoder.close();
      void fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/webcodecs/cancel?session=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      }).catch(() => {});
      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--err';
      this.statusText.textContent = 'ERROR';
      this.overallText.textContent = (err as Error).message;
      this.floatingPillEl.className = 'nle-render-floating-pill nle-render-floating-pill--err';
      this.pillTextEl.textContent = `⚠ Export failed: ${(err as Error).message}`;
      this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 5000);
      this.opts.onRenderStateChange?.({ active: false, stage: 'error', error: (err as Error).message });
    }
  }

  private async startBackendRender(explicitClips?: string[]) {
    this.isRendering = true;
    this.webCodecsActive = false;
    this.cancelRequested = false;
    this.updateControls();

    this.resultSection.classList.add('hidden');
    this.statusText.className = 'nle-chip nle-chip--warn';
    this.statusText.textContent = 'STARTING...';
    this.headerBadgeEl.textContent = '● RENDERING 0%';
    this.overallBar.style.width = '0%';
    this.pillTextEl.textContent = 'Backend render: Starting...';
    if (!this.isOpen) this.showFloatingPill();

    this.opts.onRenderStateChange?.({
      active: true,
      stage: 'rendering',
      percent: 0,
    });

    const range = this.rangeSelect.value;
    const scale = parseFloat(this.scaleSelect.value) || 1;
    const body: {
      range: string;
      from?: number;
      to?: number;
      clips?: string[];
      samples: string;
      scale: number;
      name?: string;
    } = {
      range,
      samples: this.qualitySelect.value,
      scale,
      name: scale > 1 ? (scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`) : 'full',
    };

    if (explicitClips && explicitClips.length) {
      body.clips = explicitClips;
    } else if (range === 'stale') {
      const staleClips = this.clipsData.filter((c) => c.isStale || !c.hasSegment).map((c) => c.id);
      body.clips = staleClips.length ? staleClips : this.clipsData.map((c) => c.id);
    } else if (range === 'selected') {
      body.clips = Array.from(this.selectedClipIds);
    } else if (range === 'loop') {
      const loop = this.opts.getLoopRange();
      if (loop) {
        body.from = loop[0];
        body.to = loop[1];
      }
    } else if (range === 'clip') {
      const clipId = this.opts.getCurrentClip();
      if (clipId) body.clips = [clipId];
    }

    try {
      const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData: unknown = await res.json().catch(() => null);
        const msg = errData && typeof errData === 'object' && 'error' in errData && typeof errData.error === 'string'
          ? errData.error
          : 'Render failed to start';
        throw new Error(msg);
      }
    } catch (err) {
      this.isRendering = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--err';
      this.statusText.textContent = 'ERROR';
      this.opts.onRenderStateChange?.({ active: false, stage: 'error', error: (err as Error).message });
      alert((err as Error).message);
    }
  }

  private async startEncode() {
    this.isRendering = true;
    this.webCodecsActive = false;
    this.cancelRequested = false;
    this.updateControls();

    this.resultSection.classList.add('hidden');
    this.statusText.className = 'nle-chip nle-chip--warn';
    this.statusText.textContent = 'ENCODING FINAL MP4...';
    this.headerBadgeEl.textContent = '● ENCODING FINAL MP4';
    this.overallBar.style.width = '100%';
    this.overallText.textContent = 'Joining rendered segments and encoding final MP4 with audio...';
    this.pillTextEl.textContent = 'Encoding Final MP4 with audio...';
    if (!this.isOpen) this.showFloatingPill();

    this.opts.onRenderStateChange?.({
      active: true,
      stage: 'encoding',
      percent: 100,
    });

    try {
      const scale = parseFloat(this.scaleSelect.value) || 1;
      const res = await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          encodeOnly: true,
          scale,
          name: scale > 1 ? (scale === 2 ? '4k' : `${Math.round(scale * 1080)}p`) : 'full',
        }),
      });
      if (!res.ok) {
        const errData: unknown = await res.json().catch(() => null);
        const msg = errData && typeof errData === 'object' && 'error' in errData && typeof errData.error === 'string'
          ? errData.error
          : 'Final encode failed to start';
        throw new Error(msg);
      }
    } catch (err) {
      this.isRendering = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--err';
      this.statusText.textContent = 'ERROR';
      this.opts.onRenderStateChange?.({ active: false, stage: 'error', error: (err as Error).message });
      alert((err as Error).message);
    }
  }

  private async cancelRender() {
    this.cancelRequested = true;
    this.statusText.textContent = 'CANCELLING...';
    this.btnCancel.disabled = true;
    this.pillTextEl.textContent = 'Cancelling render...';

    try {
      await fetch(`/api/project/${encodeURIComponent(this.opts.projectId)}/render/cancel`, {
        method: 'POST',
      });
    } catch {}
  }

  private updateProgress(data: RenderProgressPayload) {
    if (data.status === 'aborted') {
      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--warn';
      this.statusText.textContent = 'CANCELLED';
      this.pillTextEl.textContent = 'Render cancelled';
      this.opts.onRenderStateChange?.({ active: false, stage: 'aborted' });
      this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 2500);
      return;
    }

    if (data.status === 'error') {
      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--err';
      this.statusText.textContent = 'ERROR';
      if (data.error) this.overallText.textContent = data.error;
      this.floatingPillEl.className = 'nle-render-floating-pill nle-render-floating-pill--err';
      this.pillTextEl.textContent = `⚠ Render error: ${data.error || 'Failed'}`;
      this.opts.onRenderStateChange?.({ active: false, stage: 'error', error: data.error });
      this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 5000);
      return;
    }

    if (data.status === 'encoding') {
      this.statusText.className = 'nle-chip nle-chip--warn';
      this.statusText.textContent = 'ENCODING FINAL MP4';
      this.headerBadgeEl.textContent = '● ENCODING FINAL MP4';
      this.overallBar.style.width = '100%';
      this.overallText.textContent = 'Joining segments and encoding audio with ffmpeg...';
      this.pillTextEl.textContent = 'Encoding Final MP4 with audio...';
      this.opts.onRenderStateChange?.({ active: true, stage: 'encoding', percent: 100 });
      return;
    }

    if (data.status === 'complete') {
      this.isRendering = false;
      this.webCodecsActive = false;
      this.updateControls();
      this.statusText.className = 'nle-chip nle-chip--ok';
      this.statusText.textContent = 'COMPLETE';
      this.overallBar.style.width = '100%';
      this.overallText.textContent = 'All frames rendered and encoded.';

      this.resultSection.classList.remove('hidden');
      const pathEl = this.resultSection.querySelector('#render-result-path')!;
      pathEl.textContent = data.outputFile ?? 'out/render/full/pdoom_original-full.mp4';

      this.floatingPillEl.className = 'nle-render-floating-pill nle-render-floating-pill--done';
      this.pillTextEl.textContent = '✓ Render Complete';
      if (!this.isOpen) this.showFloatingPill();
      this.pillDismissTimer = window.setTimeout(() => this.hideFloatingPill(), 8000);

      this.opts.onRenderStateChange?.({
        active: false,
        stage: 'complete',
        percent: 100,
        outputFile: data.outputFile,
      });

      void this.fetchStatus();
      return;
    }

    if (data.status === 'rendering') {
      this.isRendering = true;
      this.updateControls();

      this.statusText.className = 'nle-chip nle-chip--cyan';
      this.statusText.textContent = `RENDERING (${data.activeClip ?? '...'})`;

      const total = data.totalFrames ?? 1;
      const done = data.renderedFrames ?? 0;
      const pct = Math.min(100, Math.round((done / total) * 100));
      this.overallBar.style.width = `${pct}%`;
      this.overallText.textContent = `${done} / ${total} frames (${pct}%) · ${data.fps ?? 0} FPS · ETA ${data.etaS ?? 0}s`;
      this.headerBadgeEl.textContent = `● RENDERING ${pct}%`;
      this.pillTextEl.textContent = `Rendering: ${pct}% · ${data.fps ?? 0} FPS · ETA ${data.etaS ?? 0}s`;

      const map = new Map<string, { percent: number; status: 'pending' | 'rendering' | 'done' }>();

      if (data.clips && data.clips.length) {
        for (const c of data.clips) {
          map.set(c.id, { percent: c.percent ?? 0, status: (c.status as 'pending' | 'rendering' | 'done') });
          const fill = this.clipTableBody.querySelector<HTMLElement>(`#fill-clip-${c.id}`);
          const badge = this.clipTableBody.querySelector<HTMLElement>(`#badge-clip-${c.id}`);
          const row = this.clipTableBody.querySelector<HTMLElement>(`#row-clip-${c.id}`);

          if (fill) {
            fill.style.width = `${c.percent}%`;
            if (c.status === 'done') fill.classList.add('nle-mini-fill--done');
          }
          if (row) {
            if (c.status === 'rendering') row.classList.add('nle-scene-row--active');
            else row.classList.remove('nle-scene-row--active');
          }
          if (badge) {
            badge.innerHTML =
              c.status === 'done'
                ? '<span class="nle-badge-status nle-badge-status--ok">✓ Rendered</span>'
                : c.status === 'rendering'
                ? `<span class="nle-badge-status nle-badge-status--active">⚡ ${c.percent}%</span>`
                : '<span class="nle-badge-status nle-badge-status--pending">○ Not Rendered</span>';
          }
        }
      }

      this.opts.onProgressUpdate(map);
      this.opts.onRenderStateChange?.({
        active: true,
        stage: 'rendering',
        percent: pct,
        fps: data.fps,
        etaS: data.etaS,
      });
    }
  }
}

// The loading screen of the player (app/site) and the studio (app/index.html). One box: the steps of the load
// (project data, fonts, scenes, audio) with their own state, a chip for every scene that turns green when it is
// ready, one bar over all steps, the time that has passed. The engine reports the first three (Engine.init), the
// audio engine the last. The look is daw.css (.ld-*).
import type { InitProgress } from '@pve/engine/engine';

export type StepId = 'data' | 'fonts' | 'scenes' | 'audio';
type State = 'wait' | 'run' | 'done' | 'error';

const LABEL: Record<StepId, string> = { data: 'Project data', fonts: 'Fonts', scenes: 'Scenes', audio: 'Audio' };
/** Share of each step in the bar: the scenes take most of the time, then the audio. */
const WEIGHT: Record<StepId, number> = { data: 5, fonts: 10, scenes: 65, audio: 20 };

interface Row {
  el: HTMLElement;
  info: HTMLElement;
  state: State;
  fraction: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Loader {
  readonly root: HTMLElement;
  private rows = new Map<StepId, Row>();
  private bar: HTMLElement;
  private pct: HTMLElement;
  private time: HTMLElement;
  private titleEl: HTMLElement;
  private status: HTMLElement;
  private chips: HTMLElement;
  private chip = new Map<string, HTMLElement>();
  private t0 = performance.now();
  private timer: number;
  private shown = 0;

  /** `steps`: the steps this page waits for, in order. `diag`: the line at the foot (output size, fps). */
  constructor(host: HTMLElement, o: { title: string; steps: StepId[]; diag?: string }) {
    this.root = document.createElement('div');
    this.root.className = 'ld';
    this.root.innerHTML = `
      <div class="ld-head"><span class="nle-brand-badge ld-badge">PVE</span><strong class="ld-title"></strong><span class="nle-title-sep">&middot;</span><span class="ld-muted">LOADING</span></div>
      <ol class="ld-steps">${o.steps.map((s) => `<li class="ld-step" data-s="wait" data-id="${s}"><i class="ld-dot"></i><span class="ld-name">${LABEL[s]}</span><span class="ld-info"></span></li>`).join('')}</ol>
      <div class="ld-chips"></div>
      <div class="ld-status"></div>
      <div class="ld-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ld-bar"></div></div>
      <div class="ld-foot"><span class="ld-diag">${esc(o.diag ?? '')}</span><span class="ld-time">0.0 s</span><strong class="ld-pct">0%</strong></div>`;
    host.append(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.titleEl = q('.ld-title');
    this.bar = q('.ld-bar');
    this.pct = q('.ld-pct');
    this.time = q('.ld-time');
    this.status = q('.ld-status');
    this.chips = q('.ld-chips');
    for (const li of this.root.querySelectorAll<HTMLElement>('.ld-step')) {
      this.rows.set(li.dataset.id as StepId, { el: li, info: li.querySelector('.ld-info')!, state: 'wait', fraction: 0 });
    }
    this.setTitle(o.title);
    this.timer = window.setInterval(() => {
      this.time.textContent = `${((performance.now() - this.t0) / 1000).toFixed(1)} s`;
    }, 100);
  }

  setTitle(title: string) {
    this.titleEl.textContent = title.toUpperCase();
  }

  /** Sets one step. `fraction` 0..1 of the step; `info` the text at its right. */
  step(id: StepId, state: State, fraction: number, info = '') {
    const r = this.rows.get(id);
    if (!r) return;
    r.state = state;
    r.fraction = state === 'done' ? 1 : fraction;
    r.el.dataset.s = state;
    r.info.textContent = info;
    this.draw();
  }

  /** Feeds a report of Engine.init. */
  engine(p: InitProgress) {
    if (p.phase === 'manifest') this.step('data', 'run', 0.5, '');
    else if (p.phase === 'fonts') {
      this.step('data', 'done', 1);
      this.step('fonts', 'run', 0.5);
    } else if (p.phase === 'scenes') {
      this.step('fonts', 'done', 1);
      if (p.ids) {
        this.chips.innerHTML = p.ids.map((id) => `<i class="ld-chip" data-id="${esc(id)}">${esc(id)}</i>`).join('');
        for (const c of this.chips.querySelectorAll<HTMLElement>('.ld-chip')) this.chip.set(c.dataset.id!, c);
        this.step('scenes', 'run', 0, `0 / ${p.ids.length}`);
      }
      if (p.scene) {
        this.chip.get(p.scene)?.classList.add('ok');
        const n = this.chips.querySelectorAll('.ld-chip.ok').length;
        this.step('scenes', 'run', n / Math.max(1, this.chip.size), `${n} / ${this.chip.size}`);
      }
    } else if (p.phase === 'ready') {
      for (const c of this.chip.values()) c.classList.add('ok');
      this.step('scenes', 'done', 1, `${this.chip.size} / ${this.chip.size}`);
    }
    this.status.textContent = p.detail;
  }

  /** Download progress of the mix, 0..1; `decoded`: the mix is in memory. */
  audio(fraction: number, decoded = false) {
    if (decoded) this.step('audio', 'done', 1);
    else this.step('audio', 'run', fraction, `${Math.round(fraction * 100)} %`);
  }

  /** The bar never moves back: steps report in any order. */
  private draw() {
    let sum = 0, all = 0;
    for (const [id, r] of this.rows) {
      sum += WEIGHT[id] * r.fraction;
      all += WEIGHT[id];
    }
    this.shown = Math.max(this.shown, all ? sum / all : 0);
    const pct = Math.round(this.shown * 100);
    this.bar.style.width = `${pct}%`;
    this.pct.textContent = `${pct}%`;
    this.root.querySelector('.ld-track')!.setAttribute('aria-valuenow', String(pct));
  }

  /** A step failed: the box shows `message` and stops the clock. */
  fail(message: string) {
    clearInterval(this.timer);
    for (const r of this.rows.values()) if (r.state === 'run') r.el.dataset.s = 'error';
    this.status.textContent = message;
    this.status.classList.add('error');
  }

  /** Stops the clock and takes the box out of the page. */
  dispose() {
    clearInterval(this.timer);
    this.root.remove();
  }
}

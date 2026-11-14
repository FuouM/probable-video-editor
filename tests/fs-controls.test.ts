import { describe, expect, it } from 'bun:test';
import { NleFullscreenControls, fmtTime } from '../app/src/ui/fs-controls';

// Minimal mock DOM node for testing UI logic in headless node/bun environment
class MockClassList {
  private classes = new Set<string>();
  constructor(initial = '') {
    if (initial) initial.split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
  }
  add(c: string) { this.classes.add(c); }
  remove(c: string) { this.classes.delete(c); }
  contains(c: string) { return this.classes.has(c); }
  toggle(c: string, force?: boolean) {
    const next = force !== undefined ? force : !this.classes.has(c);
    if (next) this.classes.add(c); else this.classes.delete(c);
    return next;
  }
  toString() { return Array.from(this.classes).join(' '); }
}

class MockElement {
  id = '';
  className = '';
  classList: MockClassList;
  style: Record<string, string> = {};
  title = '';
  value = '';
  textContent = '';
  options: Array<{ value: string; selected?: boolean }> = [];
  children: MockElement[] = [];
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  attrs: Record<string, string> = {};

  constructor(public tagName: string) {
    this.classList = new MockClassList();
  }

  set innerHTML(html: string) {
    this.children = [];
    const idMatches = html.matchAll(/id="([^"]+)"/g);
    for (const m of idMatches) {
      const child = new MockElement('div');
      child.id = m[1]!;
      if (child.id === 'fs-vol') child.value = '1';
      if (child.id === 'fs-speed') {
        child.options = [{ value: '0.25' }, { value: '0.5' }, { value: '1' }, { value: '2' }];
        child.value = '1';
      }
      if (child.id === 'fs-res') {
        child.options = [{ value: '0.5' }, { value: '1' }];
        child.value = '1';
      }
      this.children.push(child);
    }
  }

  appendChild(child: MockElement) {
    this.children.push(child);
    return child;
  }

  querySelector(sel: string): MockElement | null {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this.id === id) return this;
      for (const c of this.children) {
        const found = c.querySelector(sel);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(sel: string): MockElement[] {
    const res: MockElement[] = [];
    if (sel === 'button') {
      for (const c of this.children) {
        if (c.id.includes('btn')) res.push(c);
      }
    }
    return res;
  }

  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k]; }

  addEventListener(type: string, fn: (ev: unknown) => void) {
    this.listeners[type] ??= [];
    this.listeners[type]!.push(fn);
  }

  dispatchEvent(ev: unknown) {
    const type = ev && typeof ev === 'object' && 'type' in ev && typeof ev.type === 'string' ? ev.type : '';
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }

  click() {
    this.dispatchEvent({ type: 'click' });
  }

  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1000, height: 20, right: 1000, bottom: 20 };
  }
}

interface LocalStorageMock {
  storage: Record<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
}

const mockStorage: LocalStorageMock = {
  storage: {},
  getItem(k: string) { return this.storage[k] ?? null; },
  setItem(k: string, v: string) { this.storage[k] = v; },
};

interface TestGlobal {
  document: { createElement: (tag: string) => MockElement };
  localStorage: LocalStorageMock;
}

const testGlobal = globalThis as unknown as TestGlobal;
testGlobal.document = {
  createElement: (tag: string) => new MockElement(tag),
};
testGlobal.localStorage = mockStorage;

describe('NleFullscreenControls', () => {
  it('formats time in mm:ss format', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(5)).toBe('0:05');
    expect(fmtTime(65)).toBe('1:05');
    expect(fmtTime(3600)).toBe('60:00');
  });

  it('mounts into DOM and wires up buttons and controls', () => {
    const containerMock = new MockElement('div');
    const container = containerMock as unknown as HTMLElement;

    let played = false;
    let seekStartCalled = false;
    let prevCalled = false;
    let nextCalled = false;
    let loopToggled = false;
    let fsToggled = false;
    let seekT: number | null = null;
    let currentVol = 1;
    let currentMuted = false;
    let currentSpeed = 1;
    let currentScale = 1;

    const fsControls = new NleFullscreenControls(container, {
      onTogglePlay: () => { played = !played; },
      onSeek: (t) => { seekT = t; },
      onSeekStart: () => { seekStartCalled = true; },
      onPrevSection: () => { prevCalled = true; },
      onNextSection: () => { nextCalled = true; },
      onToggleLoop: () => { loopToggled = true; },
      onVolumeChange: (v, m) => { currentVol = v; currentMuted = m; },
      onSpeedChange: (s) => { currentSpeed = s; },
      onScaleChange: (sc) => { currentScale = sc; },
      onToggleFullscreen: () => { fsToggled = true; },
    });

    expect(fsControls.el).toBeDefined();
    const rootEl = fsControls.el as unknown as MockElement;

    // Verify sections and seek bar ticks
    fsControls.setSections([
      { name: 'Intro', start: 0, end: 10 },
      { name: 'Verse', start: 10, end: 30 },
      { name: 'Chorus', start: 30, end: 60 },
    ], 60);

    // Verify button clicks
    const btnPlay = rootEl.querySelector('#fs-btn-play')!;
    btnPlay.click();
    expect(played).toBe(true);

    const btnStart = rootEl.querySelector('#fs-btn-start')!;
    btnStart.click();
    expect(seekStartCalled).toBe(true);

    const btnPrev = rootEl.querySelector('#fs-btn-prev')!;
    btnPrev.click();
    expect(prevCalled).toBe(true);

    const btnNext = rootEl.querySelector('#fs-btn-next')!;
    btnNext.click();
    expect(nextCalled).toBe(true);

    const btnLoop = rootEl.querySelector('#fs-btn-loop')!;
    btnLoop.click();
    expect(loopToggled).toBe(true);

    const btnFull = rootEl.querySelector('#fs-btn-full')!;
    btnFull.click();
    expect(fsToggled).toBe(true);

    // Verify state update
    fsControls.update({
      time: 15,
      duration: 60,
      playing: true,
      loop: true,
      sectionName: 'Verse',
      fps: 59.8,
      renderMs: 12.3,
      speed: 1.0,
      projectId: 'test_project',
    });

    const timeNow = rootEl.querySelector('#fs-time-now')!;
    const timeTotal = rootEl.querySelector('#fs-time-total')!;
    const section = rootEl.querySelector('#fs-section')!;
    const stat = rootEl.querySelector('#fs-stat')!;

    expect(timeNow.textContent).toBe('0:15');
    expect(timeTotal.textContent).toBe('1:00');
    expect(section.textContent).toBe('Verse');
    expect(stat.textContent).toContain('test_project · 1920×1080 · 60 FPS · 12.3 ms');

    // Verify speed selector change
    const speedSelect = rootEl.querySelector('#fs-speed')!;
    speedSelect.value = '0.5';
    speedSelect.dispatchEvent({ type: 'change' });
    expect(currentSpeed).toBe(0.5);

    // Verify resolution selector change
    const resSelect = rootEl.querySelector('#fs-res')!;
    resSelect.value = '0.5';
    resSelect.dispatchEvent({ type: 'change' });
    expect(currentScale).toBe(0.5);

    // Verify volume and mute
    fsControls.toggleMute();
    expect(currentMuted).toBe(true);
    fsControls.toggleMute();
    expect(currentMuted).toBe(false);

    fsControls.stepVolume(-0.2);
    expect(currentVol).toBeCloseTo(0.8, 1);

    // Verify fullscreen toggle icon
    fsControls.setFullscreen(true);
    expect(btnFull.title).toContain('Exit fullscreen');
    fsControls.setFullscreen(false);
    expect(btnFull.title).toContain('Fullscreen');

    // Verify seek bar pointer interaction
    const seek = rootEl.querySelector('#fs-seek')!;
    seek.dispatchEvent({ type: 'pointerdown', clientX: 300, pointerId: 1 });
    expect(seekT).not.toBeNull();
    expect(seekT ?? 0).toBeGreaterThan(0);
  });
});

// The DOM interpreter: real interface code (HTML and CSS) as objects of a scene.
// `DomUi` holds the interface code in a hidden frame of the page. The browser parses it, applies the cascade and
// lays it out. A `Surface` reads one element and its subtree (domread.ts), paints the display list on a canvas
// (dompaint.ts) and shows it as a textured object. A scene sets the state of the interface (text, classes,
// attributes) from the song time, then calls `update()`: the read is synchronous, so a frame depends only on t.
// An update paints only the part of the canvas where the display list changed, and the result is the same as a
// full paint: each item that reaches into that part paints again, clipped to it.
import * as THREE from 'three';
import { H, W } from './gl';
import { UNSHOULDER_GLSL } from './litview';
import { SCALE } from './scale';
import { paint } from './dompaint';
import { describe, diff, ReadCache, readDom, type BoxNode, type Rect, type ReadEnv } from './domread';

export interface DomUiOptions {
  /** The markup of the interface (the content of `<body>`). */
  html: string;
  /** Addresses of style sheets. The frame loads each one with a `<link>`, as a page does. */
  styles?: string[];
  /** More CSS, as text, after the style sheets. */
  css?: string[];
  /** The size of the page that the interface is laid out in, CSS px (default 1920 x 1080). */
  width?: number;
  height?: number;
}

const PSEUDO = ['before', 'after'] as const;
const NO_PSEUDO: Record<string, true> = { INPUT: true, IMG: true, BR: true, HR: true, TEXTAREA: true };
/** Transparent canvas px round the picture: the edge of the quad lies in them, so the edge of the picture is filtered. */
const EDGE = 8;
/** The side of a paint tile, canvas px. */
const TILE = 128;

function cssString(v: string): string {
  return v.slice(1, -1).replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_, hex: string | undefined, ch: string | undefined) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch!));
}

const urlKey = (u: string) => u.trim().replace(/^["']|["']$/g, '').replace(/\\(["'])/g, '$1');

export class DomUi {
  readonly frame: HTMLIFrameElement;
  doc!: Document;
  win!: Window & typeof globalThis;
  private observer!: MutationObserver;
  private images = new Map<string, HTMLImageElement>();
  private fonts = new Map<string, { asc: number; desc: number }>();
  private measure!: CanvasRenderingContext2D;
  private surfaces: Surface[] = [];
  /** The song time of the last `animate()`, ms, or null when no scene drives the animations. */
  private clock: number | null = null;

  private constructor(o: DomUiOptions) {
    this.frame = document.createElement('iframe');
    this.frame.style.cssText = `position:fixed;left:0;top:0;width:${o.width ?? W}px;height:${o.height ?? H}px;border:0;opacity:0;pointer-events:none;z-index:-1`;
  }

  /** Loads the interface: the frame, its fonts, its `<img>` elements and every image that the style sheets name. */
  static async create(o: DomUiOptions): Promise<DomUi> {
    const ui = new DomUi(o);
    const head = (o.styles ?? []).map((s) => `<link rel="stylesheet" href="${s}">`).join('') + (o.css ?? []).map((s) => `<style>${s}</style>`).join('');
    ui.frame.srcdoc = `<!doctype html><html><head>${head}<style>[data-pve-before]::before,[data-pve-after]::after{content:none!important}</style></head><body>${o.html}</body></html>`;
    const { promise: loaded, resolve } = Promise.withResolvers<void>();
    ui.frame.addEventListener('load', () => resolve(), { once: true });
    document.body.appendChild(ui.frame);
    await loaded;
    ui.doc = ui.frame.contentDocument!;
    ui.win = ui.frame.contentWindow as Window & typeof globalThis;
    await ui.doc.fonts.ready;
    ui.measure = ui.doc.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const jobs: Promise<void>[] = [];
    for (const sheet of ui.doc.styleSheets) {
      const text = [...sheet.cssRules].filter((r) => !(r instanceof ui.win.CSSFontFaceRule)).map((r) => r.cssText).join('\n');
      for (const m of text.matchAll(/url\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^)]*)\)/g)) jobs.push(ui.preload(m[1]!, sheet.href ?? undefined));
    }
    for (const img of ui.doc.images) {
      jobs.push(img.decode().catch(() => {
        throw new Error(`dom: the image ${img.src.slice(0, 80)} of ${describe(img)} does not load`);
      }));
    }
    await Promise.all(jobs);
    ui.observer = new ui.win.MutationObserver(() => {});
    ui.observer.observe(ui.doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return ui;
  }

  /** Loads the image of a `url()` (relative to `base`). Call it in init for an image that no style sheet names. */
  async preload(url: string, base = this.doc.baseURI): Promise<void> {
    const key = urlKey(url);
    const href = key.startsWith('data:') ? key : new URL(key, base).href;
    if (this.images.has(href)) return;
    const img = new this.win.Image();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error(`dom: the image ${href.slice(0, 80)} does not load`)), { once: true });
    img.src = href;
    await promise;
    if (/^data:image\/svg\+xml|\.svg(\?|#|$)/i.test(href)) {
      const comma = href.indexOf(',');
      const text = !href.startsWith('data:') ? await (await fetch(href)).text() : /;base64/i.test(href.slice(0, comma)) ? atob(href.slice(comma + 1)) : decodeURIComponent(href.slice(comma + 1));
      const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
      if (!/\swidth\s*=/.test(tag) || !/\sheight\s*=/.test(tag)) this.noSize.add(img);
    }
    this.images.set(href, img);
  }

  /** The loaded image of a computed `url()`. */
  image = (url: string): HTMLImageElement => {
    const img = this.images.get(url);
    if (!img) throw new Error(`dom: the image ${url.slice(0, 80)} is not loaded. Call preload() in init.`);
    return img;
  };

  /** True for an image with a ratio and no size of its own (an SVG with only a viewBox). */
  unsized = (img: HTMLImageElement) => this.noSize.has(img);
  private noSize = new WeakSet<HTMLImageElement>();

  metrics = (font: string) => {
    let m = this.fonts.get(font);
    if (!m) {
      this.measure.font = font;
      const t = this.measure.measureText('Hg');
      m = { asc: t.fontBoundingBoxAscent, desc: t.fontBoundingBoxDescent };
      this.fonts.set(font, m);
    }
    return m;
  };

  width = (font: string, s: string) => {
    this.measure.font = font;
    return this.measure.measureText(s).width;
  };

  /** The one element that matches `sel`. Throws when there is none. */
  $<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = this.doc.querySelector<T>(sel);
    if (!el) throw new Error(`dom: no element matches ${sel}`);
    return el;
  }

  /** A surface of element `el` (or the element that matches it) and its subtree, at `res` canvas px per CSS px. */
  surface(el: string | HTMLElement, o: { res?: number } = {}): Surface {
    const s = new Surface(this, typeof el === 'string' ? this.$(el) : el, o.res ?? 1);
    this.surfaces.push(s);
    return s;
  }

  /** Marks every surface for a new read, styles and pseudo-elements too. Call it after a change that is not a DOM mutation (a `checked`, a `value`, a scroll). */
  invalidate() {
    this.restyled = true;
    for (const s of this.surfaces) {
      s.dirty = true;
      s.cache.restyle();
      s.restyle.add(s.el);
    }
  }
  /** A style changed since the last `drive()`: a transition or an animation can have started. */
  private restyled = true;

  /**
   * Puts every CSS animation of the frame at song time `t` (seconds): the clock of the animations is the song
   * clock, from 0. An animation that must start at a time of the song gets that time as its `animation-delay`.
   * Call it on each frame after the scene set the state of the interface, before `update()`.
   */
  animate(t: number) {
    this.clock = t * 1000;
    this.drive();
  }

  /**
   * Finishes each CSS transition (a style is a function of the time, not of the frame before) and puts each
   * animation at the clock of `animate()`. Throws for an animation when no scene drives the clock.
   */
  private drive() {
    this.restyled = false;
    for (const a of this.doc.getAnimations()) {
      const fx = a.effect as KeyframeEffect | null;
      const target = fx?.target ?? null;
      if (a instanceof this.win.CSSTransition) {
        a.finish();
      } else {
        if (this.clock === null) throw new Error(`dom: ${target ? describe(target) : 'an element'} has a CSS animation: call ui.animate(t) on each frame before update()`);
        if (a.playState !== 'paused') a.pause();
        if (a.currentTime === this.clock) continue;
        a.currentTime = this.clock;
      }
      if (!target) continue;
      for (const s of this.surfaces) {
        if (!s.el.contains(target) && !target.contains(s.el)) continue;
        s.dirty = true;
        s.cache.restyleTree(target);
        if (fx?.pseudoElement) s.restyle.add(target);
      }
    }
  }

  /** Marks the surfaces that the DOM mutations and the animations since the last call can change. */
  sync() {
    for (const rec of this.observer.takeRecords()) {
      // a change of text keeps the styles, other changes (attributes, elements) can change which rules match
      const styled = rec.type === 'attributes' || (rec.type === 'childList' && ([...rec.addedNodes, ...rec.removedNodes].some((n) => n.nodeType === 1) || !rec.target.firstChild || !rec.removedNodes.length));
      for (const s of this.surfaces) {
        const inside = s.el.contains(rec.target);
        if (!inside && !rec.target.contains(s.el)) continue;
        s.dirty = true;
        if (!styled) continue;
        this.restyled = true;
        s.cache.restyle();
        // the element, its siblings and their subtrees get their pseudo-elements again
        const at = rec.type === 'attributes' && rec.target !== s.el ? rec.target.parentElement! : (rec.target as Element);
        s.restyle.add(inside ? at : s.el);
      }
    }
    // only a change of style starts a transition or an animation: a frame with none skips the query
    if (this.restyled) this.drive();
  }

  /** Drops the mutation records of the interpreter's own changes (pseudo-elements, transforms off for a read). */
  drop() {
    this.observer.takeRecords();
  }

  /**
   * Makes each `::before` and `::after` of the subtree of `root` a real `<span>` with the computed style of the
   * pseudo-element: the browser gives no box for a pseudo-element, but it gives one for a span.
   */
  materialize(root: Element) {
    const { doc, win } = this;
    for (const old of root.querySelectorAll('[data-pve-pseudo]')) old.remove();
    const all = [root, ...root.querySelectorAll('*')];
    for (const el of all) for (const which of PSEUDO) el.removeAttribute(`data-pve-${which}`);
    for (const el of all) {
      if (NO_PSEUDO[el.tagName]) continue;
      for (const which of PSEUDO) {
        const cs = win.getComputedStyle(el, `::${which}`);
        const content = cs.content;
        if (content === 'none' || content === 'normal') continue;
        // the browser gives attr() as its text already: what is left must be strings
        const parts = content.match(/"(?:[^"\\]|\\.)*"|\S+/gs) ?? [];
        const bad = parts.find((p) => !p.startsWith('"'));
        if (bad) throw new Error(`dom: ${describe(el)}::${which} content: ${bad.slice(0, 40)} is not supported (strings and attr() are)`);
        const props: [string, string][] = [];
        for (const p of cs) if (p !== 'content' && !p.startsWith('transition') && !p.startsWith('animation')) props.push([p, cs.getPropertyValue(p)]);
        const span = doc.createElement('span');
        span.setAttribute('data-pve-pseudo', which);
        if (which === 'before') el.prepend(span); else el.append(span);
        const ref = win.getComputedStyle(span);
        const diffs = props.filter(([p, v]) => ref.getPropertyValue(p) !== v);
        for (const [p, v] of diffs) span.style.setProperty(p, v);
        span.textContent = parts.map(cssString).join('');
        el.setAttribute(`data-pve-${which}`, '');
      }
    }
    this.observer.takeRecords();
  }

  dispose() {
    for (const s of this.surfaces) s.dispose();
    this.observer.disconnect();
    this.frame.remove();
  }
}

const QUAD = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

/** One element of the interface as an object: `object` has its origin at the top left of the border box, y down, 1 unit = 1 CSS px. */
export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.RawShaderMaterial;
  /** Put this into a scene and move it. The picture is a child, so shadows reach outside the box. */
  readonly object = new THREE.Group();
  private mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  /** The display list of the last read. */
  node: BoxNode | null = null;
  /** The border box in the page of the interface, CSS px. */
  x = 0; y = 0; w = 0; h = 0;
  dirty = true;
  /** Roots of the subtrees whose pseudo-elements the next update makes again. */
  readonly restyle = new Set<Element>();
  /** The looks and words of the last read. */
  readonly cache = new ReadCache();
  /** The canvas px of the surface origin in the canvas, or null before the first paint. */
  private at: [number, number] | null = null;
  /** The canvas px of the last update that painted, as x, y, w, h: the part of the canvas that changed. */
  painted: [number, number, number, number] = [0, 0, 0, 0];

  constructor(private ui: DomUi, readonly el: HTMLElement, readonly res: number) {
    // a canvas of the frame's document draws with the fonts of the frame
    this.canvas = ui.doc.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    // The canvas holds sRGB values with premultiplied alpha. The texture keeps them as they are, so the GPU filters
    // (and makes the mipmaps of) premultiplied values: a turned or small picture has no dark or light fringe.
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.premultiplyAlpha = true;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 16;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: /* glsl */ `precision highp float;
        in vec3 position; in vec2 uv; uniform mat4 projectionMatrix, modelViewMatrix; out vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `precision highp float;
        in vec2 vUv; out vec4 fragColor; uniform sampler2D map; uniform float opacity, display;
        ${UNSHOULDER_GLSL}
        vec3 linear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
        void main() {
          vec4 p = texture(map, vUv);
          if (p.a <= 0.0) discard;
          vec3 c = linear(min(p.rgb / p.a, vec3(1.0)));
          // display 1: the colours of the interface arrive on the screen as the style sheet gives them.
          // Not over 2.0: from there the tone shoulder of the engine turns a bright colour to white.
          c = mix(c, min(unshoulder(c), vec3(2.0)), display);
          fragColor = vec4(c * p.a, p.a) * opacity;
        }`,
      uniforms: { map: { value: this.texture }, opacity: { value: 1 }, display: { value: 1 } },
      side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(QUAD, this.material);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.restyle.add(el);
  }

  /** Reads the element again when the interface changed, and paints the part that changed. Returns true when it painted. */
  update(): boolean {
    this.ui.sync();
    if (!this.dirty) return false;
    this.dirty = false;
    for (const root of this.restyle) if (this.el.contains(root)) this.ui.materialize(root);
    this.restyle.clear();
    const r = this.el.getBoundingClientRect();
    this.x = r.left; this.y = r.top; this.w = r.width; this.h = r.height;
    const env: ReadEnv = { ox: r.left, oy: r.top, metrics: this.ui.metrics, width: this.ui.width, cache: this.cache };
    let node: BoxNode | null;
    try {
      node = readDom(this.el, env);
    } finally {
      this.ui.drop();
    }
    const prev = this.node;
    this.node = node;
    // the canvas covers the box and all that its subtree paints, and a margin of transparent px
    const k = this.res * SCALE;
    const b: Rect = node ? [Math.min(0, node.sb[0]), Math.min(0, node.sb[1]), Math.max(r.width, node.sb[2]), Math.max(r.height, node.sb[3])] : [0, 0, r.width, r.height];
    const x0 = Math.floor(b[0] * k) - EDGE, y0 = Math.floor(b[1] * k) - EDGE;
    const cw = Math.ceil(b[2] * k) + EDGE - x0, ch = Math.ceil(b[3] * k) + EDGE - y0;
    let full = !prev || !node || !this.at || this.at[0] !== -x0 || this.at[1] !== -y0;
    if (cw !== this.canvas.width || ch !== this.canvas.height) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      full = true;
    }
    this.at = [-x0, -y0];
    // The canvas paints in fixed tiles, each clipped to its own square: a tile paints the same ops with the same
    // clip in a full paint and in a partial one, so the two give the same bytes. A partial paint paints only the
    // tiles that the change reaches.
    let tx0 = 0, ty0 = 0, tx1 = Math.ceil(cw / TILE), ty1 = Math.ceil(ch / TILE);
    if (!full) {
      const d = diff(prev!, node!);
      if (!d) return false;
      tx0 = Math.max(tx0, Math.floor((Math.floor(d[0] * k) - x0) / TILE));
      ty0 = Math.max(ty0, Math.floor((Math.floor(d[1] * k) - y0) / TILE));
      tx1 = Math.min(tx1, Math.ceil((Math.ceil(d[2] * k) - x0) / TILE));
      ty1 = Math.min(ty1, Math.ceil((Math.ceil(d[3] * k) - y0) / TILE));
      if (tx1 <= tx0 || ty1 <= ty0) return false;
    }
    const c = this.ctx;
    for (let ty = ty0; ty < ty1; ty++) {
      for (let tx = tx0; tx < tx1; tx++) {
        const px0 = tx * TILE, py0 = ty * TILE, pw = Math.min(TILE, cw - px0), ph = Math.min(TILE, ch - py0);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(px0, py0, pw, ph);
        if (!node) continue;
        c.save();
        c.beginPath();
        c.rect(px0, py0, pw, ph);
        c.clip();
        c.setTransform(k, 0, 0, k, -x0, -y0);
        const cull: Rect = [(px0 + x0) / k, (py0 + y0) / k, (px0 + pw + x0) / k, (py0 + ph + y0) / k];
        paint(c, node, { res: k, image: this.ui.image, unsized: this.ui.unsized, cull });
        c.restore();
      }
    }
    const part: [number, number, number, number] = [tx0 * TILE, ty0 * TILE, Math.min(cw, tx1 * TILE) - tx0 * TILE, Math.min(ch, ty1 * TILE) - ty0 * TILE];
    this.painted = part;
    // A new GL texture for each paint. The canvas bytes do not depend on earlier paints, but on D3D11 ANGLE the
    // mipmaps of a texture that was uploaded again did (1 level in far, minified texels): a frame then depended on
    // the frames that the page rendered before it. A new texture is allocated, uploaded and mipmapped from scratch.
    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.mesh.position.set(x0 / k, y0 / k, 0);
    this.mesh.scale.set(cw / k, ch / k, 1);
    return true;
  }

  /** Paints the whole canvas again on the next update, with no partial paint. */
  repaint() {
    this.dirty = true;
    this.at = null;
  }

  /** The box of a descendant (or of the element itself), px from the top left of the surface. */
  box(el: string | Element = this.el): { x: number; y: number; w: number; h: number } {
    const e = typeof el === 'string' ? this.el.querySelector(el) : el;
    if (!e) throw new Error(`dom: no element matches ${String(el)} in ${describe(this.el)}`);
    const r = e.getBoundingClientRect(), o = this.el.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  dispose() {
    this.texture.dispose();
    this.material.dispose();
  }
}

/** A camera for surfaces in the logical frame: x right, y down, 1 unit = 1 px of the 1920 x 1080 frame. */
export function pixelCamera(): THREE.OrthographicCamera {
  return new THREE.OrthographicCamera(0, W, 0, H, -1000, 1000);
}

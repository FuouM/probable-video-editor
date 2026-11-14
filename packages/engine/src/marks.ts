// Object marks: a scene names what it draws ("first-i", "syl:mir", "ac-unit") with a box in frame px.
// The engine clears the list before each composite and tags each mark with the clip being rendered, so after
// a frame `marks()` says what was on it and where. `pve probe` reads them to crop, track and check objects.
// Metrics: a scene reports a value it computed (`metric('load.u', u)`); `pve probe --metrics` lists them per frame
// and finds jumps. Camera records: the export page records each camera that renders (`recordRender`), so
// `pve probe --cams` can list the true position, turn and lens of every camera per frame.
// Marks, metrics and camera records cost nothing for the picture: they are bookkeeping only.
import { OrthographicCamera, PerspectiveCamera, type Camera } from 'three';

/** A named object of the last rendered frame: its bounding box in logical frame px (1920x1080). */
export interface Mark {
  name: string;
  /** the timeline entry (clip or Over transition) that drew it */
  clip: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

let list: Mark[] = [];
let clip = '';
let on = true;

/** Engine: start a new frame's marks. */
export function clearMarks() {
  list = [];
  metricList = [];
  camList = [];
  camOrder = 0;
}
/** Engine: the entry now rendering; `record` false while a stateful scene prerolls. Returns the prior scope. */
export function markScope(id: string, record: boolean): [string, boolean] {
  const prev: [string, boolean] = [clip, on];
  clip = id;
  on = record;
  return prev;
}
/** The marks of the last rendered frame. */
export function marks(): readonly Mark[] {
  return list;
}

/** Replay previously captured marks for a cached frame. */
export function pushMarks(ms: readonly Mark[]) {
  if (!on) return;
  for (const m of ms) list.push(m);
}

/**
 * Name an object drawn this frame. With a 2D context the box is in its current coordinates and is mapped
 * through its transform (the bounding box of the four corners); without one it is in frame px.
 */
export function mark(name: string, x: number, y: number, w: number, h: number, c?: CanvasRenderingContext2D) {
  if (!on) return;
  if (c) {
    const m = c.getTransform();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) {
      const sx = m.a * px + m.c * py + m.e, sy = m.b * px + m.d * py + m.f;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    list.push({ name, clip, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  } else list.push({ name, clip, x, y, w, h });
}

/** A value that a scene computed for the last rendered frame: one number or a few (a vector). */
export interface Metric {
  name: string;
  clip: string;
  v: number[];
}

let metricList: Metric[] = [];

/** Report a value of this frame (for `pve probe --metrics`). A name reported twice in a frame keeps the last value. */
export function metric(name: string, ...v: number[]) {
  if (!on) return;
  const i = metricList.findIndex((m) => m.name === name && m.clip === clip);
  const m = { name, clip, v };
  if (i < 0) metricList.push(m);
  else metricList[i] = m;
}

/** The metrics of the last rendered frame. */
export function metrics(): readonly Metric[] {
  return metricList;
}

/**
 * One camera of the last rendered frame, as it rendered (the last render through it). Angles in degrees: `yaw` 0 looks along -z and
 * grows toward -x (to the left), `pitch` up is positive, `roll` clockwise is positive. `lens`: the vertical fov (degrees) of a
 * perspective camera, the frame height (world units) of an orthographic one. `view`: the viewport it drew into (px).
 */
export interface CamRecord {
  /** stable for the camera object for the life of the page */
  id: number;
  name: string;
  clip: string;
  kind: 'persp' | 'ortho' | 'quad' | 'other';
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  roll: number;
  lens: number;
  /** how much of a perspective projection it has: 1 perspective, 0 orthographic, between for a blend (from its projection matrix) */
  persp: number;
  view: [number, number, number, number];
  /** how many renders went through it in the frame */
  renders: number;
  /** the order of its last render in the frame (the last one drew over the others) */
  order: number;
}

let camList: CamRecord[] = [];
let camOrder = 0;
const camIds = new WeakMap<Camera, number>();
let nextCam = 0;

/** The export page: a camera has rendered into the viewport `view` (px). Called after each `renderer.render`. */
export function recordRender(cam: Camera, view: [number, number, number, number]) {
  if (!on) return;
  let id = camIds.get(cam);
  if (id === undefined) camIds.set(cam, (id = nextCam++));
  // (the render has brought the camera's world matrix up to date)
  const e = cam.matrixWorld.elements;
  // the axes of the camera in the world: right (x), up (y), back (z)
  const rx = e[0]!, ry = e[1]!, rz = e[2]!, ux = e[4]!, uy = e[5]!, uz = e[6]!, bx = e[8]!, by = e[9]!, bz = e[10]!;
  const rl = Math.hypot(rx, ry, rz), ul = Math.hypot(ux, uy, uz), bl = Math.hypot(bx, by, bz);
  const fx = -bx / bl, fy = -by / bl, fz = -bz / bl;
  const deg = 180 / Math.PI;
  const yaw = Math.atan2(-fx, -fz) * deg, pitch = Math.asin(Math.max(-1, Math.min(1, fy))) * deg;
  const roll = Math.atan2(-ry / rl, uy / ul) * deg;
  let kind: CamRecord['kind'] = 'other', lens = 0;
  if (cam instanceof PerspectiveCamera) {
    kind = 'persp';
    lens = cam.fov;
  } else if (cam instanceof OrthographicCamera) {
    // a full-screen pass draws through a fixed -1..1 camera at the origin
    const quad = cam.left === -1 && cam.right === 1 && cam.top === 1 && cam.bottom === -1 && e[12] === 0 && e[13] === 0 && e[14] === 0;
    kind = quad ? 'quad' : 'ortho';
    lens = (cam.top - cam.bottom) / cam.zoom;
  }
  const k = camList.findIndex((r) => r.id === id);
  const persp = -cam.projectionMatrix.elements[11]!;
  const rec: CamRecord = { id, name: cam.name, clip, kind, pos: [e[12]!, e[13]!, e[14]!], yaw, pitch, roll, lens, persp, view, renders: k < 0 ? 1 : camList[k]!.renders + 1, order: camOrder++ };
  if (k < 0) camList.push(rec);
  else camList[k] = rec;
}

/** The cameras of the last rendered frame. */
export function cameras(): readonly CamRecord[] {
  return camList;
}

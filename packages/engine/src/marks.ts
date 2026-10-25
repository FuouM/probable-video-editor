// Object marks: a scene names what it draws ("first-i", "syl:mir", "ac-unit") with a box in frame px.
// The engine clears the list before each composite and tags each mark with the clip being rendered, so after
// a frame `marks()` says what was on it and where. `pve probe` reads them to crop, track and check objects.
// Marks cost nothing for the picture: they are bookkeeping only.

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
}
/** Engine: the entry now rendering; `record` false while a stateful scene prerolls. */
export function markScope(id: string, record: boolean) {
  clip = id;
  on = record;
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

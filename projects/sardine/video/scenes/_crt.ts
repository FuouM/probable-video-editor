// The CRT of the room (treatment "Crossing between the worlds"), round the engine's tube (`@pve/engine/crt`). Shared by every scene
// that shows the tube:
//  - `TitleLogo`: the title screen of the game on the glass.
//  - `crtFill`: the eye and the lens at which the glass fills the frame exactly. The push into the CRT travels to it.
//  - `pushToFill`: the one travelling camera move of the video. It eases the head's eye to the fill pose.
// Everything here is a pure function of its arguments.
import * as THREE from 'three';
import { bigText, type Mask, type Pixels } from '@pve/engine/type';
import type { TextLayer } from '@pve/engine/textlayer';
import type { Home } from './_home';
import type { Fonts } from './_fonts';

// ---------------------------------------------------------------- the title screen of the game
/** The colours of the title screen, as indices of the sink: cream ink, blue edge, dark outline, amber prompt, grey small text. */
export const TITLE_INKS = { 1: '#f6efdc', 2: '#1d4a6e', 3: '#0a0c14', 4: '#ffd34a', 5: '#9aa4b8' } as const;

type Big = { ink: Mask; edge: Mask; outer: Mask | null };

/** The masks of the title screen: the three lines of the logo and the DAY 1 card. */
export class TitleLogo {
  readonly lines: Big[];
  readonly day: Big;
  constructor(readonly fonts: Fonts) {
    this.lines = ['イワシが', 'つちから', 'はえてくるんだ'].map((s) => bigText(fonts.kana, s, 3, 1, 1));
    this.day = bigText(fonts.latin, 'DAY 1', 5, 1, 1);
  }

  /** Draws big type centred on x = 320 with its top at y. */
  centre(sink: Pixels, m: Big, y: number, ink = 1) {
    const x = Math.round(320 - (m.ink.x0 + m.ink.w / 2));
    m.outer?.draw(sink, x, y, 3);
    m.edge.draw(sink, x, y, 2);
    m.ink.draw(sink, x, y, ink);
  }

  /** Draws a line of small Latin text centred on x = 320, with its baseline at y. */
  text(sink: Pixels, s: string, y: number, i: number) {
    const latin = this.fonts.latin;
    latin.draw(sink, s, Math.round(320 - latin.width(s) / 2), y, i);
  }

  /** Draws the card: a dark band, the logo, the English subtitle and the footer. The caller draws the prompt or the menu (y 262-314). */
  card(l: TextLayer, sink: Pixels) {
    l.shade(0, 52, 640, 214, 0.55);
    this.lines.forEach((m, k) => this.centre(sink, m, 66 + k * 54));
    this.text(sink, 'A SARDINE GROWS FROM THE SOIL', 250, 5);
    this.text(sink, '(C) KORONBA', 334, 5);
  }
}

/** The eye and the lens at which the glass of the room's CRT fills the frame: the 16:9 picture a hair under full, so no bezel enters the corners. */
export interface FillPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/**
 * `fit`: the share of the picture height that the frame shows at the fill pose (default 0.97, a hair under full, so that no bezel enters the corners;
 * 1 shows the picture exactly). `flat`: the glass is flat at that pose (`Home.setGlassCurve(0)`): the eye stands at the plane of the glass, not at the top of its bulge.
 */
export function crtFill(home: Home, fov = 42, fit = 0.97, flat = false): FillPose {
  home.root.updateMatrixWorld(true);
  const scr = home.root.getObjectByName('screen') as THREE.Mesh;
  scr.geometry.computeBoundingBox();
  const box = scr.geometry.boundingBox!.clone().applyMatrix4(scr.matrixWorld);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const h = size.z * (9 / 16) * fit, front = flat ? scr.localToWorld(new THREE.Vector3()).x : box.max.x;
  const d = h / 2 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  return { pos: new THREE.Vector3(front + d, c.y, c.z), look: c, fov };
}

/**
 * The lean-in: moves `cam` (already set by the head) a share `k` (0..1) of the way to the fill pose. `side`: the share of the way across
 * the glass (y, z) and of the turn to its middle. A `side` ahead of `k` puts the eye on the axis of the tube before it comes near the
 * glass, so the walls of the recess round the glass do not cut into the picture.
 */
export function pushToFill(cam: THREE.PerspectiveCamera, fill: FillPose, k: number, side = k) {
  if (k <= 0 && side <= 0) return;
  const dir = cam.getWorldDirection(new THREE.Vector3());
  const look0 = cam.position.clone().addScaledVector(dir, 2);
  const p = cam.position;
  p.set(THREE.MathUtils.lerp(p.x, fill.pos.x, k), THREE.MathUtils.lerp(p.y, fill.pos.y, side), THREE.MathUtils.lerp(p.z, fill.pos.z, side));
  cam.fov = THREE.MathUtils.lerp(cam.fov, fill.fov, k);
  cam.lookAt(look0.lerp(fill.look, side));
  cam.updateProjectionMatrix();
}

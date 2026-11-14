// The shared parts of the room kit (`_home.ts`): the room measures and the build context that the area builders use (`_homeCells.ts`,
// `_homeShell.ts`, `_homeTv.ts`, `_homeFurniture.ts`, `_homeBoxes.ts`, `_homeDecor.ts`, `_homeTown.ts`). Units are metres, y up.
import * as THREE from 'three';
import { Builder, litMesh, type Cell, type Face, type LitAtlas } from '@pve/engine/lit';
import type { PixelFont } from '@pve/engine/type';

/** The height of the floor (the top of the tatami). */
export const FL = 0.05;
export const X0 = -1.8, X1 = 1.8, Z0 = -1.35, Z1 = 1.35, CEIL = 2.4;
/** The door opening in the back wall. */
export const DX0 = 0.1, DX1 = 1.6, DTOP = 1.9;
/** The kotatsu centre and the seat. */
export const KX = -0.25, KZ = 0.1;
export const SEAT_X = 0.62;

/** One thing that goes away as the room is packed: hidden when the packed amount reaches `thr`. */
export interface Stage { thr: number; group: THREE.Group }

/** A box that is there from `thr` of the packing on. */
export interface PackBox { thr: number; mesh: THREE.Mesh }

/** A box in two states: shut and taped (the copy room), or open with flaps and things in it (the real room). Both stand where the packing box stands. */
export interface OpenBox { thr: number; closed: THREE.Mesh; open: THREE.Mesh }

/** The options of `RoomKit.put`. */
export interface PutOpts { stage?: number; cast?: boolean; receive?: boolean; y?: number; mat?: THREE.Material }

/**
 * The build context of the room: the atlas and its named cells, the material, the fonts, the root, and the packing stages. The area
 * builders call it in a fixed order, because the order of the atlas cells and of the meshes must not change.
 */
export class RoomKit {
  /** The named faces of the room (`_homeCells.ts` paints them). */
  readonly cells = {} as Record<string, Face>;
  readonly stages: Stage[] = [];
  private labels = new Map<string, Face>();

  constructor(
    readonly atlas: LitAtlas,
    readonly mat: THREE.MeshLambertMaterial,
    readonly kana: PixelFont,
    readonly latin: PixelFont,
    readonly root: THREE.Group,
  ) {}

  face(c: Cell, map?: 'tile' | 'fit'): Face { return { cell: c, map }; }
  solid(hex: string, emit = 0): Face { return { cell: this.atlas.solid(hex, emit) }; }

  /** A mesh in the root. `stage` (a packing threshold) puts it in a group that goes away when packed. */
  put(b: Builder, o: PutOpts = {}): THREE.Mesh {
    const m = litMesh(b, o.mat ?? this.mat, { cast: o.cast, receive: o.receive });
    const parent = o.stage === undefined ? this.root : this.stageGroup(o.stage);
    if (o.y) m.position.y = o.y;
    parent.add(m);
    return m;
  }

  private stageGroup(thr: number): THREE.Group {
    let s = this.stages.find((x) => x.thr === thr);
    if (!s) {
      s = { thr, group: new THREE.Group() };
      this.stages.push(s);
      this.root.add(s.group);
    }
    return s.group;
  }

  /** A cardboard front with a sticker and the label in kana, shaped for a face of w x h metres. */
  label(text: string, w: number, h: number): Face {
    const key = `${text}|${Math.round((h / w) * 10)}`;
    let f = this.labels.get(key);
    if (f) return f;
    const cw = Math.max(56, this.kana.width(text) + 16);
    const ch = Math.max(40, Math.round((cw * h) / w));
    f = {
      map: 'fit',
      cell: this.atlas.paint(cw, ch, (p) => {
        p.fill('#b48850'); p.speckle('#a67a44', 0.2, 9); p.speckle('#c29860', 0.12, 3);
        p.rect(Math.floor(cw / 2) - 4, ch - 9, 8, 9, '#d6bc80');
        p.rect(4, 4, cw - 8, ch - 16, '#e6e0d2');
        this.kana.draw(p.sink({ 1: '#26262c' }), text, Math.round((cw - this.kana.width(text)) / 2), Math.round(4 + (ch - 16) / 2 + 6 + 0), 1);
      }),
    };
    this.labels.set(key, f);
    return f;
  }
}

// The player's room in the lit look (treatment "One room", "Look"): six tatami (3.6 x 2.7 m), a Japanese flat on the
// night before the move. The back wall (-z) has the wall calendar, the sign and the sliding glass door to a small
// balcony with a planter; the CRT stands on a cabinet against the left wall (-x); the kotatsu is in the middle and
// the futon lies along the right wall (+x). Beyond the balcony there is a small town and hills.
//
// The kit has no scene logic. The scene sets the state with the small setters below, renders `root` with `fog`,
// and gives `sky` to `LitView.render`. Units are metres, y up. The floor is at y = 0.05 (the top of the tatami).
// The areas of the room are built in their own modules (`_homeCells.ts` .. `_homeTown.ts`); `Home` calls them in a fixed order.
import * as THREE from 'three';
import { ambient, col, litMaterial, point, screenMaterial, sun, v3, type Cell, type LitAtlas, type Painter } from '@pve/engine/lit';
import type { Sky } from '@pve/engine/litview';
import type { PixelFont } from '@pve/engine/type';
import { FL, KX, KZ, SEAT_X, Z0, RoomKit, type OpenBox, type PackBox } from './_homeKit';
import { hourKey } from './_homeHour';
import { paintRoomCells } from './_homeCells';
import { buildDoorAndBalcony, buildShell } from './_homeShell';
import { buildTv } from './_homeTv';
import { buildFurniture } from './_homeFurniture';
import { buildBoxes, makeTapeBox, type TapeBox } from './_homeBoxes';
import { buildBare, buildPages, buildWallDecor } from './_homeDecor';
import { buildTown } from './_homeTown';

/** A camera place: where it stands, what it looks at, and a fitting field of view (vertical, degrees). */
export interface Anchor { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/**
 * The room. `root` holds everything, `lights` are already in `root`. The scene sets `scene.fog = home.fog`, renders
 * with `home.sky`, and calls the setters (they are cheap and idempotent). Nothing in the kit moves by itself.
 */
export class Home {
  readonly root = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  /** The haze of the town. Assign it to the scene; `setHour` keeps its colour. */
  readonly fog = new THREE.FogExp2(0x000000, 0.0068);
  /** The sky of the hour, for `LitView.render`. `setHour` updates it. */
  sky: Sky = { zenith: 0, horizon: 0, ground: 0 };

  readonly anchors: { kotatsu: Anchor; bed: Anchor; door: Anchor; tv: Anchor; planter: Anchor };
  /** The planter: the centre of the soil surface, its length along x, its depth along z. Sardines grow from here. */
  readonly planter = { top: v3(0.9, 0.47, -2.1), length: 1.4, depth: 0.22 };
  /** The gap between the balcony slab and the landing of the outside stairs (x from `x0` to `x1`, the middle line of the balcony at z, the floor at y). The duckboard lies in it. */
  readonly gap = { x0: -0.8, x1: -0.2, z: Z0 - 0.475, y: FL };
  /** The calendar picture: its atlas cell (92 x 60 texels, y up) and a way to paint over it. */
  readonly calendar: { cell: Cell; repaint(fn: (p: Painter) => void): void };
  /** The cream sign on the back wall (`あしたのことは しっている`), over the calendar. Its x is the middle of the sign. */
  readonly sign: THREE.Mesh;

  private readonly kit: RoomKit;
  private readonly townMat: THREE.MeshLambertMaterial;

  private readonly screenMesh: THREE.Mesh;
  private readonly screenOn: THREE.MeshBasicMaterial;
  private readonly screenOff = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(0.012, 0.014, 0.016), flatShading: true });
  private readonly screenLight: THREE.PointLight;
  private readonly lamp: THREE.PointLight;
  private readonly lampOn: THREE.Mesh;
  private readonly lampOff: THREE.Mesh;
  private readonly tableThings: THREE.Mesh;
  private readonly laundry: THREE.Mesh;
  private readonly curtains: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly sunTarget = new THREE.Object3D();
  private readonly winGroups: THREE.Mesh[];
  private readonly town = new THREE.Group();
  private readonly packBoxes: PackBox[] = [];
  private readonly openBoxes: OpenBox[] = [];
  private readonly openGroup = new THREE.Group();
  private boxesOpen = false;
  private boxMode: ('open' | 'closed' | 'hidden' | null)[] = [null, null];
  private readonly pagesMesh: THREE.Mesh;
  private readonly bare: THREE.Mesh;
  private bareOn = false;
  private packed = 0;
  private winLit = 0;
  private readonly tvGroup = new THREE.Group();

  constructor(atlas: LitAtlas, mat: THREE.MeshLambertMaterial, kana: PixelFont, latin: PixelFont) {
    this.townMat = litMaterial(atlas, { tint: '#ffffff' });
    const kit = (this.kit = new RoomKit(atlas, mat, kana, latin, this.root));

    // the areas, in the order that fixes the atlas cells and the mesh ids
    paintRoomCells(kit);
    ({ lampOn: this.lampOn, lampOff: this.lampOff } = buildShell(kit));
    ({ laundry: this.laundry, curtains: this.curtains } = buildDoorAndBalcony(kit, this.planter, this.gap));
    buildTv(kit, this.tvGroup, this.screenOff);
    this.tableThings = buildFurniture(kit);
    buildBoxes(kit, this.packBoxes, this.openBoxes, this.openGroup);
    this.sign = buildWallDecor(kit);
    this.bare = buildBare(kit);
    this.pagesMesh = buildPages(kit);
    this.winGroups = buildTown(kit, this.townMat, this.town);

    // lights: the day, the ambient, the ceiling lamp, the CRT
    this.hemi = ambient('#2a3566', '#14161c', 0.22);
    this.sunLight = sun('#9fb4ff', 0.45, 4.2);
    this.sunTarget.position.set(0.4, 0.8, -0.3);
    this.sunLight.target = this.sunTarget;
    this.lamp = point('#ffe0a8', 0, 7, true);
    this.lamp.position.set(0, 2.25, 0.1);
    this.lamp.shadow.camera.near = 0.05;
    this.screenLight = point('#c8d0ff', 0, 7, true);
    this.screenLight.position.set(0, 0.78, 0.65);
    this.screenLight.shadow.camera.near = 0.05;
    this.tvGroup.add(this.screenLight);
    this.root.add(this.hemi, this.sunLight, this.sunTarget, this.lamp);
    this.lights.push(this.hemi, this.sunLight, this.lamp, this.screenLight);

    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
    this.screenOn = screenMaterial(blank, 1.4);
    // the glass is a lamp: the room's fog does not tint it (the push into it ends on the exact picture)
    this.screenOn.fog = false;
    this.screenMesh = this.tvGroup.getObjectByName('screen') as THREE.Mesh;
    this.screenMesh.material = this.screenOff;

    const paddy = kit.cells.paddy!.cell;
    this.calendar = {
      cell: paddy,
      repaint: (fn) => atlas.repaint(paddy, fn),
    };
    const T = (x: number, y: number, z: number) => v3(x, y, z);
    this.anchors = {
      kotatsu: { pos: T(SEAT_X, FL + 0.9, KZ), look: T(-1.35, 0.76, KZ), fov: 46 },
      bed: { pos: T(1.3, FL + 0.34, 0.85), look: T(1.0, 1.05, -1.7), fov: 60 },
      door: { pos: T(0.8, 1.5, -0.3), look: T(0.5, 1.3, -4), fov: 55 },
      tv: { pos: T(-0.05, 0.9, KZ), look: T(-1.36, 0.66, KZ), fov: 42 },
      planter: { pos: T(0.9, 1.25, -0.9), look: T(0.95, 0.5, -2.1), fov: 45 },
    };

    this.setHour(21);
    this.setLamp(0);
    this.setScreen(null);
    this.setScreenLight('#c8d0ff', 0);
    this.setPacked(0);
    this.setPages(0);
  }

  // ------------------------------------------------------------ state

  /**
   * The screen: a texture (a `LitView.toScreen` picture or any colour texture) shown as light, `strength` times its
   * value, or null for dark grey glass.
   */
  setScreen(tex: THREE.Texture | null, strength = 1.4) {
    if (!tex) { this.screenMesh.material = this.screenOff; return; }
    this.screenOn.map = tex;
    this.screenOn.color.setScalar(strength);
    this.screenMesh.material = this.screenOn;
  }

  /** The bulge of the glass, 1 (the curved patch of the set) to 0 (flat). The push into the CRT flattens it as the screen fills the frame. */
  setGlassCurve(k: number) {
    this.screenMesh.scale.z = k;
  }

  /** The light of the screen in the room: its colour and strength in candela (about 8 reads as a bright CRT at 2 m). */
  setScreenLight(hex: string | number, strength: number) {
    this.screenLight.color.copy(col(hex));
    this.screenLight.intensity = strength;
  }

  /** The round ceiling lamp: 0 off, 1 on (its light, in candela, is 20 times k). */
  setLamp(k: number) {
    this.lamp.intensity = Math.max(0, k) * 20;
    this.lampOn.visible = k > 0;
    this.lampOff.visible = k <= 0;
  }

  /** The glow of the lit lamp shade (emissive strength, 5 by default). It repaints the atlas: call it once, not on each frame. */
  setLampGlow(e: number) {
    this.kit.atlas.repaint(this.kit.cells.lampOn!.cell, (p) => p.fill('#fff2c8', e));
  }

  /**
   * The hour 0..24 outside: the sky (`sky`), the haze (`fog`), the sun or the moon through the door, the ambient,
   * and how many house windows are lit. Evening is 17..20, night 21..4, grey dawn 5.5..7.
   */
  setHour(hour: number) {
    const k = hourKey(hour);
    this.sky = {
      zenith: k.zen, horizon: k.hor, ground: k.gnd, stars: k.stars,
    };
    const el = THREE.MathUtils.degToRad(k.el), az = THREE.MathUtils.degToRad(k.az);
    const dir = v3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.sunLight.position.copy(this.sunTarget.position).addScaledVector(dir, 12);
    this.sunLight.color.copy(col(k.sun));
    this.sunLight.intensity = k.sunI * 1.6;
    if (k.el > 0) this.sky.body = { dir, r: 0.03, colour: k.sun, strength: 2 + k.sunI * 1.5, glow: 2.5 };
    this.hemi.color.copy(col(k.hemiSky));
    this.hemi.groundColor.copy(col(k.hemiGnd));
    this.hemi.intensity = k.hemiI * 2.2;
    this.fog.color.copy(col(k.hor));
    this.townMat.color.setScalar(k.town);
    this.winLit = k.win;
    this.setWindowsLit(0);
  }

  /** The laundry on the balcony pole: hung (default) or taken in (the copy room is packed for the move, and CAM 02 looks past the pole). */
  setLaundry(on: boolean) { this.laundry.visible = on; }

  /** Lights the town window groups of `mask` (bit i: group i of 8) on top of the groups that the hour lights (music: a note lights a group). */
  setWindowsLit(mask: number) {
    const n = this.winGroups.length;
    this.winGroups.forEach((m, i) => { m.visible = i / n < this.winLit || ((mask >> i) & 1) === 1; });
  }

  /** Shows the town of the kit (the ground, the street, the houses, the poles, the hills). Off: a scene draws its own world behind the room. */
  setTown(on: boolean) {
    this.town.visible = on;
  }

  /** 0 lived-in (kotatsu, futon, calendar, a few boxes) .. 1 empty (only the boxes, the CRT and the cabinet). */
  setPacked(k: number) {
    this.packed = k;
    for (const s of this.kit.stages) s.group.visible = k < s.thr && !this.bareOn;
    for (const b of this.packBoxes) b.mesh.visible = k >= b.thr && !this.bareOn;
    this.openBoxes.forEach((o, i) => {
      const on = k >= o.thr && !this.bareOn;
      const mode = this.boxMode[i] ?? (this.boxesOpen ? 'open' : 'closed');
      o.closed.visible = on && mode === 'closed';
      o.open.visible = on && mode === 'open';
    });
  }

  /** The things on the kotatsu (the mandarins, the mug, the remote, the tissues) stand `dy` metres over the table top: a knock on the table makes them jump. */
  setTableJolt(dy: number) {
    this.tableThings.position.y = FL + dy;
  }

  /** The room the morning after (see `buildBare`): the stages and the packing boxes are hidden, the bare layer shows. */
  setBare(on: boolean) {
    this.bareOn = on;
    this.bare.visible = on;
    this.setPacked(this.packed);
  }

  /**
   * The two boxes beside the CRT (`だいどころ`, `ふく`): open (true, the real room: flaps up, things showing) or shut and taped (false, the default,
   * the copy room). The rest of the room does not change.
   */
  setBoxesOpen(on: boolean) {
    this.boxesOpen = on;
    this.setPacked(this.packed);
  }

  /** The curtains of the balcony door: drawn open on a rod (default) or taken down. */
  setCurtains(on: boolean) { this.curtains.visible = on; }

  /** n pages torn off the day calendar lie in a pile under it (0..31). They stack up in the same seeded order. */
  setPages(n: number) {
    this.pagesMesh.geometry.setDrawRange(0, Math.max(0, Math.min(31, Math.round(n))) * 6);
  }

  /**
   * Overrides the state of one of the two boxes beside the CRT (0 `だいどころ`, 1 `ふく`): `open`, `closed` (taped), `hidden` (a `makeTapeBox` stands
   * there instead) or `null` for what `setBoxesOpen` says.
   */
  setBoxMode(k: 0 | 1, mode: 'open' | 'closed' | 'hidden' | null) {
    this.boxMode[k] = mode;
    this.setPacked(this.packed);
  }

  /**
   * One of the two boxes beside the CRT (2 `だいどころ`, 3 `ふく`) as a box that gets taped shut (see `_homeBoxes.ts`). Hide the box meshes of
   * the same box with `setBoxMode(i - 2, 'hidden')`.
   */
  makeTapeBox(i: 2 | 3): TapeBox {
    return makeTapeBox(this.kit, i);
  }

  dispose() {
    this.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.screenOff.dispose();
    this.screenOn.dispose();
    this.townMat.dispose();
  }
}

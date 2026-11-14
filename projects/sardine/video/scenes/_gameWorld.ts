// The one game world of sardine (treatment v8 "The game world"). Every game scene builds this module and takes its
// geometry from it: the stem, the loop, the five stations, the town, the mountain with the tunnel and the train.
// The route (the stem, the loop, the stations on them, the twisted route) is in `_route.ts`.
//
// The world has states, not copies (`WorldState`). The bend of verse 1 is a wind: the straight track ahead of C winds
// onto the circle like a rope onto a drum. The wound part lies on the loop, the rest stands straight on the tangent at
// the winding point. The stem never moves.
//
// The module has no scene logic and no time: a scene gives it a state and a route position for the train.
import * as THREE from 'three';
import { mulberry32, hashSin, smooth } from '@pve/engine/util';
import { Builder, LitAtlas, allFaces, ambient, at, instanced, litMaterial, litMesh, setLitLod, sun, v3, type BoxFaces, type Face } from '@pve/engine/lit';
import { buildTrack, trackFaces, type TrackFaces } from '@pve/engine/track';
import { Train, carJoint, poseCarJoint } from './_train';
import { GROUND_Y, Station } from './_station';
import type { Fonts } from './_fonts';
import { speckled } from './_paint';
import {
  ArcCurve, BITE, CAR_PITCH, LOOP_C, LOOP_LEN, LOOP_R, RouteCurve, SEG, STATIONS, STATION_IDS, STEM_X0, TUNNEL, WIND_STEPS,
  c3Exit, carPose, loopAt, routePoint, twist, twistLap, type StationId,
} from './_route';

/**
 * The player's house: the middle of its footprint. The balcony is on the +z side, over the street. The house has the measures of the
 * room kit (`_home.ts`): the floor of the room 5.5 m over the street, the balcony door 8.65 m from the middle of the street. The cams
 * of the copy room (`day.ts`) look out of the room into this world.
 */
export const HOUSE = new THREE.Vector3(-8, 0, 18.85);
/** The floor of the room of the house (the upper storey) and the z of the balcony door. */
export const HOUSE_FLOOR = 5.05;
export const HOUSE_DOOR_Z = HOUSE.z + 3.5;
/** The street of the town: its centre line (z) and its width. */
export const STREET = { z: 31, w: 5 } as const;
/** The ground that the game zones and that the sinkhole opens (chorus 1b): a square inside the loop. The world leaves it empty. */
export const PIT = { x: 35, z: -142, half: 50 } as const;
/** The scale of the houses of the town in a map view and in a view that stands in the world (the player's house keeps its size in both). */
export const MAP_HOUSE = 1, CLOSE_HOUSE = 1.5;

/** The light colours of a map view at dusk and at night (`GameWorld.light`). */
const DUSK = { sun: new THREE.Color('#ffa860'), sky: new THREE.Color('#9a88b8'), ground: new THREE.Color('#4a3a40') };
const NIGHT = { sun: new THREE.Color('#9fb4ff'), sky: new THREE.Color('#7a90e8'), ground: new THREE.Color('#3a4a74') };

/** What the track shows at one moment. */
export interface WorldState {
  /** The scissors have cut the rail before C: `BITE` metres of it are gone. */
  cut: boolean;
  /** 0..1: how much of the track ahead of C is wound onto the loop. At 1 its far end stands on C. */
  wind: number;
  /** The track ahead of C is a ghost in the bend tool's hand (it glows and carries no train). */
  ghost: boolean;
  /** The loop is joined to the stem: the cut rail is whole again, the stations of the loop stand. */
  joined: boolean;
}

const STRAIGHT: WorldState = { cut: false, wind: 0, ghost: false, joined: false };
export const LOOPED: WorldState = { cut: false, wind: 1, ghost: false, joined: true };

export interface WorldOpts {
  /** The stations whose lamps are real lights (a close view stands there). The others only glow. */
  lit?: StationId[];
  /** Atlas size. Default 2048. */
  atlas?: number;
  /** Build the wires of the pole line of the loop. Default true. A scene that moves the wires builds its own on `spans`. */
  loopWires?: boolean;
}

const rail = (x0: number, x1: number) => new THREE.LineCurve3(v3(x0, 0, 0), v3(x1, 0, 0));

/** The pieces of the stem that the reread moves: `STEM_PIECES` straight pieces of `SEG` metres. */
const STEM_PIECES = 16;

/** The state of the stem in the interlude. `k` 0..1: its pieces between where they were saved (0) and the crossing (1). `jitter` 0..1: how far a bad read throws them about. */
export interface Reread { k: number; jitter: number; seed: number }

/** A house of the town: the middle of the plan, its size (x by z), the wall height and the rise of the roof (its ridge runs along z). */
export interface TownHouse { x: number; z: number; w: number; d: number; h: number; rise: number }
/** A lit window of a house: the middle of the pane and the side that it faces (the sign of z). */
export interface TownWindow { x: number; y: number; z: number; face: number }

export class GameWorld {
  readonly scene = new THREE.Scene();
  readonly atlas: LitAtlas;
  readonly mat: THREE.MeshLambertMaterial;
  /** The material of the ground and the fields: its cells are mipmapped (seen from far, their fine pattern would beat into moire). */
  readonly groundMat: THREE.MeshLambertMaterial;
  /** The two cars: the front car (the sardine rides in it) and the rear car. */
  readonly cars: [Train, Train];
  /** The gangway and the coupler between the two cars: it follows them. */
  readonly joint: THREE.Object3D;
  readonly stations = {} as Record<StationId, Station>;
  /** The far hills and treeline: a close view shows them, a map view does not. */
  readonly far = new THREE.Group();
  /** The ground of `PIT`: one slab. A scene that opens the ground hides it and puts its own pieces there. */
  readonly pitGround: THREE.Mesh;
  /** The houses of the town and the country. */
  readonly houses: TownHouse[] = [];
  /** The lit windows of the houses. */
  readonly windows: TownWindow[] = [];
  /** The lamps of the pole line of the loop. */
  readonly lamps: THREE.Vector3[] = [];
  /** The spans of the pole line of the loop: the feet of the two poles of each. */
  readonly spans: { a: THREE.Vector3; c: THREE.Vector3 }[] = [];
  /** The player's house. A scene that shows the room kit in its place hides it. */
  playerHouse: THREE.Mesh;
  readonly sun = sun('#ffa860', 2.2, 90);
  private hemi = ambient('#8a7aa8', '#3a2a30', 0.9);
  /** The fog of the world. A scene that draws the world inside its own scene sets it as the fog of that scene. */
  readonly fog = new THREE.FogExp2(0x000000, 0);
  private ghostMat: THREE.MeshLambertMaterial;
  /** The painted faces of the track (a scene that builds loose track parts uses them). */
  readonly faces: TrackFaces;
  private bite!: THREE.Mesh;
  private wound!: THREE.InstancedMesh;
  private rest!: THREE.InstancedMesh;
  private sunk = new Float32Array(WIND_STEPS);
  private restRoot = new THREE.Group();
  private loopDeco = new THREE.Group();
  /** The stem with its poles and Station イワシ: the piece that the reread puts back wrong. */
  private stemRoot = new THREE.Group();
  private twistRoot: THREE.Group | null = null;
  /** The track of the crossing (after `buildTwist`): one mesh. */
  crossTrack: THREE.Mesh | null = null;
  private pieces: THREE.InstancedMesh | null = null;
  /** The town at the size of the map views and at the size of the close views, and the far map town (`buildTown`). */
  private town: TownMeshes;
  /** The near and the far trees, for a far map (`mapLod`). */
  private trees: { near: THREE.Mesh; far: THREE.Mesh };
  /** The pole lines, for a far map (`mapLod`). */
  private poles: THREE.Mesh[] = [];

  constructor(private fonts: Fonts, opts: WorldOpts = {}) {
    this.atlas = new LitAtlas(opts.atlas ?? 2048);
    this.mat = litMaterial(this.atlas);
    this.groundMat = litMaterial(this.atlas, { mips: true });
    // PCF over a wider kernel: the edge of a moving shadow (the train coming in) is soft, not a row of texel steps
    this.sun.shadow.radius = 2.5;
    this.ghostMat = litMaterial(this.atlas, { tint: '#9ae4ff' });
    this.ghostMat.emissive.set('#1c7ab0');
    // the track is drawn with the ground material: its gravel beats into moire from far as the grass does
    this.faces = trackFaces(this.atlas);
    for (const f of [this.faces.rail, this.faces.sleeper, this.faces.ballast]) this.atlas.mipmap(f.cell);
    this.scene.fog = this.fog;
    this.town = buildTown(this.atlas, this.mat, this.scene, this.houses, this.windows);
    const ground = buildGround(this.atlas, this.mat, this.groundMat, this.scene, this.houses);
    this.pitGround = ground.pit;
    this.trees = ground.trees;
    this.playerHouse = buildPlayerHouse(this.atlas, this.mat);
    this.scene.add(this.playerHouse);
    this.scene.add(buildMountain(this.atlas, this.groundMat));
    this.far.add(buildFar(this.atlas, this.mat));
    this.scene.add(this.far);
    this.buildRails();
    this.buildStations(opts.lit ?? []);
    this.buildPoles(opts.loopWires !== false);
    this.scene.add(this.loopDeco);
    this.cars = [new Train(this.atlas, this.mat), new Train(this.atlas, this.mat)];
    // the rear car carries no lights of its own (its strips glow): the light count of the scene stays low
    for (const l of this.cars[1].lights) l.parent?.remove(l);
    this.cars[0].setHeadlights(1);
    this.scene.add(this.cars[0].root, this.cars[1].root);
    this.joint = this.buildJoint();
    this.scene.add(this.joint);
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.pose(STRAIGHT);
    this.placeTrain(STATIONS.iwashi.s - 9, false);
  }

  // ---------------------------------------------------------------- build

  /** The stem, the rail the scissors take out, and the track ahead of C in `WIND_STEPS` pieces: wound ones on the loop, the rest straight. */
  private buildRails() {
    const A = this.atlas;
    const track = (c: THREE.Curve<THREE.Vector3>) => buildTrack(A, c, { faces: this.faces, step: 2, sleeperGap: 0.8 });
    this.stemRoot.add(litMesh(track(rail(STEM_X0, -BITE)), this.groundMat, { cast: false }));
    this.bite = litMesh(track(rail(-BITE, 0)), this.groundMat, { cast: false });
    this.stemRoot.add(this.bite);
    this.scene.add(this.stemRoot);
    const inst = (g: THREE.BufferGeometry) => {
      const m = instanced(g, this.groundMat, WIND_STEPS);
      m.receiveShadow = true;
      return m;
    };
    this.wound = inst(track(new ArcCurve(0, SEG / LOOP_R)).geometry());
    this.rest = inst(track(rail(0, SEG)).geometry());
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < WIND_STEPS; k++) {
      this.wound.setMatrixAt(k, m4.makeRotationY((k * SEG) / LOOP_R));
      this.rest.setMatrixAt(k, m4.makeTranslation(k * SEG, 0, 0));
    }
    this.wound.position.set(LOOP_C.x, 0, LOOP_C.z);
    this.restRoot.add(this.rest);
    this.scene.add(this.wound, this.restRoot);
  }

  /**
   * The gangway and the coupler between the two cars. It comes after the cars in the scene, so their world matrices are those of this
   * frame when it takes its place between them: a scene places the cars as it likes and the joint follows.
   */
  private buildJoint(): THREE.Object3D {
    const joint = carJoint(this.atlas, this.mat);
    joint.updateMatrixWorld = () => {
      const [a, b] = this.cars;
      joint.visible = a.root.visible && b.root.visible && poseCarJoint(joint, a.root.matrixWorld, b.root.matrixWorld);
    };
    return joint;
  }

  private buildStations(lit: StationId[]) {
    for (const id of STATION_IDS) {
      // a station of the loop has no lamp at its near end: a platform camera stands there
      const st = new Station(this.atlas, this.mat, this.fonts.kana, { name: STATIONS[id].name, ...(id === 'iwashi' ? {} : { lamps: [1.5, 13.5] }) });
      const p = routePoint(STATIONS[id].s);
      st.root.position.set(p.x, 0, p.z);
      st.root.rotation.y = p.yaw;
      // a station that no close view stands at keeps its glow and gives up its lights
      if (!lit.includes(id)) for (const l of st.lights) { l.parent?.remove(l); if (l instanceof THREE.SpotLight) l.target.parent?.remove(l.target); }
      this.stations[id] = st;
      (id === 'iwashi' ? this.stemRoot : this.loopDeco).add(st.root);
    }
  }

  /** The pole line: along the stem on its north side, and round the loop on its inner side (it stands with the loop). */
  private buildPoles(loopWires: boolean) {
    const A = this.atlas;
    const faces: PoleFaces = { wood: { cell: A.solid('#4a3a2a') }, wire: { cell: A.solid('#1a1a22') }, lamp: { cell: A.paint(1, 1, (p) => p.fill('#ffdca0', 4)) } };
    const stem = new Builder();
    const sp: THREE.Vector3[] = [];
    for (let x = STEM_X0 + 10; x <= -14; x += 28) sp.push(v3(x, 0, -4.2));
    poleLine(stem, sp, sp.map(() => 0), sp.map(() => 0), faces, null);
    const loop = new Builder();
    const lp: THREE.Vector3[] = [], ly: number[] = [];
    const N = 22;
    for (let k = 0; k < N; k++) {
      const a = ((k + 0.5) / N) * Math.PI * 2, s = a * LOOP_R;
      if (s > TUNNEL.s0 - 8 && s < TUNNEL.s1 + 8) continue;
      lp.push(v3(LOOP_C.x + (LOOP_R - 4.2) * Math.sin(a), 0, LOOP_C.z + (LOOP_R - 4.2) * Math.cos(a)));
      ly.push(a);
    }
    // the crossing runs under two spans of the loop line, 2 m over the ground at the poles and higher inside the loop: the poles of
    // those spans are taller (`POLE_LIFT`), so that their wires pass about 3 m over the roof of a car
    const lift = lp.map(() => 0);
    lp.forEach((a, k) => {
      const c = lp[(k + 1) % lp.length]!;
      if (KEEP.cross.some((p, i) => i > 0 && crosses(a, c, KEEP.cross[i - 1]!, p))) { lift[k] = POLE_LIFT; lift[(k + 1) % lp.length] = POLE_LIFT; }
    });
    poleLine(loop, lp, ly, lift, faces, { lamps: this.lamps, spans: this.spans, wires: loopWires });
    // the stem line ends on the last pole of the loop before C: its wires run on into the loop line
    wireSpan(stem, sp[sp.length - 1]!, lp[lp.length - 1]!, 0, lift[lp.length - 1]!, faces);
    const stemPoles = litMesh(stem, this.mat, { cast: false });
    this.stemRoot.add(stemPoles);
    const loopPoles = litMesh(loop, this.mat, { cast: false });
    this.loopDeco.add(loopPoles);
    this.poles = [stemPoles, loopPoles];
  }

  /**
   * Shows the town as it loads from the map size to the close size: `load(i)` 0..1 for house i of `houses` (0 its map size, 1 its close
   * size). Each house grows about the middle of its plan on the ground. Call it after `light`: it shows the town of the load in place of
   * the town of the view.
   */
  loadTown(load: (i: number) => number) {
    const T = this.town;
    const pos = T.morph.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array, b = T.base, k0 = MAP_HOUSE / CLOSE_HOUSE, y0 = GROUND_Y;
    T.span.forEach(([v0, v1], i) => {
      const h = this.houses[i]!, s = k0 + (1 - k0) * Math.min(1, Math.max(0, load(i)));
      for (let v = v0 * 3; v < v1 * 3; v += 3) {
        a[v] = h.x + (b[v]! - h.x) * s;
        a[v + 1] = y0 + (b[v + 1]! - y0) * s;
        a[v + 2] = h.z + (b[v + 2]! - h.z) * s;
      }
    });
    pos.needsUpdate = true;
    T.map.visible = false;
    T.close.visible = false;
    T.morph.visible = true;
  }

  // ---------------------------------------------------------------- pose

  /** Poses the track for `st`. */
  pose(st: WorldState) {
    const n = Math.round(Math.min(1, Math.max(0, st.wind)) * WIND_STEPS);
    this.bite.visible = !st.cut;
    this.wound.count = n;
    this.rest.count = WIND_STEPS - n;
    const p = loopAt((n * SEG) / LOOP_R);
    this.restRoot.position.set(p.x, 0, p.z);
    this.restRoot.rotation.y = p.yaw;
    const mat = st.ghost ? this.ghostMat : this.groundMat;
    this.wound.material = mat;
    this.rest.material = mat;
    this.loopDeco.visible = st.joined;
  }

  /** The middle of each piece of the loop track (x, z) and its place on the route (`s`). */
  loopPieces(): { x: number; z: number; s: number }[] {
    return Array.from({ length: WIND_STEPS }, (_, k) => { const s = (k + 0.5) * SEG, p = loopAt(s / LOOP_R); return { x: p.x, z: p.z, s }; });
  }

  /** Sinks pieces of the loop track: piece k is `depth[k]` metres under its place (0: in place). Call it after `pose`. */
  sinkLoop(depth: readonly number[]) {
    const m4 = new THREE.Matrix4();
    let dirty = false;
    for (let k = 0; k < WIND_STEPS; k++) {
      const d = depth[k]!;
      if (d === this.sunk[k]) continue;
      this.sunk[k] = d;
      this.wound.setMatrixAt(k, m4.makeRotationY((k * SEG) / LOOP_R).setPosition(0, -d, 0));
      dirty = true;
    }
    if (dirty) this.wound.instanceMatrix.needsUpdate = true;
  }

  /** Puts the train on the route: the middle of the front car at `s`, the rear car one car pitch behind it. */
  placeTrain(s: number, looped: boolean) {
    this.cars.forEach((car, k) => {
      car.root.matrixAutoUpdate = true;
      const c = carPose(s - k * CAR_PITCH, looped);
      car.root.position.set(c.x, 0, c.z);
      car.root.rotation.y = c.yaw;
    });
  }

  /**
   * The light of one view of the world. `map`: the bright, even light of the game's map. `close`: the light of a camera that stands in the world.
   * `night`: 0 dusk .. 1 night, or `'day'` (the bright day of chorus 1b; `dim` 0..1 takes the day's light away, as the hole of line 12 does).
   * `focus`: where the sun's shadow looks. `half`: the shadow map covers a square of this many metres round the focus (a view that stands
   * close to its subject asks for less: the edge of a shadow has no steps). The shadow map moves with the focus in steps of one of its texels,
   * so a moving focus does not make the edges of the shadows crawl. Call it before each render of the scene.
   */
  light(view: 'map' | 'close', night: number | 'day', focus: THREE.Vector3, dim = 0, half = 90) {
    this.far.visible = view === 'close';
    this.town.map.visible = view === 'map';
    this.town.close.visible = view === 'close';
    this.town.morph.visible = false;
    const sc = this.sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    if (night === 'day') this.lightDay(view === 'map', focus, dim, half);
    else if (view === 'map') this.lightMapNight(Math.min(1, Math.max(0, night)), focus, half);
    else this.lightCloseNight(focus, half);
  }

  /** The day of `light`. */
  private lightDay(map: boolean, focus: THREE.Vector3, dim: number, half: number) {
    const L = THREE.MathUtils.lerp;
    this.sun.color.set(map ? '#fff2d6' : '#ffe2b4');
    this.sun.intensity = L(map ? 2.6 : 3.0, 0.35, dim);
    this.aimSun(focus, -60, 95, 70, half);
    this.hemi.intensity = L(map ? 1.1 : 0.75, 0.25, dim);
    this.hemi.color.set(map ? '#b8ccf0' : '#a8b8e8');
    this.hemi.groundColor.set(map ? '#5a7048' : '#6a7a50');
    this.fog.color.setRGB(0.45, 0.62, 0.92);
    this.fog.density = map ? 0 : 0.0014;
  }

  /** The dusk (`k` 0) to night (`k` 1) of a map view of `light`. The colours blend, and the night is darker than the dusk. */
  private lightMapNight(k: number, focus: THREE.Vector3, half: number) {
    const L = THREE.MathUtils.lerp;
    this.sun.color.lerpColors(DUSK.sun, NIGHT.sun, k);
    this.sun.intensity = L(3.0, 1.6, k);
    const el = L(0.42, 1.05, k);
    this.aimSun(focus, -80 * Math.cos(el) * 0.6, 80 * Math.sin(el), 80 * Math.cos(el) * 0.8, half);
    this.hemi.intensity = L(1.5, 1.1, k);
    this.hemi.color.lerpColors(DUSK.sky, NIGHT.sky, k);
    this.hemi.groundColor.lerpColors(DUSK.ground, NIGHT.ground, k);
    this.fog.density = 0;
  }

  /** The night of a close view of `light`. */
  private lightCloseNight(focus: THREE.Vector3, half: number) {
    this.sun.color.set('#8ea4e8');
    this.sun.intensity = 0.45;
    this.aimSun(focus, 30, 60, -80, half);
    this.hemi.intensity = 0.7;
    this.hemi.color.set('#2a3666');
    this.hemi.groundColor.set('#121812');
    this.fog.color.setRGB(0.012, 0.016, 0.04);
    this.fog.density = 0.0022;
  }

  /**
   * The day light between the map's (`u` 0) and the close view's (`u` 1), for a camera that goes down from the map into the world. The haze
   * comes in late (`u` cubed): from far off it would hide the world. The far hills show from `u` > 0. The town is that of the close view:
   * call `loadTown` after it for a town that loads.
   */
  lightLoad(u: number, focus: THREE.Vector3, half = 90) {
    this.light('close', 'day', focus, 0, half);
    const L = THREE.MathUtils.lerp, c = (a: string, b: string, out: THREE.Color) => out.set(a).lerp(new THREE.Color(b), u);
    c('#fff2d6', '#ffe2b4', this.sun.color);
    this.sun.intensity = L(2.6, 3.0, u);
    this.hemi.intensity = L(1.1, 0.75, u);
    c('#b8ccf0', '#a8b8e8', this.hemi.color);
    c('#5a7048', '#6a7a50', this.hemi.groundColor);
    this.fog.density = 0.0014 * u ** 3;
    this.far.visible = u > 0;
  }

  /**
   * The level of detail of a far map (the mini map, well under 1 px a metre). `true` before its draw: every lit surface of the world
   * takes the plain colour of its cell (`LitAtlas.flat`), the map town is drawn as walls and roofs only, the trees as one cone each, and
   * the pole lines are left out. Call it after `light('map', ...)`, and with `false` after the draw.
   */
  mapLod(far: boolean) {
    setLitLod(this.mat, far);
    setLitLod(this.groundMat, far);
    this.trees.near.visible = !far;
    this.trees.far.visible = far;
    this.town.map.visible = !far;
    this.town.far.visible = far;
    for (const p of this.poles) p.visible = !far;
  }

  /** Puts the sun at `focus` + (ox, oy, oz), looking at `focus` moved to the nearest texel of its shadow map (light space right and up). */
  private aimSun(focus: THREE.Vector3, ox: number, oy: number, oz: number, half: number) {
    const dir = v3(ox, oy, oz).normalize();
    const right = v3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right);
    const texel = (2 * half) / this.sun.shadow.mapSize.x;
    const r = focus.dot(right), u = focus.dot(up);
    const f = focus.clone().addScaledVector(right, Math.round(r / texel) * texel - r).addScaledVector(up, Math.round(u / texel) * texel - u);
    this.sun.target.position.copy(f);
    this.sun.position.set(f.x + ox, f.y + oy, f.z + oz);
  }

  /** Scales the light and the fog that `light` has set (call it after `light`): the light rig of another scene takes over from this one. */
  lightScale(k: number) {
    this.sun.intensity *= k;
    this.hemi.intensity *= k;
    this.fog.density *= k;
  }

  /** The lamps of every station: on at night. It repaints atlas cells, so call it once for a scene (or on a change), not for each view. */
  setLamps(on: boolean) {
    for (const id of STATION_IDS) this.stations[id].setNight(on);
  }

  // ---------------------------------------------------------------- the twist

  /**
   * Builds the parts of the twisted state (the interlude and verse 2 use them): the crossing on its pillars and the loose pieces of the reread.
   * `sleepers` false: the crossing has no sleepers (chorus 2 builds its own and takes them away).
   */
  buildTwist(o: { sleepers?: boolean } = {}) {
    if (this.twistRoot) return;
    const A = this.atlas, r = twist();
    const [c0, c1] = r.cross;
    const root = new THREE.Group();
    const d0 = c0 - 1, d1 = c1 + 1;
    const strip = buildTrack(A, new RouteCurve(r, d0, d1), { faces: this.faces, twoSided: true, ballast: true, step: 1, sleeperGap: 0.8, sleepers: o.sleepers !== false, up: (u) => r.at(d0 + u * (d1 - d0)).up });
    this.crossTrack = litMesh(strip, this.groundMat);
    root.add(this.crossTrack);
    // pillars: one column beside the strip, with an arm under it. None where the strip turns: a column would stand in the way of the car.
    // The column stands on the side away from the ride cam (the cam is on the +z side of the car, and under the hanging car that is the other side of the world)
    const conc = allFaces({ cell: speckled(A, 16, 16, '#8a8a86', [['#7a7a76', 0.3, 5], ['#9a9a96', 0.15, 9]]) });
    const b = new Builder();
    for (let d = c0 + 6; d < c1 - 4; d += 12) {
      const f = r.at(d), u = (d - c0) / (c1 - c0);
      if (f.pos.y < 1.5 || (u > 0.1 && u < 0.4) || (u > 0.6 && u < 0.9)) continue;
      const yaw = Math.atan2(-f.tangent.z, f.tangent.x);
      const sx = Math.sin(yaw), sz = Math.cos(yaw);
      const s = u > 0.4 && u < 0.6 ? 1 : -1;
      b.box(0.9, f.pos.y + 0.15 - GROUND_Y, 0.9, conc, at(f.pos.x + s * 3.4 * sx, GROUND_Y, f.pos.z + s * 3.4 * sz, yaw));
      b.box(0.6, 0.45, 6.4, conc, at(f.pos.x + s * 0.4 * sx, f.pos.y - 0.55, f.pos.z + s * 0.4 * sz, yaw));
    }
    root.add(litMesh(b, this.mat));
    root.visible = false;
    this.twistRoot = root;
    this.pieces = instanced(this.rest.geometry, this.ghostMat, STEM_PIECES);
    this.pieces.visible = false;
    this.scene.add(root, this.pieces);
  }

  /**
   * The state of the stem. `null`: as saved (the stem of act 1). A `Reread`: the stem is in pieces between its saved place and the crossing.
   * `'twisted'`: the crossing stands on its pillars. Call `buildTwist` first.
   */
  poseTwist(st: Reread | 'twisted' | null) {
    if (!this.twistRoot || !this.pieces) throw new Error('world: buildTwist() has not run');
    this.stemRoot.visible = st === null;
    this.twistRoot.visible = st === 'twisted';
    this.pieces.visible = st !== null && st !== 'twisted';
    if (st === null || st === 'twisted') return;
    const r = twist(), [c0, c1] = r.cross;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), q1 = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), one = v3(1, 1, 1);
    const k = smooth(st.k), j = st.jitter;
    for (let i = 0; i < STEM_PIECES; i++) {
      const f = r.at(c0 + (i * (c1 - c0)) / STEM_PIECES);
      p.set(-(STEM_PIECES - i) * SEG, 0, 0).lerp(f.pos, k);
      q.identity().slerp(q1.setFromRotationMatrix(m.makeBasis(f.tangent, f.up, f.side)), k);
      // a bad read: the piece is somewhere else, some way up, turned
      const h = (n: number) => hashSin(st.seed * 31 + i, n) - 0.5;
      p.x += 150 * j * h(1); p.z += 150 * j * h(2) - 60 * j; p.y += 50 * j * (h(3) + 0.5);
      q.multiply(q1.setFromEuler(e.set(2 * j * h(4), 5 * j * h(5), 2 * j * h(6))));
      this.pieces.setMatrixAt(i, m.compose(p, q, one));
    }
    this.pieces.instanceMatrix.needsUpdate = true;
  }

  /** Puts the train on the route of verse 2: the middle of the front car at `d` metres. */
  placeTrainTwist(d: number) {
    const r = twist();
    this.cars.forEach((car, k) => {
      car.root.matrixAutoUpdate = false;
      car.root.matrix.copy(r.car(d - k * CAR_PITCH));
      car.root.matrixWorldNeedsUpdate = true;
    });
  }

  dispose() {
    this.atlas.dispose();
    this.ghostMat.dispose();
    this.mat.dispose();
    this.groundMat.dispose();
  }
}

// ---------------------------------------------------------------- the builders of the world

/**
 * The tracks that the world itself does not lay but other scenes do: the crossing of chorus 2 (its points every 2 m), and the straight of
 * chorus 3 (from the exit point `e`, heading `tx`, `tz`) with the street of its kit (`_c3stage.ts` `C3Line`) on its far side.
 */
const KEEP = (() => {
  const lap = twistLap(), cross: THREE.Vector3[] = [];
  for (let l = 0; l <= lap.cross; l += 2) cross.push(lap.at(l).pos);
  const e = c3Exit(), n = Math.hypot(e.tangent.x, e.tangent.z);
  return { cross, e: e.pos, tx: e.tangent.x / n, tz: e.tangent.z / n };
})();

/** Whether (x, z) is clear of the track (stem, loop, the straight ahead of C, the crossing, the straight of chorus 3 and its street), the stations, the house, the street, the mountain and the pit, by `r` metres. */
function clearOf(x: number, z: number, r: number): boolean {
  if (Math.abs(z) < 7 + r && x > STEM_X0 - 10 && x < LOOP_LEN + 20) return false;
  if (Math.abs(Math.hypot(x - LOOP_C.x, z - LOOP_C.z) - LOOP_R) < 8 + r) return false;
  if (Math.abs(x - PIT.x) < PIT.half + r && Math.abs(z - PIT.z) < PIT.half + r) return false;
  if (Math.abs(x - HOUSE.x) < 8 + r && Math.abs(z - HOUSE.z) < 8 + r) return false;
  if (Math.abs(z - STREET.z) < STREET.w / 2 + r && x > -240 && x < 160) return false;
  if (Math.abs(x - LOOP_C.x) < 46 + r && Math.abs(z - (LOOP_C.z - LOOP_R - 6)) < 30 + r) return false;
  if (KEEP.cross.some((p) => Math.hypot(x - p.x, z - p.z) < 8 + r)) return false;
  // along the straight of chorus 3, and across it: + is the side of its street (+z in the stage frame of `_c3stage.ts`)
  const dx = x - KEEP.e.x, dz = z - KEEP.e.z, along = dx * KEEP.tx + dz * KEEP.tz, across = dx * KEEP.tz - dz * KEEP.tx;
  if (along > -10 && along < 1300 && Math.abs(across) < 8 + r) return false;
  if (along > 110 - r && along < 1300 && across > 8 - r && across < 120 + r) return false;
  for (const id of STATION_IDS) {
    const p = routePoint(STATIONS[id].s);
    if (Math.hypot(x - p.x, z - p.z) < 22 + r) return false;
  }
  return true;
}

/** The ground (four slabs round the pit, and the pit's own slab), the fields and the trees (none on `houses`). It adds them to `scene`. */
function buildGround(A: LitAtlas, mat: THREE.Material, groundMat: THREE.Material, scene: THREE.Scene, houses: readonly TownHouse[]): { pit: THREE.Mesh; trees: { near: THREE.Mesh; far: THREE.Mesh } } {
  const rnd = mulberry32(0x51c4);
  const grass: Face = { cell: A.mipmap(speckled(A, 16, 16, '#3f7d34', [['#4a8c3c', 0.22, 7], ['#356b2d', 0.2, 9]])) };
  const fields: Face[] = [['#7da644', '#6b9438'], ['#6d9a3a', '#5c8630'], ['#b8a24a', '#a08c3c']].map(([a, b]) => ({ cell: A.mipmap(A.paint(16, 16, (p) => { p.fill(a!); for (let x = 0; x < 16; x += 4) p.rect(x, 0, 1, 16, b!); })) }));
  const trunk: Face = { cell: A.solid('#5a3e28') };
  const leaves: Face[] = ['#2f6a34', '#285c2e', '#24523a'].map((c, i) => ({ cell: speckled(A, 8, 8, c, [['#3b7c3e', 0.3, 2 + i * 4]]) }));
  const g = new Builder();
  const E = 900, top = GROUND_Y, th = 0.4;
  const slab = (b: Builder, x0: number, x1: number, z0: number, z1: number) => b.box(x1 - x0, th, z1 - z0, { py: grass }, at((x0 + x1) / 2, top - th, (z0 + z1) / 2));
  slab(g, -E, PIT.x - PIT.half, -E, E);
  slab(g, PIT.x + PIT.half, E, -E, E);
  slab(g, PIT.x - PIT.half, PIT.x + PIT.half, -E, PIT.z - PIT.half);
  slab(g, PIT.x - PIT.half, PIT.x + PIT.half, PIT.z + PIT.half, E);
  const pit = new Builder();
  slab(pit, PIT.x - PIT.half, PIT.x + PIT.half, PIT.z - PIT.half, PIT.z + PIT.half);
  // fields: blocks of plots inside the loop and round it
  const block = (cx: number, cz: number, nx: number, nz: number, w: number, d: number) => {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = cx + (i - (nx - 1) / 2) * (w + 0.8), z = cz + (j - (nz - 1) / 2) * (d + 0.8);
      const f = fields[Math.floor(rnd() * fields.length)]!;
      if (clearOf(x, z, Math.max(w, d) / 2)) g.box(w, 0.05, d, { py: f }, at(x, top, z));
    }
  };
  for (const [cx, cz, nx, nz, w, d] of [
    [-40, -70, 4, 3, 14, 11], [-45, -128, 3, 3, 13, 12], [40, -52, 3, 2, 15, 11], [-150, -34, 5, 2, 15, 12],
    [-190, 70, 4, 3, 14, 12], [150, -70, 3, 4, 14, 12], [170, 60, 3, 3, 15, 12], [-150, -150, 4, 3, 16, 13],
  ] as const) block(cx, cz, nx, nz, w, d);
  scene.add(litMesh(g, groundMat, { cast: false }));
  const pitMesh = litMesh(pit, groundMat, { cast: false });
  scene.add(pitMesh);
  const trees = plantTrees(rnd, trunk, leaves, mat, houses);
  scene.add(trees.near, trees.far);
  return { pit: pitMesh, trees };
}

/**
 * The trees of the country: a near tree of three parts and a far tree of one cone at each place (`GameWorld.mapLod` shows the far ones).
 * No crown touches a house of `houses` (the close town, the larger one) with its hedge and its air conditioner.
 */
function plantTrees(rnd: () => number, trunk: Face, leaves: Face[], mat: THREE.Material, houses: readonly TownHouse[]): { near: THREE.Mesh; far: THREE.Mesh } {
  const tb = new Builder(), lb = new Builder();
  const top = GROUND_Y;
  for (let tries = 0, placed = 0; tries < 9000 && placed < 520; tries++) {
    const x = -330 + rnd() * 560, z = -330 + rnd() * 470;
    const s = 0.9 + rnd() * 0.9, turn = rnd() * 6, leaf = leaves[Math.floor(rnd() * leaves.length)]!;
    if (!clearOf(x, z, 3)) continue;
    // the crown is 1.5 s wide each way; a house with its air conditioner reaches 1.5 m past its walls and with its hedge 3.2 m
    if (houses.some((h) => Math.abs(x - h.x) < h.w / 2 + 1.5 + 1.5 * s && Math.abs(z - h.z) < h.d / 2 + 3.2 + 1.5 * s)) continue;
    placed++;
    const mm = new THREE.Matrix4().compose(v3(x, top, z), new THREE.Quaternion().setFromAxisAngle(v3(0, 1, 0), turn), v3(s, s, s));
    tb.cylinder(0.2, 0.2, 1.0, 5, trunk, null, mm);
    tb.cylinder(1.5, 0, 2.6, 6, leaf, null, mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.7, 0)));
    tb.cylinder(1.1, 0, 2.2, 6, leaf, null, mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.1, 0)));
    // the far tree: one cone of four sides over the two of the near tree
    lb.cylinder(1.5, 0, 4.3, 4, leaf, null, mm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.7, 0)));
  }
  const near = litMesh(tb, mat);
  const far = litMesh(lb, mat);
  far.visible = false;
  return { near, far };
}

/** The painted faces of the houses of the town. */
interface TownFaces {
  walls: Face[]; roofs: Face[]; win: Face;
  glass: BoxFaces; frame: BoxFaces; found: BoxFaces; doors: BoxFaces[];
  brick: BoxFaces; unit: BoxFaces; metal: BoxFaces; post: BoxFaces;
  rail: Face; hedge: BoxFaces;
}

function townFaces(A: LitAtlas): TownFaces {
  const walls = ['#d8cdb0', '#c9d6dc', '#e0bfb0', '#cfd8b8', '#d8d0d8'].map((c): Face => ({ cell: A.paint(8, 8, (p) => { p.fill(c); p.rect(0, 7, 8, 1, '#a89c84'); }) }));
  const roofs = ['#8a3a34', '#3a5a8a', '#4a6a44', '#6a4a3a'].map((c): Face => ({ cell: A.solid(c) }));
  const win: Face = { cell: A.paint(1, 1, (p) => p.fill('#ffd890', 2.6)) };
  // the parts that make a box a house
  const glass = allFaces({ cell: A.paint(4, 4, (p) => { p.fill('#27344a'); p.rect(0, 3, 4, 1, '#4a5c78'); p.rect(0, 0, 1, 4, '#1c2638'); }) });
  const frame = allFaces({ cell: A.solid('#f0ece0') }), found = allFaces({ cell: A.solid('#7c7a74') });
  const doors = ['#6a4a30', '#3a4a5a', '#7a2a28'].map((c) => allFaces({ cell: A.paint(4, 8, (p) => { p.fill(c); p.rect(0, 0, 4, 1, '#1c1814'); p.rect(3, 3, 1, 1, '#e8d890'); }), map: 'fit' }));
  const brick = allFaces({ cell: A.paint(4, 4, (p) => { p.fill('#8a5a48'); p.rect(0, 1, 4, 1, '#6a4436'); p.rect(0, 3, 4, 1, '#6a4436'); }) });
  const unit = allFaces({ cell: A.paint(4, 4, (p) => { p.fill('#c4c8cc'); p.rect(1, 1, 2, 2, '#6a7078'); }) });
  const metal = allFaces({ cell: A.solid('#2c3038') }), post = allFaces({ cell: A.solid('#c03a30') });
  const rail: Face = { cell: A.paint(4, 4, (p) => { p.fill('#3a3e46'); p.rect(1, 0, 1, 3, '#8a9098'); p.rect(3, 0, 1, 3, '#8a9098'); }) };
  const hedge = allFaces({ cell: speckled(A, 8, 8, '#2f6a34', [['#3f8040', 0.3, 3], ['#24542a', 0.25, 6]]) });
  return { walls, roofs, win, glass, frame, found, doors, brick, unit, metal, post, rail, hedge };
}

/** The meshes of the town (`buildTown`). `base` holds the positions of the close town, `span` the first and the end vertex of each house of `houses`. */
interface TownMeshes { map: THREE.Mesh; close: THREE.Mesh; morph: THREE.Mesh; far: THREE.Mesh; base: Float32Array; span: [number, number][] }

/** The x of the three side roads of the town. */
const SIDE_ROADS = [-170, -70, 70];

/**
 * The town: the street south of the stem with a row of houses on each side, three side roads with houses, and farm houses round the loop.
 * The houses are built twice. A map view shows them at their true size (`MAP_HOUSE`): the map reads as a map. A view that stands in
 * the world shows them `CLOSE_HOUSE` times as large, in rows that open up with them: beside the train of 20 m they stand as houses do.
 * `houses` and `windows` get those of the close views. It adds the meshes to `scene`.
 */
function buildTown(A: LitAtlas, mat: THREE.Material, scene: THREE.Scene, houses: TownHouse[], windows: TownWindow[]): TownMeshes {
  const asphalt: Face = { cell: speckled(A, 16, 16, '#56565e', [['#4a4a52', 0.3, 5], ['#62626a', 0.15, 9]]) };
  const faces = townFaces(A);
  const roads = new Builder();
  const road = (x0: number, z0: number, x1: number, z1: number) => {
    roads.box(Math.hypot(x1 - x0, z1 - z0), 0.05, STREET.w, { py: asphalt }, at((x0 + x1) / 2, GROUND_Y, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0)));
  };
  road(-240, STREET.z, 160, STREET.z);
  for (const x of SIDE_ROADS) road(x, STREET.z, x, 120);
  scene.add(litMesh(roads, mat, { cast: false }));
  const farB = new Builder();
  const map = litMesh(new Town(faces, MAP_HOUSE, farB, null).build(), mat);
  const span: [number, number][] = [];
  const close = litMesh(new Town(faces, CLOSE_HOUSE, null, { houses, windows, span }).build(), mat);
  map.visible = false;
  const far = litMesh(farB, mat);
  far.visible = false;
  const pos = close.geometry.getAttribute('position') as THREE.BufferAttribute;
  const base = Float32Array.from(pos.array as Float32Array);
  const morph = litMesh(close.geometry.clone(), mat);
  morph.visible = false;
  scene.add(map, close, morph, far);
  return { map, close, morph, far, base, span };
}

/**
 * One town with houses at the scale `S`. Both towns stand on one plan: the rows are spaced for the close houses (`CLOSE_HOUSE`), so the
 * map and a close view show the same houses in the same places, and only their size changes. `far`: a builder that gets the far houses
 * (walls and roofs only). `keep`: the lists that get the houses, the lit windows and the vertex span of each house.
 */
class Town {
  private g = new Builder();
  // `rnd` places and sizes the houses (the same draws at each scale); `dr` picks their parts
  private rnd = mulberry32(0x70f7);
  private dr = mulberry32(0x4d37);

  constructor(
    private f: TownFaces, private S: number, private far: Builder | null,
    private keep: { houses: TownHouse[]; windows: TownWindow[]; span: [number, number][] } | null,
  ) {}

  /** Places the houses: the street (the north row and the south row face it; the player's house stands in the north row), the side roads, the farms. */
  build(): Builder {
    const rnd = this.rnd, L = CLOSE_HOUSE;
    const back = (L - 1) * 3.4;
    for (let x = -232; x <= 152; x += (10.5 + rnd() * 4) * L) {
      if (SIDE_ROADS.some((sx) => Math.abs(x - sx) < 7 * L)) continue;
      if (Math.abs(x - HOUSE.x) > 12 * L) this.house(x, STREET.z - 9.2 - back, 1);
      this.house(x + 2, STREET.z + 8.6 + back, -1);
    }
    for (const sx of SIDE_ROADS) for (let z = STREET.z + 20 * L; z <= 116; z += (11 + rnd() * 4) * L) { this.house(sx - 8 - back, z, 1); if (rnd() < 0.8) this.house(sx + 8 + back, z + 3, -1); }
    // farm houses in the country, none in another: a house with its eaves, air conditioner and hedge is at most 15 m wide (x) and 16 m deep (z)
    const farms: [number, number][] = [];
    for (let k = 0; k < 900 && farms.length < 46; k++) {
      const x = -300 + rnd() * 520, z = -310 + rnd() * 290;
      if (!clearOf(x, z, 7 * L) || farms.some(([fx, fz]) => Math.abs(x - fx) < 15 && Math.abs(z - fz) < 16)) continue;
      this.house(x, z, 1);
      farms.push([x, z]);
    }
    return this.g;
  }

  /** One house at (x, z) whose front faces the side `faceZ` (the sign of z). */
  private house(x: number, z: number, faceZ: number) {
    const v0 = this.g.vertices;
    const h = this.shell(x, z);
    const front = this.front(x, z, faceZ, h);
    this.extras(x, z, faceZ, h, front);
    if (this.keep) this.keep.span.push([v0, this.g.vertices]);
  }

  /** The walls, the roof and the footing: the size of the house and whether its two front windows are lit. */
  private shell(x: number, z: number): TownHouse & { litA: boolean; litB: boolean } {
    const { g, f, S, rnd } = this;
    const w = (6 + rnd() * 2.4) * S, d = (5 + rnd() * 1.6) * S, h = ((rnd() < 0.45 ? 5.6 : 3.2) + rnd() * 0.8) * S;
    const wall = f.walls[Math.floor(rnd() * f.walls.length)]!, roof = f.roofs[Math.floor(rnd() * f.roofs.length)]!;
    const rise = (1.6 + rnd() * 0.7) * S;
    const litA = rnd() < 0.75, litB = rnd() < 0.5;
    const m = at(x, GROUND_Y, z);
    if (this.keep) this.keep.houses.push({ x, z, w, d, h, rise });
    g.box(w, h, d, { px: wall, nx: wall, pz: wall, nz: wall, py: wall }, m);
    g.extrude([[-w / 2 - 0.3 * S, h], [w / 2 + 0.3 * S, h], [0, h + rise]], d + 0.6 * S, roof, roof, m);
    // the far house: the walls and the roof only (no windows, door, step, chimney or garden)
    if (this.far) {
      this.far.box(w, h, d, { px: wall, nx: wall, pz: wall, nz: wall, py: wall }, m);
      this.far.extrude([[-w / 2 - 0.3 * S, h], [w / 2 + 0.3 * S, h], [0, h + rise]], d + 0.6 * S, roof, roof, m);
    }
    g.box(w + 0.14 * S, 0.3 * S, d + 0.14 * S, f.found, m);
    return { x, z, w, d, h, rise, litA, litB };
  }

  /** The windows (two on the front of each floor in white frames, lit or dark; one on each side and on the back), the door and its step. */
  private front(x: number, z: number, faceZ: number, hs: TownHouse & { litA: boolean; litB: boolean }): { zf: number; floors: number[] } {
    const { g, f, S, dr } = this, { w, d, h } = hs, top = GROUND_Y;
    const zf = z + faceZ * (d / 2 + 0.03), zb = z - faceZ * (d / 2 + 0.03);
    const floors = h > 5 * S ? [0.6 * S, 3.2 * S] : [0.6 * S];
    for (const y0 of floors) {
      for (const [sx, lit] of [[-1, hs.litA], [1, hs.litB]] as const) {
        const wx = x + sx * w * 0.22;
        g.box(1.36 * S, 1.16 * S, 0.04, f.frame, at(wx, top + y0 - 0.08 * S, zf));
        g.box(1.2 * S, 1.0 * S, 0.06, lit ? allFaces(f.win) : f.glass, at(wx, top + y0, zf));
        if (lit && this.keep) this.keep.windows.push({ x: wx, y: top + y0 + 0.5 * S, z: zf, face: faceZ });
      }
      const side = dr() < 0.3 ? allFaces(f.win) : f.glass;
      for (const sx of [-1, 1]) g.box(0.06, 1.0 * S, 1.1 * S, sx < 0 ? side : f.glass, at(x + sx * (w / 2 + 0.03), top + y0, z + (dr() - 0.5) * d * 0.4));
      g.box(1.1 * S, 1.0 * S, 0.06, f.glass, at(x + (dr() - 0.5) * w * 0.4, top + y0, zb));
    }
    g.box(0.95 * S, 1.95 * S, 0.08, f.doors[Math.floor(dr() * f.doors.length)]!, at(x, top + 0.3 * S, zf));
    g.box(1.5 * S, 0.3 * S, 0.7 * S, f.found, at(x, top, zf + faceZ * 0.35 * S));
    return { zf, floors };
  }

  /** The awning, the balcony, the chimney, the aerial, the air conditioner, the hedge and the post box: each one or not, by `dr`. */
  private extras(x: number, z: number, faceZ: number, hs: TownHouse, { zf, floors }: { zf: number; floors: number[] }) {
    const { g, f, S, dr } = this, { w, d, h, rise } = hs, top = GROUND_Y;
    if (dr() < 0.4) g.box(1.7 * S, 0.08 * S, 0.8 * S, allFaces(f.roofs[Math.floor(dr() * f.roofs.length)]!), at(x, top + 2.4 * S, zf + faceZ * 0.4 * S));
    // a balcony on a house of two floors
    if (floors.length > 1 && dr() < 0.45) {
      const bx = x - w * 0.22, bz = zf + faceZ * 0.5 * S, rail = f.rail;
      g.box(2.2 * S, 0.1 * S, 1.0 * S, f.found, at(bx, top + 3.05 * S, bz));
      g.box(2.2 * S, 0.8 * S, 0.06, { pz: rail, nz: rail, px: rail, nx: rail, py: rail }, at(bx, top + 3.15 * S, bz + faceZ * 0.47 * S));
    }
    // on the roof: a chimney, an aerial
    if (dr() < 0.45) g.box(0.55 * S, 1.2 * S, 0.55 * S, f.brick, at(x + w * 0.25, top + h + rise * 0.3, z - faceZ * d * 0.2));
    if (dr() < 0.4) {
      const ax = x - w * 0.12, az = z + faceZ * d * 0.15;
      g.box(0.06, 1.5 * S, 0.06, f.metal, at(ax, top + h + rise * 0.7, az));
      g.box(0.9 * S, 0.05, 0.05, f.metal, at(ax, top + h + rise * 0.7 + 1.2 * S, az));
      g.box(0.6 * S, 0.05, 0.05, f.metal, at(ax, top + h + rise * 0.7 + 0.9 * S, az));
    }
    // at the wall: an air conditioner; in front: a hedge, a post box
    if (dr() < 0.45) g.box(0.4 * S, 0.6 * S, 0.85 * S, f.unit, at(x + (w / 2 + 0.2 * S), top + 0.1 * S, z - faceZ * d * 0.25));
    if (dr() < 0.55) g.box(w * 0.42, 0.75 * S, 0.45 * S, f.hedge, at(x - w * 0.27, top, z + faceZ * (d / 2 + 1.5 * S)));
    if (dr() < 0.4) { g.box(0.07, 0.75, 0.07, f.metal, at(x + w * 0.32, top, z + faceZ * (d / 2 + 1.4 * S))); g.box(0.36, 0.26, 0.26, f.post, at(x + w * 0.32, top + 0.75, z + faceZ * (d / 2 + 1.4 * S))); }
  }
}

/** The player's house: two storeys, a pitched roof, the balcony over the street with the lit door behind it. */
function buildPlayerHouse(A: LitAtlas, mat: THREE.Material): THREE.Mesh {
  const wall: Face = { cell: speckled(A, 16, 16, '#c8bea6', [['#b8ae96', 0.2, 31]]) };
  const roof: Face = { cell: A.paint(8, 8, (p) => { p.fill('#8a3a34'); p.rect(0, 0, 8, 1, '#6c2c28'); }) };
  const dark: Face = { cell: A.solid('#2a2e36') };
  const bar: Face = { cell: A.solid('#8a9098') };
  const lit: Face = { cell: A.paint(8, 8, (p) => { p.fill('#ffd9a0', 3.2); p.rect(3, 0, 1, 8, '#6a5038'); p.rect(0, 3, 8, 1, '#6a5038'); }), map: 'fit' };
  const b = new Builder();
  const y0 = GROUND_Y, m = at(HOUSE.x, y0, HOUSE.z);
  b.box(9, 8.4, 7, { px: wall, nx: wall, pz: wall, nz: wall, py: wall }, m);
  b.extrude([[-4.9, 8.4], [4.9, 8.4], [0, 10.8]], 7.6, roof, roof, m);
  // the balcony: a slab, a rail of bars, the lit door behind it, and the outside stairs down to the street
  const bz = HOUSE_DOOR_Z + 0.75;
  b.box(5.6, 0.2, 1.5, allFaces(dark), at(HOUSE.x - 1.2, HOUSE_FLOOR - 0.2, bz));
  for (let k = 0; k <= 11; k++) b.box(0.08, 1.0, 0.08, allFaces(bar), at(HOUSE.x - 3.95 + k * 0.5, HOUSE_FLOOR, bz + 0.7));
  b.box(5.6, 0.08, 0.08, allFaces(bar), at(HOUSE.x - 1.2, HOUSE_FLOOR + 1.0, bz + 0.7));
  for (let k = 0; k < 8; k++) b.box(1.0, 0.18, 0.42, allFaces(dark), at(HOUSE.x + 2.2, y0 + (HOUSE_FLOOR - y0) * (1 - (k + 1) / 8), bz - 0.4 + k * 0.42));
  const quad = (x0: number, x1: number, ya: number, yb: number) => b.quad(v3(x0, ya, 0), v3(x1, ya, 0), v3(x1, yb, 0), v3(x0, yb, 0), lit, at(HOUSE.x, 0, HOUSE_DOOR_Z + 0.03));
  quad(-3.6, 0.4, HOUSE_FLOOR, HOUSE_FLOOR + 2.1);
  quad(-3.2, -1.4, 0.4, 2.0);
  b.box(8, 0.03, 4, { py: { cell: A.solid('#ffcf88', 0.5) } }, at(HOUSE.x - 1, y0 + 0.03, HOUSE_DOOR_Z + 3.2));
  return litMesh(b, mat);
}

/**
 * The mountain on the far side of the loop, with the tunnel. Its long axis lies along the track there (the track runs toward -x).
 * `mat`: the ground material: the cells are mipmapped, so the speckle of the slopes does not beat into moire from far.
 */
function buildMountain(A: LitAtlas, mat: THREE.Material): THREE.Mesh {
  const rock: Face = { cell: A.mipmap(speckled(A, 16, 16, '#6c726a', [['#7c8278', 0.3, 3], ['#585e58', 0.25, 12]])) };
  const moss: Face = { cell: A.mipmap(speckled(A, 16, 16, '#4c7440', [['#5a8450', 0.3, 4], ['#3e6234', 0.2, 6]])) };
  const dark: Face = { cell: A.mipmap(A.solid('#0c0e12')) };
  const r = new Builder();
  const L = TUNNEL.s1 - TUNNEL.s0, z0 = LOOP_C.z - LOOP_R;
  // the profile across the track (x of the profile = across, toward the outside of the loop): two flanks with the bore between them
  const m = at(LOOP_C.x, GROUND_Y, z0 - 0.6, Math.PI / 2);
  const mirror = (pts: [number, number][]) => pts.map(([x, y]) => [-x, y] as [number, number]).reverse();
  const left: [number, number][] = [[-30, 0], [-3.6, 0], [-3.6, 5.4], [-4.4, 6.6], [-12, 17], [-22, 10]];
  r.extrude(left, L, rock, moss, m);
  r.extrude(mirror(left), L, rock, moss, m);
  r.extrude([[-12, 17], [-4.4, 6.6], [4.4, 6.6], [12, 17], [5, 27], [-6, 29]], L - 4, moss, moss, m);
  r.box(L, 0.3, 8.4, { ny: dark }, at(LOOP_C.x, GROUND_Y + 6.3, z0 - 0.6));
  // shoulders: lower peaks beside and behind it, each at least 7 m clear of the loop rail (the ballast and the car)
  for (const [dx, dz, rad, h] of [[-34, -23, 20, 19], [32, -25, 22, 22], [0, -37, 30, 34], [-58, -6, 13, 10], [56, -5, 12, 9]] as const) r.cylinder(rad, 0, h, 7, moss, null, at(LOOP_C.x + dx, GROUND_Y, z0 + dz));
  return litMesh(r, mat);
}

/** Far hills and a far treeline in a ring round the world (close views only). */
function buildFar(A: LitAtlas, mat: THREE.Material): THREE.Mesh {
  const rnd = mulberry32(0xfa2);
  const near: Face = { cell: A.solid('#22342e') }, farC: Face = { cell: A.solid('#2c3350') };
  const b = new Builder();
  for (const [rad, base, amp, f] of [[620, 26, 30, near], [860, 60, 50, farC]] as const) {
    const n = 72, ph = rnd() * 6;
    const pt = (k: number, y: number) => v3(LOOP_C.x + rad * Math.cos((k / n) * Math.PI * 2), GROUND_Y + y, LOOP_C.z + rad * Math.sin((k / n) * Math.PI * 2));
    const h = (k: number) => base + amp * (0.5 + 0.3 * Math.sin(k * 0.51 + ph) + 0.2 * Math.sin(k * 1.37 + ph * 2));
    for (let k = 0; k < n; k++) {
      b.quad(pt(k, 0), pt(k + 1, 0), pt(k + 1, h((k + 1) % n)), pt(k, h(k)), f);
      b.quad(pt(k + 1, 0), pt(k, 0), pt(k, h(k)), pt(k + 1, h((k + 1) % n)), f);
    }
  }
  return litMesh(b, mat, { cast: false, receive: false });
}

interface PoleFaces { wood: Face; wire: Face; lamp: Face }

/** How much taller a pole is where the crossing runs under its span (m): its wires then clear a car on the crossing by about 3 m. */
const POLE_LIFT = 6;

/** Whether the segments a-c and p-q cross on the ground (x, z). */
function crosses(a: THREE.Vector3, c: THREE.Vector3, p: THREE.Vector3, q: THREE.Vector3): boolean {
  const side = (o: THREE.Vector3, u: THREE.Vector3, w: THREE.Vector3) => Math.sign((u.x - o.x) * (w.z - o.z) - (u.z - o.z) * (w.x - o.x));
  return side(a, c, p) !== side(a, c, q) && side(p, q, a) !== side(p, q, c);
}

/**
 * One pole line into `b`: a pole at each of `pts` with a cross arm at its yaw, a lamp on every second pole, and two sagging wires
 * between each two poles. `lift`: how much taller each pole is than the others (m); its cross arm and its wires go up with it. `loop`:
 * the pole line of the loop, which closes on itself, and whose lamps and spans go into the lists; with `wires` false it has no wires.
 */
function poleLine(
  b: Builder, pts: THREE.Vector3[], yaws: number[], lift: number[], f: PoleFaces,
  loop: { lamps: THREE.Vector3[]; spans: { a: THREE.Vector3; c: THREE.Vector3 }[]; wires: boolean } | null,
) {
  pts.forEach((p, k) => {
    b.cylinder(0.16, 0.12, 8 + lift[k]!, 5, f.wood, f.wood, at(p.x, GROUND_Y, p.z));
    b.box(0.14, 0.14, 2.4, allFaces(f.wood), at(p.x, 6.9 + lift[k]!, p.z, yaws[k]!));
    // every second pole carries a lamp
    if (k % 2 === 0) { b.box(0.5, 0.3, 0.5, allFaces(f.lamp), at(p.x, 5.2, p.z)); if (loop) loop.lamps.push(v3(p.x, 5.35, p.z)); }
  });
  for (let k = 0; k < (loop ? pts.length : pts.length - 1); k++) {
    const kc = (k + 1) % pts.length, a = pts[k]!, c = pts[kc]!;
    if (loop) {
      loop.spans.push({ a: a.clone(), c: c.clone() });
      if (!loop.wires) continue;
    }
    wireSpan(b, a, c, lift[k]!, lift[kc]!, f);
  }
}

/**
 * The two wires of one span from the pole at `a` to the pole at `c` (with their lifts `la`, `lc`), each in two straight halves that meet
 * lower in the middle (the sag). A wire is 0.1 m thick: a thinner one falls under one pixel on the map and breaks into dots.
 */
function wireSpan(b: Builder, a: THREE.Vector3, c: THREE.Vector3, la: number, lc: number, f: PoleFaces) {
  const len = a.distanceTo(c), yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
  const ys = [7.0 + la, 6.5 + (la + lc) / 2, 7.0 + lc];
  for (const d of [-0.9, 0.9]) {
    const ox = Math.sin(yaw) * d, oz = Math.cos(yaw) * d;
    for (const h of [0, 1]) {
      const p0 = v3(a.x + (c.x - a.x) * (h / 2) + ox, ys[h]!, a.z + (c.z - a.z) * (h / 2) + oz);
      const p1 = v3(a.x + (c.x - a.x) * ((h + 1) / 2) + ox, ys[h + 1]!, a.z + (c.z - a.z) * ((h + 1) / 2) + oz);
      const mid = p0.clone().lerp(p1, 0.5);
      const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(p1.y - p0.y, len / 2))).setPosition(mid.x, mid.y, mid.z);
      b.box(p0.distanceTo(p1), 0.1, 0.1, allFaces(f.wire), m);
    }
  }
}

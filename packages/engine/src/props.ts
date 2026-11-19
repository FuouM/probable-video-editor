// props: a board of the models of a scene module for `pve props`. A project module names its models in a
// `PropTable` (each entry builds one model in world metres) and exports `propBoard(table)` as its default scene. The
// board shows one model in one view per second of its clip, under a neutral studio light on a grid: the CLI renders
// each second as a tile of a contact sheet. The views: front three-quarter, back three-quarter, side, from above,
// and the front as a wireframe (the triangles).
import * as THREE from 'three';
import { NO_FILM_POST } from './post';
import { Scene, type Frame, type PostOverrides, type SceneClass } from './scene';

/** The models of a module: each builds a new object (its meshes carry their own materials). */
export type PropTable = Record<string, () => THREE.Object3D>;

export const PROP_VIEWS = ['front', 'back', 'side', 'top', 'wire'] as const;
export type PropView = (typeof PROP_VIEWS)[number];

/** What the CLI labels a tile with: the model's name, its triangles, its size (m, x y z). */
export interface PropInfo { name: string; tris: number; size: [number, number, number] }
/** What the board writes to `globalThis[PROPS_GLOBAL]` when it loads. */
export interface PropBoardInfo { views: PropView[]; models: PropInfo[] }

/** The camera of each view: azimuth from +z toward +x and elevation, degrees. */
const AIM: Record<PropView, [number, number]> = { front: [35, 20], back: [215, 20], side: [90, 6], top: [35, 70], wire: [35, 20] };

/** The global the board writes its PropBoardInfo to, for the CLI to read (packages/cli/src/main.ts, `props`). */
export const PROPS_GLOBAL = '__pveProps';

/**
 * The board scene of `table`. ctx.params: `names` (the models to show, default all, in table order) and `views`
 * (default PROP_VIEWS). Second k of the clip shows names[floor(k / views)] in views[k % views].
 */
export function propBoard(table: PropTable): SceneClass {
  return class PropBoard extends Scene {
    private scene = new THREE.Scene();
    private cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.001, 100);
    private wire = new THREE.MeshBasicMaterial({ color: 0xd8dce0, wireframe: true });
    private items: { obj: THREE.Object3D; grid: THREE.GridHelper; centre: THREE.Vector3; radius: number }[] = [];
    private views: PropView[] = [...PROP_VIEWS];

    override init() {
      const names: string[] = this.ctx.params.names ?? Object.keys(table);
      const views: string[] = this.ctx.params.views ?? [...PROP_VIEWS];
      for (const n of names) if (!table[n]) throw new Error(`props: no model '${n}' (models: ${Object.keys(table).join(', ')})`);
      this.views = views.map((v) => {
        const view = PROP_VIEWS.find((p) => p === v);
        if (!view) throw new Error(`props: no view '${v}' (views: ${PROP_VIEWS.join(', ')})`);
        return view;
      });
      this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a3430, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(-1, 2, 1.5);
      this.scene.add(key);
      const info: PropInfo[] = [];
      for (const name of names) {
        const obj = table[name]!();
        obj.visible = false;
        this.scene.add(obj);
        const box = new THREE.Box3().setFromObject(obj);
        if (box.isEmpty()) throw new Error(`props: the model '${name}' is empty`);
        const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
        // a grid under the model: cells of a power of ten, about a tenth of the model
        const cell = 10 ** Math.floor(Math.log10(Math.max(size.x, size.z, 0.01)));
        const span = Math.ceil((Math.max(size.x, size.z) * 1.6) / cell) * cell;
        const grid = new THREE.GridHelper(span, Math.round(span / cell), 0x8a8f96, 0x3c4046);
        grid.position.set(centre.x, box.min.y - 0.0005, centre.z);
        grid.visible = false;
        this.scene.add(grid);
        let tris = 0;
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const g = o.geometry;
            tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
          }
        });
        this.items.push({ obj, grid, centre, radius: size.length() / 2 });
        info.push({ name, tris, size: [size.x, size.y, size.z] });
      }
      const board: PropBoardInfo = { views: this.views, models: info };
      Reflect.set(globalThis, PROPS_GLOBAL, board);
    }

    render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
      const { renderer } = this.ctx;
      const V = this.views.length;
      const k = Math.min(Math.floor(f.t - f.start), this.items.length * V - 1);
      const item = this.items[Math.floor(k / V)]!, view = this.views[k % V]!;
      for (const it of this.items) it.obj.visible = it.grid.visible = it === item;
      const az = (AIM[view][0] * Math.PI) / 180, el = (AIM[view][1] * Math.PI) / 180;
      const dist = item.radius / Math.sin(((this.cam.fov / 2) * Math.PI) / 180) * 1.05;
      this.cam.position.set(
        item.centre.x + dist * Math.cos(el) * Math.sin(az),
        item.centre.y + dist * Math.sin(el),
        item.centre.z + dist * Math.cos(el) * Math.cos(az),
      );
      this.cam.near = Math.max(dist / 1000, 1e-4);
      this.cam.far = dist * 4;
      this.cam.lookAt(item.centre);
      this.cam.updateProjectionMatrix();
      this.scene.overrideMaterial = view === 'wire' ? this.wire : null;
      renderer.setRenderTarget(out);
      renderer.setClearColor(view === 'wire' ? 0x050608 : 0x1a1c20, 1);
      renderer.clear();
      renderer.render(this.scene, this.cam);
      this.scene.overrideMaterial = null;
      return { ...NO_FILM_POST };
    }

    override dispose() {
      this.wire.dispose();
      for (const it of this.items) {
        it.grid.dispose();
        it.obj.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            for (const m of [o.material].flat()) m.dispose();
          }
        });
      }
    }
  };
}

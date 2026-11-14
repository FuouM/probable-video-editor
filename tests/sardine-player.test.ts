// The pure parts of the sardine player (projects/sardine/video/scenes/_playerTrack.ts, _playerCams.ts): the input track, the cameras.
import { describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { clickAt, contentRect, FULL, toolButton, V6_TOOLS, type PlayerInput, type WinSpec } from '../projects/sardine/video/scenes/_playerTypes';
import { consoleTimes, PlayerTrack } from '../projects/sardine/video/scenes/_playerTrack';
import { FixedCam, FishCam, HeadCam, MAP_NOTCHES, MapCam, RideCam } from '../projects/sardine/video/scenes/_playerCams';
import { kickBounce } from '../projects/sardine/video/scenes/_rideMusic';
import { FPS } from '../projects/sardine/video/scenes/_time';
import { loadLanes } from '../projects/sardine/video/scenes/_fonts';
import { unitRomaji } from '../projects/sardine/video/scenes/_typing';
import { missingAt, setMissing } from '../packages/engine/src/gl';

const win = (id: string, rect: WinSpec['rect'] = [100, 60, 200, 120]): WinSpec => ({ id, title: `[${id}]`, rect });

describe('cursor', () => {
  const track = new PlayerTrack(clickAt(10, [100, 120]), { cursor: [400, 300] });

  test('arrives before the beat, presses for exactly 2 frames', () => {
    expect(track.cursorAt(9).x).toBeGreaterThan(110);
    const arrived = track.cursorAt(10 - 1.5 / FPS);
    expect([arrived.x, arrived.y]).toEqual([100, 120]);
    expect(track.cursorAt(10 - 1 / 1000).down).toBe(false);
    expect(track.cursorAt(10).down).toBe(true);
    expect(track.cursorAt(10 + 1 / FPS).down).toBe(true);
    expect(track.cursorAt(10 + 2 / FPS).down).toBe(false);
  });

  test('overshoots the target a little and corrects it', () => {
    // the move is along (-300, -180): past the target means x < 100 and y < 120
    let past = 0;
    for (let k = 0; k <= 200; k++) {
      const c = track.cursorAt(9.4 + (k / 200) * 0.55);
      past = Math.max(past, Math.hypot(100 - Math.min(c.x, 100), 120 - Math.min(c.y, 120)));
    }
    expect(past).toBeGreaterThan(1);
    expect(past).toBeLessThan(8);
  });

  test('rests, and then twitches by no more than a pixel', () => {
    for (let k = 0; k < 100; k++) {
      const c = track.cursorAt(12 + k * 0.1);
      expect(Math.abs(c.x - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.y - 120)).toBeLessThanOrEqual(2);
    }
  });

  test('two moves too close together are an error that names the time', () => {
    expect(() => new PlayerTrack([{ at: 5, kind: 'move', to: [0, 0] }, { at: 5.05, kind: 'move', to: [600, 340] }])).toThrow(/leaves no time/);
  });
});

describe('windows', () => {
  const inputs: PlayerInput[] = [
    { at: 5, kind: 'open', win: win('a'), origin: [20, 20] },
    { at: 5.5, kind: 'open', win: win('b', [150, 90, 200, 120]) },
    { at: 6, kind: 'focus', id: 'a' },
    { at: 7, kind: 'maximize', id: 'b' },
    { at: 8, kind: 'restore', id: 'b' },
    { at: 9, kind: 'close', id: 'a' },
  ];
  const track = new PlayerTrack(inputs);

  test('a window opens as a growing box for 2 frames', () => {
    expect(track.stateAt(4.9).windows.length).toBe(0);
    const w0 = track.stateAt(5 + 0.2 / FPS).windows[0]!;
    expect(w0.grow).toBe(0);
    const w1 = track.stateAt(5 + 1.2 / FPS).windows[0]!;
    expect(w1.grow).toBe(0.5);
    expect(w1.box[2]).toBeLessThan(w1.rect[2]);
    expect(track.stateAt(5 + 2.2 / FPS).windows[0]!.grow).toBe(1);
  });

  test('focus raises, maximize covers the frame, close removes', () => {
    expect(track.stateAt(5.8).windows.map((w) => w.id)).toEqual(['a', 'b']);
    expect(track.stateAt(6.5).windows.map((w) => w.id)).toEqual(['b', 'a']);
    const m = track.stateAt(7.5);
    expect(m.maximized?.id).toBe('b');
    expect(m.windows.at(-1)!.rect).toEqual(FULL);
    expect(m.windows.at(-1)!.content).toEqual([0, 10, 640, 340]);
    expect(track.stateAt(8.5).maximized).toBeNull();
    expect(track.stateAt(9.5).windows.map((w) => w.id)).toEqual(['b']);
  });

  test('a content rectangle keeps the 10 px bars', () => {
    expect(contentRect([100, 60, 200, 120], false)).toEqual([102, 72, 196, 96]);
  });

  test('an input for a window that is not open is an error', () => {
    expect(() => new PlayerTrack([{ at: 1, kind: 'maximize', id: 'x' }])).toThrow(/not been opened/);
  });
});

describe('map camera', () => {
  const at = new THREE.Vector3(3, 0, -2);

  test('a right-drag moves the map 1:1 with the cursor and stops dead', () => {
    const track = new PlayerTrack([{ at: 10, kind: 'pan', by: [-90, 40], dur: 0.5 }], { cursor: [300, 200] });
    const cam = new MapCam(track, { center: [0, 0] });
    const [x0, y0] = cam.project(at, 9);
    const [x1, y1] = cam.project(at, 10.5);
    expect(x1 - x0).toBeCloseTo(-90, 3);
    expect(y1 - y0).toBeCloseTo(40, 3);
    expect(cam.project(at, 12)).toEqual(cam.project(at, 10.5));
  });

  test('three zoom notches take 4 frames; rotation turns the view by 90 degrees at once', () => {
    const track = new PlayerTrack([{ at: 10, kind: 'zoom', notch: 2 }, { at: 11, kind: 'zoom', notch: 0 }, { at: 12, kind: 'rotate', steps: 1 }]);
    const cam = new MapCam(track, { center: [0, 0] });
    expect(cam.view(9.9).ppm).toBeCloseTo(MAP_NOTCHES[1], 6);
    expect(cam.view(10 + 2 / FPS).ppm).toBeGreaterThan(MAP_NOTCHES[1]);
    expect(cam.view(10 + 4 / FPS).ppm).toBeCloseTo(MAP_NOTCHES[2], 6);
    expect(cam.view(11 + 4 / FPS).ppm).toBeCloseTo(MAP_NOTCHES[0], 6);
    expect(cam.view(11.9).steps).toBe(0);
    expect(cam.view(12).steps).toBe(1);
    // the pixel grid of the default notch: 1 m along the ground x axis is 8 px across and 4 px down at yaw 45
    const a = cam.project(new THREE.Vector3(0, 0, 0), 9), b = cam.project(new THREE.Vector3(1, 0, 0), 9);
    expect(Math.abs(b[0] - a[0])).toBeCloseTo(8, 3);
    expect(Math.abs(b[1] - a[1])).toBeCloseTo(4, 3);
  });

  test('an edge scroll ramps up and stops when the input ends', () => {
    const track = new PlayerTrack([{ at: 10, kind: 'edge', dir: [1, 0], dur: 1.5 }]);
    const cam = new MapCam(track, { center: [0, 0] });
    const p = new THREE.Vector3(0, 0, 0);
    const d = (t: number) => cam.project(p, 9)[0] - cam.project(p, t)[0];
    const s1 = d(10.25) - d(10), s2 = d(10.75) - d(10.5);
    expect(s2).toBeGreaterThan(s1 * 1.5);
    expect(d(12)).toBeCloseTo(d(11.5), 6);
  });

  test('follow locks to a moving point with a lag and stops where it is when it lets go', () => {
    const track = new PlayerTrack([{ at: 10, kind: 'follow', on: true }, { at: 14, kind: 'follow', on: false }]);
    const cam = new MapCam(track, { center: [0, 0], follow: (t) => new THREE.Vector3(20 + (t - 10) * 5, 0, 0), lag: 0.2 });
    const c = cam.view(13).center;
    // after 3 s the map is on the train, a lag behind it (speed x lag = 1 m)
    expect(20 + 15 - c.x).toBeGreaterThan(0.5);
    expect(20 + 15 - c.x).toBeLessThan(2);
    expect(cam.view(20).center.x).toBeCloseTo(cam.view(14.5).center.x, 9);
  });
});

describe('head camera', () => {
  const eye = [0, 1.1, 0] as const;
  const cam = new HeadCam({ eye, look: [0, 1.1, -3], turns: [{ at: 10, look: [-3, 1.0, -3] }, { at: 13, look: [3, 1.1, -3] }] });

  test('a turn takes about a quarter second, overshoots by a few degrees and holds', () => {
    const target = Math.atan2(-3, 3);
    const yaw = (t: number) => cam.gaze(t).yaw;
    expect(yaw(9.9)).toBeCloseTo(0, 9);
    const turn = Math.abs(target - 0);
    expect(Math.abs(yaw(10.3) - 0) / turn).toBeGreaterThan(0.9);
    let over = 0;
    for (let k = 0; k <= 300; k++) over = Math.max(over, Math.abs(yaw(10 + k / 200)) - Math.abs(target));
    expect(THREE.MathUtils.radToDeg(over)).toBeGreaterThan(1);
    expect(THREE.MathUtils.radToDeg(over)).toBeLessThan(5);
    expect(yaw(11.9)).toBeCloseTo(target, 3);
    expect(yaw(12.5)).toBeCloseTo(target, 6);
  });

  test('the eye breathes by no more than 4 mm at 0.3 Hz', () => {
    const c = new THREE.PerspectiveCamera();
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 400; k++) { cam.apply(c, k / 30); lo = Math.min(lo, c.position.y); hi = Math.max(hi, c.position.y); }
    expect(hi - 1.1).toBeCloseTo(0.004, 4);
    expect(1.1 - lo).toBeCloseTo(0.004, 4);
    expect(c.position.x).toBe(0);
  });
});

describe('ride and fixed cameras', () => {
  test('the kick bounce dips on the kick and is gone half a second later', () => {
    expect(kickBounce(5, [5])).toBeCloseTo(-0.035, 9);
    expect(kickBounce(5.5, [5])).toBeGreaterThan(-1e-4);
    expect(kickBounce(4.9, [5])).toBe(0);
  });

  test('the side camera stays at the side of the train and the cabin camera sits in the car', () => {
    const pose = (t: number) => new THREE.Matrix4().makeTranslation(t * 10, 0, 0);
    const c = new THREE.PerspectiveCamera();
    new RideCam({ pose, mode: 'side' }).apply(c, 4);
    expect(Math.abs(c.position.x - 40)).toBeLessThan(2.5);
    expect(c.position.z).toBeLessThan(-20);
    new RideCam({ pose, mode: [{ at: 0, mode: 'side' }, { at: 5, mode: 'cabin' }] }).apply(c, 6);
    expect(c.position.x).toBeCloseTo(60 - 7.9, 6);
    expect(c.position.y).toBeCloseTo(2.65, 6);
  });

  test('a fixed camera sets its place, lens and near plane', () => {
    const c = new THREE.PerspectiveCamera();
    new FixedCam({ pos: [1, 2, 3], target: [0, 0, 0], fov: 30, near: 0.01 }).apply(c, 123);
    expect(c.position.toArray()).toEqual([1, 2, 3]);
    expect(c.fov).toBe(30);
    expect(c.near).toBe(0.01);
  });
});

describe('v6 click impact', () => {
  const track = new PlayerTrack([{ at: 1, kind: 'open', win: win('a') }, ...clickAt(5, [150, 100])], { cursor: [320, 180] });

  test('a click is recent for a while and names the window it hit', () => {
    expect(track.clicksAt(4.9)).toEqual([]);
    const c = track.clicksAt(5.1)[0]!;
    expect(c).toMatchObject({ at: 5, x: 150, y: 100, winId: 'a' });
    expect(c.age).toBeCloseTo(0.1, 9);
    expect(track.clicksAt(5.6)).toEqual([]);
    expect(track.stateAt(5.1).clicks.length).toBe(1);
  });

  test('the clicked window jumps 1, 2, 1 px and is still after 4 frames', () => {
    const y = (t: number) => track.stateAt(t).windows[0]!.rect[1];
    expect(y(4.99)).toBe(60);
    expect([0, 1, 2, 3, 4].map((f) => y(5 + (f + 0.1) / FPS))).toEqual([59, 58, 59, 60, 60]);
  });

  test('a click outside every window names none', () => {
    const t = new PlayerTrack(clickAt(5, [10, 10]));
    expect(t.clicksAt(5.01)[0]!.winId).toBeUndefined();
  });
});

describe('v6 handle drag', () => {
  const track = new PlayerTrack([{ at: 10, kind: 'handle', id: 'h', to: [300, 100], dur: 0.5, snap: [310, 90] }], { cursor: [200, 200] });

  test('there is no handle before the first drag; the handle follows the cursor 1:1 while held', () => {
    expect(track.handleAt('h', 9)).toBeNull();
    const h = track.handleAt('h', 10.25)!;
    const c = track.cursorAt(10.25);
    expect(h.phase).toBe('held');
    expect(h.pos).toEqual([c.x, c.y]);
    expect(h.u).toBeGreaterThan(0);
    expect(h.u).toBeLessThan(1);
  });

  test('it snaps at the release and then rests on the snap place', () => {
    const s = track.handleAt('h', 10.5 + 0.5 / FPS)!;
    expect(s.phase).toBe('snapped');
    expect(s.since).toBeCloseTo(0.5 / FPS, 9);
    expect(track.handleAt('h', 11)!.pos).toEqual([310, 90]);
    expect(track.stateAt(11).handles.length).toBe(1);
  });

  test('without a snap it is released where the drag ended', () => {
    const t = new PlayerTrack([{ at: 10, kind: 'handle', id: 'h', to: [300, 100], dur: 0.5 }], { cursor: [200, 200] });
    expect(t.handleAt('h', 12)).toMatchObject({ phase: 'released', pos: [300, 100] });
  });
});

describe('v6 tooltip', () => {
  const track = new PlayerTrack([{ at: 5, kind: 'tip', text: 'あした', times: [5.1, 5.2, 5.3] }, { at: 9, kind: 'tip', text: null }], { cursor: [100, 100] });

  test('the text shows unit by unit and the box has the size of the whole text', () => {
    expect(track.tipAt(4)).toBeNull();
    expect(track.tipAt(5.05)).toMatchObject({ text: '', full: 'あした', anchor: [100, 100] });
    expect(track.tipAt(5.15)!.text).toBe('あ');
    expect(track.tipAt(5.25)!.text).toBe('あし');
    expect(track.tipAt(6)!.text).toBe('あした');
    expect(track.tipAt(9.5)).toBeNull();
  });

  test('a time for every unit is required', () => {
    expect(() => new PlayerTrack([{ at: 5, kind: 'tip', text: 'あした', times: [5.1] }])).toThrow(/3 units and 1 times/);
  });
});

describe('v6 security cam', () => {
  const cam = { id: 'c', title: '[HOUSE]', rect: [100, 60, 300, 200] as WinSpec['rect'], body: { kind: 'view' as const, views: 2 }, cam: { labels: ['CAM 01', 'CAM 02'] } };
  const track = new PlayerTrack([{ at: 1, kind: 'open', win: cam }, { at: 5, kind: 'cam', id: 'c', cam: 1 }]);

  test('a cam input cuts to the feed at once and the label follows', () => {
    expect(track.stateAt(4.9).windows[0]!.cam).toMatchObject({ index: 0, label: 'CAM 01' });
    expect(track.stateAt(5.0).windows[0]!).toMatchObject({ view: 1, cam: { index: 1, label: 'CAM 02' } });
  });

  test('the time stamp counts on from the open time and REC blinks at 1 Hz', () => {
    expect(track.stateAt(11).windows[0]!.cam!.stamp).toBe('23:41:17');
    expect(track.stateAt(10.1).windows[0]!.cam!.rec).toBe(true);
    expect(track.stateAt(10.6).windows[0]!.cam!.rec).toBe(false);
  });

  test('a cam input needs a cam window and a feed that exists', () => {
    expect(() => new PlayerTrack([{ at: 1, kind: 'open', win: cam }, { at: 5, kind: 'cam', id: 'c', cam: 2 }])).toThrow(/2 feeds/);
    expect(() => new PlayerTrack([{ at: 1, kind: 'open', win: win('a') }, { at: 5, kind: 'cam', id: 'a', cam: 0 }])).toThrow(/has no cam/);
  });
});

describe('v6 refused close and refused drag', () => {
  const track = new PlayerTrack([
    { at: 1, kind: 'open', win: win('a') },
    { at: 5, kind: 'denyClose', id: 'a' },
    { at: 8, kind: 'dragWindow', id: 'a', by: [100, 0], dur: 0.4, spring: true },
  ]);

  test('the [x] is red for 6 frames, the status reads CANNOT CLOSE for 1 s, the window jerks and settles', () => {
    const s = (t: number) => track.stateAt(t).windows[0]!;
    expect(s(5 + 0.1 / FPS)).toMatchObject({ closeFlash: true, status: 'CANNOT CLOSE', denied: true });
    expect(s(5 + 0.1 / FPS).rect[0]).toBe(104);
    expect(s(5 + 1.1 / FPS).rect[0]).toBe(97);
    expect(s(5.4)).toMatchObject({ closeFlash: false, status: 'CANNOT CLOSE' });
    expect(s(5.4).rect[0]).toBe(100);
    expect(s(6.1)).toMatchObject({ denied: false, status: '' });
  });

  test('a refused drag follows the cursor, then springs back to its place with a small overshoot', () => {
    const x = (t: number) => track.stateAt(t).windows[0]!.rect[0];
    expect(x(8.4)).toBe(200);
    const back = [8.45, 8.5, 8.55, 8.6, 8.7].map(x);
    expect(back[0]!).toBeLessThan(200);
    expect(Math.min(...back)).toBeLessThan(100);
    expect(Math.min(...back)).toBeGreaterThan(70);
    expect(x(9.5)).toBe(100);
  });
});

describe('v6 tools', () => {
  test('every v6 tool has its own button in the top bar, right of the menu buttons', () => {
    const rects = V6_TOOLS.map(toolButton);
    expect(new Set(rects.map((r) => r[0])).size).toBe(V6_TOOLS.length);
    for (const r of rects) { expect(r[1]).toBe(2); expect(r[0]).toBeGreaterThan(4 + 7 * 22); }
    expect(toolButton('scissors')[1]).toBeGreaterThan(300);
  });
});

describe('v6 ride cam swing', () => {
  const pose = () => new THREE.Matrix4();
  const eye = (cam: RideCam, t: number) => { const c = new THREE.PerspectiveCamera(); cam.apply(c, t); return c.position.clone(); };
  const swing = new RideCam({ pose, mode: [{ at: 0, mode: 'chase34' }, { at: 5, mode: 'side', swing: 1 }] });
  const chase = new RideCam({ pose, mode: 'chase34' });
  const side = new RideCam({ pose, mode: 'side' });

  test('before the swing it is the first mode and after it the second', () => {
    expect(eye(swing, 4.9).distanceTo(eye(chase, 4.9))).toBeLessThan(1e-9);
    expect(eye(swing, 5).distanceTo(eye(chase, 5))).toBeLessThan(1e-9);
    expect(eye(swing, 6.1).distanceTo(eye(side, 6.1))).toBeLessThan(1e-9);
  });

  test('in between the eye is on neither, and a swing is a pure function of t', () => {
    const mid = eye(swing, 5.5);
    expect(mid.distanceTo(eye(chase, 5.5))).toBeGreaterThan(1);
    expect(mid.distanceTo(eye(side, 5.5))).toBeGreaterThan(1);
    expect(eye(swing, 5.5).distanceTo(mid)).toBe(0);
  });
});

describe('v6 romaji of the ko lane', () => {
  test('the units of a ko line carry their romaji and the word breaks', () => {
    const ko = loadLanes().ko.lines[0]!;
    const r = unitRomaji(ko);
    expect(r.map((x) => x.text).join('')).toBe('kuromagurogatondekuru');
    expect(r.filter((x) => x.space).map((x) => x.text)).toEqual(['ga', 'to']);
  });

  test('every unit of every ko and ca line has a romaji piece', () => {
    const lanes = loadLanes();
    for (const l of [...lanes.ko.lines, ...lanes.ca.lines]) expect(unitRomaji(l).length).toBe(l.written!.units.length);
  });
});

describe('v6 missing texture', () => {
  const mk = () => {
    const g = new THREE.Group();
    const orig = new THREE.MeshBasicMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1), orig);
    const b = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), orig, 3);
    g.add(a, b);
    return { g, a, b, orig };
  };

  test('it swaps the materials of every mesh, instanced ones too, and back', () => {
    const { g, a, b, orig } = mk();
    setMissing(g, true);
    expect(a.material).not.toBe(orig);
    expect(b.material).not.toBe(orig);
    setMissing(g, true);
    setMissing(g, false);
    expect(a.material).toBe(orig);
    expect(b.material).toBe(orig);
  });

  test('by time spans: a frame depends only on t', () => {
    const { g, a, orig } = mk();
    const spans = [[2, 3], [5, 6]] as const;
    missingAt(g, spans, 2.5);
    expect(a.material).not.toBe(orig);
    missingAt(g, spans, 4);
    expect(a.material).toBe(orig);
    missingAt(g, spans, 5.5);
    expect(a.material).not.toBe(orig);
    missingAt(g, spans, 2.5);
    expect(a.material).not.toBe(orig);
  });
});

describe('v7 developer console', () => {
  const track = () => new PlayerTrack([{ at: 2, kind: 'console', cmd: 'sv_wind 0', reply: 'sv_wind = 0.0' }]);

  test('snaps open in two frames, types the command, fires on Enter with the cursor at the end of the command, snaps shut', () => {
    const tr = track();
    const tm = consoleTimes(2, 'sv_wind 0');
    expect(tr.consoleAt(1.99)).toBeNull();
    expect(tr.consoleAt(2 + 0.5 / FPS)!.drop).toBe(0.5);
    expect(tr.consoleAt(2 + 2 / FPS + 1e-6)!.drop).toBe(1);
    const mid = tr.consoleAt(tm.typed[3]! + 0.001)!;
    expect(mid.text).toBe('sv_w');
    expect(mid.fired).toBe(false);
    expect(mid.reply).toBeNull();
    const fired = tr.consoleAt(tm.enter + 0.01)!;
    expect(fired.fired).toBe(true);
    expect(fired.text).toBe('sv_wind 0');
    expect(fired.reply).toBe('sv_wind = 0.0');
    expect(tr.consoleAt(tm.close + 3 / FPS)).toBeNull();
  });

  test('the key times are in order and about 11 keys a second; the typed command has one time per key', () => {
    const tm = consoleTimes(2, 'sv_wind 0');
    expect(tm.typed).toHaveLength(9);
    for (let k = 1; k < tm.typed.length; k++) {
      const dt = tm.typed[k]! - tm.typed[k - 1]!;
      expect(dt).toBeGreaterThanOrEqual(0.07);
      expect(dt).toBeLessThanOrEqual(0.11);
    }
    expect(tm.enter).toBeGreaterThan(tm.typed[8]!);
  });

  test('a scene reads the entered command at the Enter time and no earlier', () => {
    const tr = track();
    const tm = consoleTimes(2, 'sv_wind 0');
    expect(tr.commandTime('sv_wind 0')).toBe(tm.enter);
    expect(tr.commandTime('sv_gravity 0')).toBeNull();
    expect(tr.stateAt(tm.enter - 1e-3).commands).toHaveLength(0);
    const after = tr.stateAt(tm.enter + 0.5).commands;
    expect(after).toHaveLength(1);
    expect(after[0]!.cmd).toBe('sv_wind 0');
    expect(after[0]!.age).toBeCloseTo(0.5, 6);
  });

  test('a console that opens before the one before it has risen is refused', () => {
    expect(() => new PlayerTrack([
      { at: 2, kind: 'console', cmd: 'a' },
      { at: 2.5, kind: 'console', cmd: 'b' },
    ])).toThrow(/risen/);
  });

  test('the history grows over two consoles: what was entered before stands above the prompt', () => {
    const tr = new PlayerTrack([{ at: 2, kind: 'console', cmd: 'a', reply: 'ok a' }, { at: 8, kind: 'console', cmd: 'b' }]);
    const tm = consoleTimes(8, 'b');
    const c = tr.consoleAt(tm.enter + 0.01)!;
    expect(c.lines.slice(-2)).toEqual([']a', 'ok a']);
    expect(c.text).toBe('b');
    expect(c.reply).toBeNull();
  });
});

describe('v7 pick-up carry', () => {
  const track = () => new PlayerTrack([{ at: 1, kind: 'carry', to: [400, 200], dur: 0.8 }], { cursor: [100, 250] });

  test('grab, carry and drop; the hand is pressed from the grab to the release', () => {
    const tr = track();
    expect(tr.carryAt(0.9)).toBeNull();
    const grab = tr.carryAt(1.05)!;
    expect(grab.phase).toBe('grab');
    expect(grab.lift).toBeGreaterThan(0);
    expect(grab.lift).toBeLessThan(1);
    const carry = tr.carryAt(1.4)!;
    expect(carry.phase).toBe('carry');
    expect(carry.lift).toBe(1);
    expect(tr.stateAt(1.4).cursor.down).toBe(true);
    const drop = tr.carryAt(1.9)!;
    expect(drop.phase).toBe('drop');
    expect(drop.since).toBeCloseTo(0.1, 6);
    expect(tr.stateAt(1.9).cursor.down).toBe(false);
    expect(tr.carryAt(1.8 + 1.6)).toBeNull();
  });

  test('the object lags the hand: it swings back while the hand speeds up, within the soft limit', () => {
    const tr = track();
    expect(tr.carryAt(1.3)!.swing).toBeLessThan(-0.02);
    for (let t = 1; t <= 3.3; t += 0.05) expect(Math.abs(tr.carryAt(t)?.swing ?? 0)).toBeLessThanOrEqual(1.15);
  });

  test('the swing is a pure function of t', () => {
    const a = track().carryAt(1.55)!, b = track().carryAt(1.55)!;
    expect(a.swing).toBe(b.swing);
    expect(track().carryAt(1.55)!.swing).toBe(a.swing);
  });
});

describe('v7 fish cam', () => {
  test('it looks at the sardine from behind on the aisle side and moves with the car', () => {
    const car = (t: number) => new THREE.Matrix4().makeTranslation(10 * t, 0, 0);
    const cam = new FishCam({ pose: car, fish: () => [1, 2, 0.5], window: 1, lag: 0 });
    const c0 = new THREE.PerspectiveCamera(), c1 = new THREE.PerspectiveCamera();
    cam.apply(c0, 0);
    cam.apply(c1, 1);
    // behind the fish (-x), a little above it, on the aisle side (-z for window +z)
    expect(c0.position.x).toBeLessThan(1);
    expect(c0.position.y).toBeGreaterThan(2);
    expect(c0.position.z).toBeLessThan(0.5);
    // one second later the car has moved 10 m and the camera with it
    expect(c1.position.x - c0.position.x).toBeCloseTo(10, 6);
    // the window on the other side mirrors the camera in z
    const mirrored = new FishCam({ pose: car, fish: () => [1, 2, -0.5], window: -1, lag: 0 });
    const c2 = new THREE.PerspectiveCamera();
    mirrored.apply(c2, 0);
    expect(c2.position.z).toBeCloseTo(-c0.position.z, 6);
  });
});

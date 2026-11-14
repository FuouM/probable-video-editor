// The two games of chorus 3 (`chorus3.ts`): a tuna dives at a thing of the world for each syllable of the `ko` lines 8-15. First
// half: the typing game (the syllable and its key on a plate; typed in time, the tuna breaks up into scales of light; too late, it
// hits). Second half (149.333): the DIVA game, where every note hits. When the track ahead is in the picture, a tuna takes it and the
// train jumps the gap. `schedule` places every tuna once, with the camera of each moment; a frame depends only on t.
import * as THREE from 'three';
import type { Line } from '@pve/engine/lyrics';
import { v3 } from '@pve/engine/lit';
import { hashSin, mulberry32 } from '@pve/engine/util';
import { bar } from './_time';
import { unitRomaji } from './_typing';
import { GROUND_Y } from './_station';
import { DIVE, SINK, type Fall } from './_c3fall';
import { unloadAt } from './_c3unload';
import { T_EXIT, xAt, type Target } from './_c3stage';
import type { C3Ride } from './_c3ride';

/** The DIVA game starts on きのう (bar 85). */
export const T_DIVA = bar(85);
const TYPE_FLIGHT = 1.5, TYPE_SPEED = 22, NOTE_FLIGHT = 1.4, NOTE_SPEED = 30, NOTE_LATE = 0.4;
/** The typing game by `ko` line: how late the player types (s), and the share of the tuna that get through. The player fights to the end, and loses more each line. */
const TYPE_LAG = [0.35, 0.55, 0.8, 1.0] as const;
const TYPE_MISS = [0.25, 0.4, 0.5, 0.55] as const;
/** The DIVA ring shows this long (s) before its note; a judgement stays this long after it. */
export const RING_LEAD = 1.0, JUDGE_HOLD = 0.6;
/** The DIVA game: every note hits its thing. The word at the ring is the player's timing: the share of MISS by line. */
const DIVA_MISS = [0.2, 0.3, 0.45, 0.6] as const;
/** The two tuna that take the track ahead of the train: the `ko` line and the unit. */
const TRACK_HITS: readonly (readonly [number, number])[] = [[2, 3], [6, 2]];

/** The game side of a tuna: its syllable, the game, the judgement, when it is done (stopped or hit) and the key of the player. */
export interface Meta { line: number; unit: number; s: number; diva: boolean; word: 'HIT' | 'COOL' | 'FINE' | 'MISS'; done: number; key: string }

/** The place of p in the picture of `cam` (-1..1 on each axis), or null when it is not inside `m` of the picture or is behind the camera. */
function ndc(cam: THREE.PerspectiveCamera, p: THREE.Vector3, m: number): THREE.Vector3 | null {
  const q = p.clone().project(cam);
  return q.z < 1 && Math.abs(q.x) < m && Math.abs(q.y) < m ? q : null;
}

/** One tuna to place: its time, whether it takes the track, its hashes, the cameras of its hit and its dive, and the score of a place. */
interface Shot { ti: number; onTrack: boolean; h1: number; h2: number; cams: THREE.PerspectiveCamera[]; score: (p: THREE.Vector3) => number }

/**
 * Where a tuna dives: a thing (or a place on the ground) that the camera has in the picture from the start of the dive to the hit, with
 * the fish in the picture on its way down. The track ahead when this tuna takes it; else a thing near the line that is still loaded (the
 * houses first); else the ground near the train; else the ground where the camera looks.
 */
function placeHit(s: Shot, targets: readonly Target[], used: Set<number>, ride: C3Ride): { hit: THREE.Vector3; roof: boolean } {
  let hit: THREE.Vector3 | null = null, roof = false, bd = Infinity;
  if (s.onTrack) {
    for (let a = 8; a <= 60; a += 4) {
      const p = v3(xAt(s.ti) - a, 0.2, 0), d = s.score(p);
      if (d < bd) { bd = d; hit = p; }
    }
    if (hit) ride.gaps.push(hit.x);
  }
  // the track ahead is not in the picture: the tuna takes a thing near the line
  if (!hit) {
    let best = -1;
    for (const [i, q] of targets.entries()) {
      // still loaded when the tuna comes down. The tuna go for the houses: any house in the picture beats the rest
      if (used.has(i) || unloadAt(q.p.x, q.p.z) < s.ti + 0.5) continue;
      const d = s.score(q.p) - (q.what === 'house' ? 10 : 5);
      if (d < bd) { bd = d; best = i; hit = q.p.clone(); roof = q.roof; }
    }
    // no thing in the picture: the ground near the train (late in the chorus the world is gone a few metres behind it)
    if (best < 0) {
      for (let ahead = -150; ahead <= 60; ahead += 6) for (let left = -66; left <= 66; left += 6) {
        if (Math.abs(left) < 6) continue;
        const p = ride.routeAt(s.ti, ahead + 4 * s.h1, left);
        p.y = GROUND_Y;
        if (unloadAt(p.x, p.z) < s.ti + 0.4) continue;
        const d = s.score(p);
        if (d < bd) { bd = d; hit = p; roof = false; }
      }
    }
    if (best >= 0) used.add(best);
  }
  // the camera swings too fast for any of them: the ground where the camera looks at the hit, a little below the middle of the picture
  if (!hit) {
    const want = -0.55 + 1.1 * s.h2;
    const c = s.cams[0]!, ray = new THREE.Vector3(0.6 * want, -0.35, 0.5).unproject(c).sub(c.position);
    hit = c.position.clone().addScaledVector(ray, (GROUND_Y - c.position.y) / Math.min(-1e-3, ray.y));
  }
  return { hit, roof };
}

/**
 * A tuna for each syllable of the `ko` lines 8-15: the thing that it dives at, whether the player stops it, and when it hits.
 * `targets`: the things of the straight and the roofs of the town of chorus 2, in the stage frame. The gaps in the track go to `ride`.
 */
export function schedule(ko: readonly Line[], targets: readonly Target[], ride: C3Ride): { falls: Fall[]; meta: Meta[] } {
  const rnd = mulberry32(0x7a11);
  const used = new Set<number>();
  const falls: Fall[] = [], meta: Meta[] = [];
  ko.forEach((l, L) => {
    const diva = l.start >= T_DIVA - 1e-3;
    const rom = unitRomaji(l);
    l.written!.units.forEach((u, k) => {
      const s = u.start;
      const ti = s + (diva ? NOTE_LATE : TYPE_FLIGHT);
      const h1 = hashSin(L * 31 + k, 5), h2 = hashSin(L * 31 + k, 9);
      const onTrack = ti > T_EXIT + 2 && TRACK_HITS.some(([a, b]) => a === L && b === k);
      // the typing game: a tuna that is not typed in time hits. The DIVA game: every note hits
      const miss = onTrack || h1 < (diva ? DIVA_MISS[L - 4]! : TYPE_MISS[L]!);
      // the camera is known for every time: the mark is where the camera goes to
      const flight = diva ? NOTE_FLIGHT : TYPE_FLIGHT, speed = diva ? NOTE_SPEED : TYPE_SPEED;
      const cams = [ti, ti - flight, ti - 0.4 * flight].map((at) => ride.camAt(at));
      const want = -0.55 + 1.1 * h2;
      // the hit must be in the picture. The mark at the start of the dive and the fish on its way down should be: a place that misses them scores worse
      const score = (p: THREE.Vector3): number => {
        const a = ndc(cams[0]!, p, 0.8);
        if (!a) return Infinity;
        const b = ndc(cams[1]!, p, 0.85), c = ndc(cams[2]!, p.clone().addScaledVector(DIVE, -0.4 * speed * flight), 0.9);
        return Math.abs(a.x - want) + (b ? 0 : 4) + (c ? 0 : 2);
      };
      const { hit, roof } = placeHit({ ti, onTrack, h1, h2, cams, score }, targets, used, ride);
      // a tuna whose place is gone by its time hits nothing
      const gone = unloadAt(hit.x, hit.z) < ti + 0.3;
      let breakAt: number | undefined;
      if (!diva && !miss) breakAt = s + Math.min(TYPE_FLIGHT - 0.25, TYPE_LAG[L]! * (0.7 + 0.6 * h2));
      else if (gone) breakAt = ti - 0.05;
      falls.push({
        ti, kind: roof ? 'roof' : 'platform', yellow: diva && k % 2 === 0, nose: hit.clone().addScaledVector(DIVE, SINK), hit, phi: 0, gh: hit.y - GROUND_Y,
        hero: false, line: -1, note: { line: L, unit: k }, curve: diva ? (k % 2 === 0 ? 1 : -1) * (5 + 3 * rnd()) : 0,
        flight: diva ? NOTE_FLIGHT : TYPE_FLIGHT, speed: diva ? NOTE_SPEED : TYPE_SPEED, ...(breakAt !== undefined ? { breakAt } : {}),
      });
      meta.push({ line: L, unit: k, s, diva, word: miss ? 'MISS' : !diva ? 'HIT' : h2 < 0.45 ? 'FINE' : 'COOL', done: breakAt === undefined ? ti : breakAt, key: diva ? 'ASDF'[k % 4]! : rom[k]!.text.toUpperCase() });
    });
  });
  return { falls, meta };
}

/** The score at t: the typed and the missed tuna of the typing game, and the combo of the DIVA game. */
export function score(meta: readonly Meta[], t: number): { hit: number; miss: number; combo: number } {
  let hit = 0, miss = 0, combo = 0;
  meta.forEach((m) => {
    if (m.diva) { if (t >= m.s) combo = m.word === 'MISS' ? 0 : combo + 1; return; }
    if (t < m.done) return;
    if (m.word === 'MISS') miss++; else hit++;
  });
  return { hit, miss, combo };
}

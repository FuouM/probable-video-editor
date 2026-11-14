// `pve perf`: real-time cost of every frame of clips, played as the live preview plays them.
// `bench` samples a few frames on the GPU. A scene that redraws Canvas2D layers on the CPU can pass it and
// still drop frames in the preview. `perf` plays the clip one frame per requestAnimationFrame, in time
// order, and records the CPU time of each render call and the interval between animation frames. A frame
// that misses a display refresh shows as an interval of two refreshes or more.
// The 2D canvas is the software canvas of every headless render (as `Layer2D` asks for with
// willReadFrequently), so the CPU time holds the whole Canvas2D cost of a frame. `--gpu-canvas` keeps the GPU
// 2D canvas instead: in headless Chrome its raster and copies wait for the compositor and read 30-40 ms in
// every page scene, so use it only to compare.
import { withPage, type PveWindow } from './browser';

export interface PerfOptions {
  project: string;
  clips: { id: string; start: number; end: number }[];
  fps: number;
  /** Walk every n-th frame (1: every frame). */
  step: number;
  /** Record a CPU profile of each clip's walk: the functions with the most self time. */
  profile: boolean;
  /** The GPU 2D canvas instead of the software canvas (to compare). */
  gpuCanvas: boolean;
  /** Include frame-by-frame details in each row. */
  frames?: boolean;
  /**
   * Count what three does in each frame: render calls, draw calls, and the times that it looks the program of a material up again
   * (with the property of the material that made it do so). The counters cost time: the times of such a run are not a measure.
   */
  draws: boolean;
}

export interface PerfFrame {
  n: number;
  t: number;
  cpu: number;
  interval: number;
  tag?: string;
  missed: boolean;
}

/** Median, p90 and max of one measure, in ms. */
export interface PerfStat {
  median: number;
  p90: number;
  max: number;
}

export interface PerfRow {
  clip: string;
  frames: number;
  /** CPU time of the render call. */
  cpu: PerfStat;
  /** Interval between animation frames. */
  interval: PerfStat;
  /** Frames that missed at least one display refresh (interval over 1.5 refreshes). */
  missed: number;
  /** Frames per second the clip played at (frames over the summed intervals). */
  fps: number;
  /** The longest intervals: [time s, ms, lyric tag?]. */
  worst: [number, number, string?][];
  /** With `profile`: [function, file:line, self ms], most first. */
  hot?: [string, string, number][];
  /** Frame details when `frames` option is enabled. */
  detail?: PerfFrame[];
  /**
   * With `draws`: means per frame. `lookups`: [cause, count], most first. A cause that starts with `shadow` is in the shadow pass.
   * `compiled`: the programs that three made during the walk (time, material, object): a frame of the clip paid for each compile.
   */
  counts?: { renders: number; draws: number; shadowDraws: number; lookups: [string, number][]; compiled: string[] };
}

export interface PerfResult {
  /** Display refresh of the page with nothing rendered (median rAF interval), ms. */
  refreshMs: number;
  rows: PerfRow[];
}

function stat(xs: number[]): PerfStat {
  const s = [...xs].sort((a, b) => a - b);
  return {
    median: +(s[Math.floor(0.5 * s.length)] ?? 0).toFixed(2),
    p90: +(s[Math.floor(0.9 * s.length)] ?? 0).toFixed(2),
    max: +(s[s.length - 1] ?? 0).toFixed(2),
  };
}

export async function runPerf(o: PerfOptions): Promise<PerfResult> {
  const only = o.clips.map((c) => c.id).join(',');
  return withPage(o.project, { only, gpuCanvas: o.gpuCanvas }, async (page) => {
    // the refresh with an idle page: 60 animation frames, nothing rendered
    const refreshMs: number = await page.evaluate(async () => {
      const ts: number[] = [];
      for (let i = 0; i < 61; i++) {
        const { promise, resolve } = Promise.withResolvers<number>();
        requestAnimationFrame(resolve);
        ts.push(await promise);
      }
      const d = ts.slice(1).map((t, i) => t - ts[i]!).sort((a, b) => a - b);
      return d[Math.floor(d.length / 2)]!;
    });
    const cdp = o.profile ? await page.context().newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    }
    const rows: PerfRow[] = [];
    for (const c of o.clips) {
      if (cdp) await cdp.send('Profiler.start');
      const { ms, counts } = await page.evaluate(async ({ start, end, fps, step, draws }) => {
        const p = (window as unknown as PveWindow).__pve!;
        const n0 = Math.ceil(start * fps), n1 = Math.floor(end * fps);
        const frame = () => {
          const { promise, resolve } = Promise.withResolvers<number>();
          requestAnimationFrame(resolve);
          return promise;
        };
        // warm-up: the first frame of a clip pays its lazy set-up once
        p.still(n0 / fps);
        for (let i = 0; i < 5; i++) await frame();
        const out: { n: number; t: number; cpu: number; interval: number; tag?: string }[] = [];
        // the counters: three keeps, for each material, the facts that its program came from. A fact that is new after a draw made
        // three look the program up again (WebGLRenderer.setProgram)
        const r = (p.engine as unknown as { renderer: CountRenderer }).renderer;
        const FACTS = ['currentProgram', 'instancing', 'instancingColor', 'lightsStateVersion', 'fog', 'environment', 'toneMapping', 'outputColorSpace', '__version'] as const;
        const counts = { renders: 0, draws: 0, shadowDraws: 0, lookups: {} as Record<string, number>, compiled: [] as string[] };
        let tNow = n0 / fps;
        const baseDraw = r.renderBufferDirect, baseRender = r.render;
        if (draws) {
          r.render = (scene, camera) => { counts.renders++; baseRender(scene, camera); };
          r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
            const props = r.properties.get(material);
            const before = FACTS.map((k) => props[k]);
            const programs = r.info.programs ? r.info.programs.length : 0;
            baseDraw(camera, scene, geometry, material, object, group);
            // a program that three made in this draw: a frame of the clip paid for its compile
            if (r.info.programs && r.info.programs.length > programs) counts.compiled.push(`${tNow.toFixed(3)} ${material.type} "${material.name}" (side ${material.side}) on ${object.type} "${object.name}"${scene === null ? ', shadow pass' : ''}`);
            counts.draws++;
            // (the shadow pass draws with no scene)
            if (scene === null) counts.shadowDraws++;
            FACTS.forEach((k, i) => {
              if (props[k] === before[i]) return;
              const cause = `${scene === null ? 'shadow ' : ''}${before[0] === undefined ? 'first use' : k === 'currentProgram' ? 'other program' : k}`;
              if (before[0] === undefined && k !== 'currentProgram') return;
              counts.lookups[cause] = (counts.lookups[cause] ?? 0) + 1;
            });
          };
        }
        let last = await frame();
        for (let n = n0; n < n1; n += step) {
          const tCur = n / fps;
          tNow = tCur;
          const w0 = performance.now();
          p.still(tCur);
          const cpu = performance.now() - w0;
          const now = await frame();
          let tag: string | undefined;
          const lyr = p.engine?.lyrics;
          if (lyr) {
            const line = lyr.lineAt(tCur);
            if (line) {
              const word = lyr.wordNow(line, tCur);
              tag = word ? `L${line.i}:${word.w.w}` : `L${line.i}`;
            }
          }
          out.push({ n, t: tCur, cpu, interval: now - last, tag });
          last = now;
        }
        r.renderBufferDirect = baseDraw;
        r.render = baseRender;
        return { ms: out, counts };
      }, { start: c.start, end: c.end, fps: o.fps, step: o.step, draws: o.draws });
      const hot = cdp ? selfTimes((await cdp.send('Profiler.stop')).profile) : undefined;
      const sum = ms.reduce((a, m) => a + m.interval, 0);
      rows.push({
        clip: c.id,
        frames: ms.length,
        cpu: stat(ms.map((m) => m.cpu)),
        interval: stat(ms.map((m) => m.interval)),
        missed: ms.filter((m) => m.interval > 1.5 * refreshMs).length,
        fps: +(sum ? (1000 * ms.length) / sum : 0).toFixed(1),
        worst: [...ms].sort((a, b) => b.interval - a.interval).slice(0, 5).map((m) => {
          const w: [number, number, string?] = [+m.t.toFixed(3), +m.interval.toFixed(1)];
          if (m.tag) w.push(m.tag);
          return w;
        }),
        ...(hot ? { hot } : {}),
        ...(o.draws ? {
          counts: {
            renders: +(counts.renders / ms.length).toFixed(1), draws: +(counts.draws / ms.length).toFixed(1), shadowDraws: +(counts.shadowDraws / ms.length).toFixed(1),
            lookups: Object.entries(counts.lookups).map(([k, v]): [string, number] => [k, +(v / ms.length).toFixed(1)]).sort((a, b) => b[1] - a[1]),
            compiled: counts.compiled,
          },
        } : {}),
        ...(o.frames ? {
          detail: ms.map((m) => ({
            n: m.n,
            t: +m.t.toFixed(3),
            cpu: +m.cpu.toFixed(2),
            interval: +m.interval.toFixed(2),
            tag: m.tag,
            missed: m.interval > 1.5 * refreshMs,
          })),
        } : {}),
      });
    }
    return { refreshMs: +refreshMs.toFixed(2), rows };
  });
}

/** The parts of the page's renderer that the counters of `draws` use. */
type CountProps = Record<string, unknown>;
interface CountMaterial { type: string; name: string; side: number }
interface CountObject { type: string; name: string }
interface CountRenderer {
  render(scene: unknown, camera: unknown): void;
  renderBufferDirect(camera: unknown, scene: unknown, geometry: unknown, material: CountMaterial, object: CountObject, group: unknown): void;
  properties: { get(material: CountMaterial): CountProps };
  info: { programs: unknown[] | null };
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[];
  samples?: number[];
  timeDeltas?: number[];
}

/** Self time per function (summed over its call sites), the 15 largest. Times in ms. */
function selfTimes(p: CpuProfile): [string, string, number][] {
  const byNode = new Map(p.nodes.map((n) => [n.id, n.callFrame]));
  const self = new Map<string, number>();
  const samples = p.samples ?? [], deltas = p.timeDeltas ?? [];
  // a sample's time is the delta to the next sample
  for (let i = 0; i < samples.length; i++) {
    const f = byNode.get(samples[i]!)!;
    const file = f.url ? `${f.url.replace(/^.*\/(?=[^/]+$)/, '').replace(/\?.*$/, '')}:${f.lineNumber + 1}` : '';
    const key = `${f.functionName || '(anonymous)'}\t${file}`;
    self.set(key, (self.get(key) ?? 0) + (deltas[i + 1] ?? 0) / 1000);
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, ms]) => {
    const [fn, file] = k.split('\t') as [string, string];
    return [fn, file, +ms.toFixed(1)];
  });
}

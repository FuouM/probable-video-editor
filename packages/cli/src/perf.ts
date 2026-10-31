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
      const ms = await page.evaluate(async ({ start, end, fps, step }) => {
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
        const out: { t: number; cpu: number; interval: number; tag?: string }[] = [];
        let last = await frame();
        for (let n = n0; n < n1; n += step) {
          const tCur = n / fps;
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
          out.push({ t: tCur, cpu, interval: now - last, tag });
          last = now;
        }
        return out;
      }, { start: c.start, end: c.end, fps: o.fps, step: o.step });
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
      });
    }
    return { refreshMs: +refreshMs.toFixed(2), rows };
  });
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

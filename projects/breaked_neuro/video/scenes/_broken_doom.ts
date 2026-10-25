// First-person 3D ASCII dungeon corridor stepping in discrete 6 fps ticks in broken (final chorus).
import { BEAT, stepT } from './_kit';
import { ACOLS, AROWS, Grid, Tone } from './_ascii';

export function renderAsciiDoom(
  g: Grid,
  rawT: number,
  tDoom: number,
  placedLine: () => void,
) {
  // Low-fps (6 fps) discrete step time so the corridor advances in stark, chunky, abstract steps
  const td = stepT(rawT, 6);
  const dt = Math.max(0, td - tDoom);
  const stepIdx = Math.round(dt * 6);
  const camZ = stepIdx * 0.55;
  // Discrete stepped turn on every 2 beats
  const turnStep = Math.floor(dt / (2 * BEAT));
  const yaw = Math.sin(turnStep * 1.4) * 0.16;
  const cx = Math.round(ACOLS / 2 - yaw * 48);
  const cy = Math.round(AROWS / 2);

  // Minimalist raycasted corridor: stark vertical/perspective slabs, depth ribs, and a deep blue void core
  for (let q = 0; q < ACOLS; q++) {
    const sx = (q - cx) / (ACOLS * 0.5);
    const absX = Math.abs(sx);
    const dist = 1 / Math.max(0.08, absX);
    const wz = camZ + dist;
    const bay = ((wz % 2.0) + 2.0) % 2.0;
    const isRib = bay < 0.22;
    const isPortal = bay > 0.75 && bay < 1.45 && dist < 6.5;
    const wallH = Math.round(AROWS / Math.max(0.45, dist * 0.55));
    const y0 = cy - Math.floor(wallH / 2);
    const y1 = cy + Math.floor(wallH / 2);

    for (let r = 0; r < AROWS; r++) {
      if (absX < 0.11 && Math.abs(r - cy) < 7) {
        g.set(q, r, ' ', Tone.Blue);
        continue;
      }
      if (r < y0 || r > y1) {
        const vDist = (AROWS * 0.45) / Math.max(1, Math.abs(r - cy));
        const zRung = ((camZ + vDist) % 1.0 + 1.0) % 1.0;
        if (zRung < 0.14 && q % 2 === 0) {
          g.set(q, r, '-', vDist < 3.0 ? Tone.Bright : Tone.Dim);
        } else if (Math.abs(absX - Math.abs(r - cy) / (AROWS * 0.5)) < 0.03) {
          g.set(q, r, (q < cx) === (r < cy) ? '\\' : '/', Tone.Bright);
        }
      } else {
        const topBotEdge = r === y0 || r === y1;
        if (topBotEdge) {
          g.set(q, r, '#', Tone.Bright);
        } else if (isRib) {
          g.set(q, r, '|', dist < 4.0 ? Tone.Bright : Tone.Dim);
        } else if (isPortal && r > y0 + 3 && r < y1 - 3) {
          g.set(q, r, ' ', Tone.Blue);
        } else if ((q + r) % 2 === 0) {
          const ch = dist < 2.2 ? '#' : dist < 4.0 ? '+' : dist < 6.5 ? ':' : '.';
          g.set(q, r, ch, dist < 2.8 ? Tone.Bright : Tone.Dim);
        }
      }
    }
  }

  // Abstract monolithic wireframe/blue gate advancing down the corridor on every bar
  const gateDist = 3.6 - ((camZ % 3.6) + 3.6) % 3.6;
  if (gateDist > 0.45 && gateDist < 3.4) {
    const gw = Math.round(28 / gateDist), gh = Math.round(18 / gateDist);
    for (let r = cy - gh; r <= cy + gh; r++) {
      for (let q = cx - gw; q <= cx + gh; q++) {
        const onFrame = Math.abs(q - cx) >= gw - 1 || Math.abs(r - cy) >= gh - 1;
        if (onFrame) g.set(q, r, '#', Tone.Hole);
      }
    }
  }

  placedLine();
}

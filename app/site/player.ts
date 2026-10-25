// The real-time player of the static site: the engine draws each frame in the visitor's browser, the
// audio clock (Web Audio) sets the song time. Controls: play/pause, seek bar with section ticks, section
// jumps, volume, loop, resolution (0.5x, 1x, 2x), fullscreen and keyboard shortcuts. The look is the NLE's
// (../src/ui/daw.css).
// Resolution is the engine's output SCALE, which it reads once from the page URL: a change reloads the page
// at the same song time.
import { Engine } from '@pve/engine/engine';
import { PW, PH, SCALE } from '@pve/engine/gl';
import { fetchInputs } from '../src/inputs';
import { loadProject, project } from '../src/project';
import { StudioAudioEngine } from '../src/ui/audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const frame = $('frame');
const canvas = $<HTMLCanvasElement>('c');
const splash = $('splash');
const splashPlay = $<HTMLButtonElement>('splash-play');
const splashStatus = $('splash-status');

const svg = (path: string, size = 12, extra = '') => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" ${extra}>${path}</svg>`;
const ICON = {
  start: svg('<path d="M4 4h2v8H4V4zm7.5 4L7 4.5v7l4.5-3.5z"/>'),
  prev: svg('<path d="M10.5 4L6 8l4.5 4V4z"/>'),
  next: svg('<path d="M5.5 4L10 8l-4.5 4V4z"/>'),
  play: svg('<path d="M5 3.5v9l7-4.5-7-4.5z"/>', 14),
  pause: svg('<path d="M4 3.5h3v9H4v-9zm5 0h3v9H9v-9z"/>', 14),
  loop: svg('<path d="M11 1v2A5 5 0 0 0 6 8h2a3 3 0 0 1 3-3V7l4-3-4-3zm-6 8a3 3 0 0 1-3 3V10L1 13l4 3v-2a5 5 0 0 0 5-5H8z"/>'),
  vol: svg('<path d="M2 6v4h3l4 3V3L5 6H2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  mute: svg('<path d="M2 6v4h3l4 3V3L5 6H2z"/><path d="M11 6l4 4m0-4l-4 4" fill="none" stroke="currentColor" stroke-width="1.2"/>'),
  fsOn: svg('<path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 0 1 0V2h3.5a.5.5 0 0 0 0-1h-4zm13 0h-4a.5.5 0 0 0 0 1H14v3.5a.5.5 0 0 0 1 0v-4a.5.5 0 0 0-.5-.5zm-13 14a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 0-1H2v-3.5a.5.5 0 0 0-1 0v4zm13.5 0v-4a.5.5 0 0 0-1 0V14h-3.5a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5z"/>'),
  fsOff: svg('<path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/>'),
};

/** Output scales the player offers: the engine renders 1920x1080 times the scale. */
const RESOLUTIONS = [0.5, 1, 2] as const;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function fail(message: string) {
  splashStatus.textContent = message;
  splashStatus.classList.add('error');
  splashPlay.textContent = 'Unavailable';
}

async function main() {
  canvas.width = PW;
  canvas.height = PH;
  $('mon-res').textContent = `[16:9 \u00b7 ${PW}\u00d7${PH}]`;

  // the song decodes while the scenes load
  const inputs = await fetchInputs();
  const startAt = Math.max(0, parseFloat(new URLSearchParams(location.search).get('t') ?? '') || 0);
  let engine: Engine;
  try {
    engine = new Engine(canvas, loadProject);
  } catch (e) {
    console.error(e);
    return fail('This browser cannot start WebGL2. Try a recent Chrome, Edge, Firefox or Safari.');
  }
  let ended: () => void = () => {};
  const audio = new StudioAudioEngine(inputs.mix, undefined, () => ended());
  await engine.init();
  if (engine.errors.length) console.error(engine.errors.join('\n\n'));
  document.title = project.title;
  $('title').textContent = project.title;
  $('dlg-title').textContent = project.title;

  const duration = engine.duration;
  const sections = inputs.timing.sections;
  let t = clamp(startAt, 0, duration - 0.001);
  let dirty = true; // draw even if t did not change (first frame, after a seek)
  if (t > 0) audio.seek(t); // ?t= (a resolution change reloads the page at the same time)

  // ---------------------------------------------------------------- transport
  const btnPlay = $('btn-play'), btnLoop = $('btn-loop'), btnMute = $('btn-mute'), btnFull = $('btn-full');
  const vol = $<HTMLInputElement>('vol');
  let looping = false;
  const loopEnd = () => (audio.duration > 0 ? Math.min(duration, audio.duration) : duration);
  const applyLoop = () => {
    audio.setLoop(looping ? [0, loopEnd()] : null);
    btnLoop.classList.toggle('active', looping);
    btnLoop.setAttribute('aria-pressed', String(looping));
  };
  const seekTo = (x: number) => {
    t = clamp(x, 0, duration - 0.001);
    audio.seek(t);
    dirty = true;
  };
  const play = async () => {
    if (audio.playing) return;
    applyLoop();
    if (t >= duration - 0.05) seekTo(0);
    await audio.play();
  };
  const toggle = () => (audio.playing ? audio.pause() : void play());
  ended = () => {
    t = 0;
    dirty = true;
  };
  const sectionAt = (x: number) => {
    let i = -1;
    for (let k = 0; k < sections.length; k++) if (sections[k]!.start <= x) i = k;
    return i;
  };
  const prevSection = () => {
    const i = sectionAt(t);
    const cur = sections[i];
    seekTo(cur && t - cur.start > 2 ? cur.start : (sections[i - 1]?.start ?? 0));
  };
  const nextSection = () => {
    const n = sections.find((s) => s.start > t + 0.01);
    if (n) seekTo(n.start);
  };

  // ---------------------------------------------------------------- buttons
  $('btn-start').innerHTML = ICON.start;
  $('btn-prev').innerHTML = ICON.prev;
  $('btn-next').innerHTML = ICON.next;
  btnLoop.innerHTML = ICON.loop;
  $('time-total').textContent = fmt(duration);
  // a click on a button must not move the keyboard focus: Space and the arrows belong to the player
  for (const b of document.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
  btnPlay.addEventListener('click', toggle);
  $('btn-start').addEventListener('click', () => seekTo(0));
  $('btn-prev').addEventListener('click', prevSection);
  $('btn-next').addEventListener('click', nextSection);
  btnLoop.addEventListener('click', () => {
    looping = !looping;
    applyLoop();
  });

  // volume
  let volume = 1, muted = false;
  const applyVolume = () => {
    audio.setVolume(muted ? 0 : volume);
    vol.value = String(muted ? 0 : volume);
    const off = muted || volume === 0;
    btnMute.innerHTML = off ? ICON.mute : ICON.vol;
    btnMute.classList.toggle('active', off);
    btnMute.setAttribute('aria-label', off ? 'Unmute' : 'Mute');
  };
  const setVolume = (v: number) => {
    volume = clamp(v, 0, 1);
    muted = false;
    applyVolume();
  };
  vol.addEventListener('input', () => setVolume(Number(vol.value)));
  vol.addEventListener('change', () => vol.blur());
  btnMute.addEventListener('click', () => {
    muted = !muted;
    applyVolume();
  });
  applyVolume();

  // fullscreen takes the frame (picture and transport). Safari on iPhone has no element fullscreen.
  const canFull = typeof frame.requestFullscreen === 'function';
  btnFull.hidden = !canFull;
  $('menu-fullscreen').hidden = !canFull;
  const toggleFull = () => {
    if (!canFull) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen();
  };
  btnFull.addEventListener('click', toggleFull);
  $('menu-fullscreen').addEventListener('click', toggleFull);
  document.addEventListener('fullscreenchange', () => {
    btnFull.innerHTML = document.fullscreenElement ? ICON.fsOff : ICON.fsOn;
    btnFull.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
    wake();
  });
  btnFull.innerHTML = ICON.fsOn;

  // a click on the picture plays or pauses, a double click toggles fullscreen
  let clickTimer = 0;
  canvas.addEventListener('click', () => {
    if (!splash.hidden) return;
    clearTimeout(clickTimer);
    clickTimer = window.setTimeout(toggle, 220);
  });
  canvas.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    toggleFull();
  });

  // resolution: the page reloads at the same song time
  const res = $<HTMLSelectElement>('res');
  res.innerHTML = RESOLUTIONS.map((s) => `<option value="${s}"${s === SCALE ? ' selected' : ''}>${s}\u00d7  ${1920 * s}\u00d7${1080 * s}</option>`).join('');
  res.addEventListener('change', () => {
    const u = new URL(location.href);
    u.searchParams.set('scale', res.value);
    u.searchParams.set('t', t.toFixed(2));
    location.assign(u);
  });

  // ---------------------------------------------------------------- seek bar
  const seek = $('seek'), seekFill = $('seek-fill'), seekTip = $('seek-tip');
  $('seek-ticks').innerHTML = sections
    .slice(1)
    .map((s) => `<i style="left:${(s.start / duration) * 100}%"></i>`)
    .join('');
  seek.setAttribute('aria-valuemax', String(Math.round(duration)));
  const fracAt = (e: PointerEvent) => {
    const r = seek.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1);
  };
  let dragging = false, resume = false;
  seek.addEventListener('pointerdown', (e) => {
    dragging = true;
    resume = audio.playing;
    if (resume) audio.pause();
    seek.setPointerCapture(e.pointerId);
    seekTo(fracAt(e) * duration);
  });
  seek.addEventListener('pointermove', (e) => {
    const f = fracAt(e), x = f * duration;
    const s = sections[sectionAt(x)];
    seekTip.textContent = s ? `${fmt(x)}  ${s.name}` : fmt(x);
    seekTip.style.left = `${clamp(f * 100, 6, 94)}%`;
    if (dragging) seekTo(x);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    if (resume) void play();
  };
  seek.addEventListener('pointerup', endDrag);
  seek.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- keyboard
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'SELECT' || tag === 'INPUT') return; // the control keeps its own keys
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const step = (dt: number) => seekTo(t + dt);
    if (k === ' ' || k === 'k') toggle();
    else if (k === 'ArrowLeft') step(-5);
    else if (k === 'ArrowRight') step(5);
    else if (k === 'j') step(-10);
    else if (k === 'PageUp') prevSection();
    else if (k === 'PageDown') nextSection();
    else if (k === 'Home') seekTo(0);
    else if (k === 'End') seekTo(duration - 0.5);
    else if (k === 'ArrowUp') setVolume(volume + 0.1);
    else if (k === 'ArrowDown') setVolume(volume - 0.1);
    else if (k === 'm') btnMute.click();
    else if (k === 'f') toggleFull();
    else if (k === 'l') btnLoop.click();
    else if (k >= '0' && k <= '9') seekTo((Number(k) / 10) * duration);
    else return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------- idle: in fullscreen the transport hides while playing
  let idleTimer = 0;
  function wake() {
    frame.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (audio.playing && !dragging) frame.classList.add('idle');
    }, 2500);
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const) frame.addEventListener(ev, wake, { passive: true });

  // ---------------------------------------------------------------- draw loop
  const timeNow = $('time-now'), sectionEl = $('section'), monFps = $('mon-fps'), monMs = $('mon-ms');
  let lastDrawn = -1, shownPlaying: boolean | null = null, renderMs = 0, frameMs = 16.7, lastFrame = performance.now(), lastStats = 0;
  const tick = (now: number) => {
    if (audio.playing) t = audio.currentTime;
    if (audio.playing || dirty || t !== lastDrawn) {
      const t0 = performance.now();
      engine.render(t, 1 / 60);
      renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
      lastDrawn = t;
      dirty = false;
    }
    frameMs = frameMs * 0.95 + (now - lastFrame) * 0.05;
    lastFrame = now;

    if (shownPlaying !== audio.playing) {
      shownPlaying = audio.playing;
      btnPlay.innerHTML = shownPlaying ? ICON.pause : ICON.play;
      btnPlay.classList.toggle('daw-on', shownPlaying);
      btnPlay.setAttribute('aria-label', shownPlaying ? 'Pause' : 'Play');
      wake();
    }
    timeNow.textContent = fmt(t);
    seekFill.style.width = `${(t / duration) * 100}%`;
    seek.setAttribute('aria-valuenow', String(Math.round(t)));
    sectionEl.textContent = sections[sectionAt(t)]?.name ?? '\u2014';
    if (now - lastStats > 500) {
      lastStats = now;
      monFps.textContent = `${(1000 / frameMs).toFixed(0)} FPS`;
      monMs.textContent = `${renderMs.toFixed(1)} ms`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- start
  splashStatus.textContent = engine.errors.length ? `${engine.errors.length} scene(s) failed to load, see the console` : startAt > 0 ? `Resumes at ${fmt(t)}` : '';
  splashPlay.disabled = false;
  splashPlay.textContent = startAt > 0 ? 'Resume' : 'Play';
  splashPlay.addEventListener('click', () => {
    splash.hidden = true;
    void play();
    wake();
  });
  splashPlay.focus();
}

main().catch((e) => {
  console.error(e);
  fail(`Could not load: ${String((e as Error)?.message ?? e)}`);
});

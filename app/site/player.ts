// The real-time player of the static site: the engine draws each frame in the visitor's browser, the
// audio clock (Web Audio) sets the song time. Controls: play/pause, seek bar with section ticks, section
// jumps, volume, loop, speed, video, subtitles (language, word highlight), the options of the project
// (projects/<id>/video/player.ts), resolution (0.5x, 1x, 2x), fullscreen and keyboard shortcuts. The look is the NLE's
// (../src/ui/daw.css).
// Resolution is the engine's output SCALE, which it reads once from the page URL: a change reloads the page
// at the same song time. A video is a project: the palette is baked into the engine modules, so a change of video
// loads the page again with ?project=.
import { Engine, type AdaptiveSampling } from '@pve/engine/engine';
import type { PlayerOption } from '@pve/engine/options';
import { PW, PH, SCALE } from '@pve/engine/gl';
import { DATA, fetchInputs, projectId, siteProjects, type SiteProject } from '../src/inputs';
import { loadProject, project } from '../src/project';
import { lineAt, type SubLine, type SubTrack, type Subtitles } from '../src/subtitles';
import { Loader } from '../src/ui/loader';
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
/** Playback speeds. The audio plays faster or slower with its pitch (the audio engine's varispeed). */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Motion blur: 4 or 12 sub-frames (the sets of the engine's adaptive mode); the clips' own caps still apply. */
const BLUR: Record<string, AdaptiveSampling> = {
  4: { min: 4, max: 4, tol: 3, refine: 'frame' },
  12: { min: 12, max: 12, tol: 3, refine: 'frame' },
};
const STORE = 'pve.player.';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const store = {
  get: (k: string) => { try { return localStorage.getItem(STORE + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(STORE + k, v); } catch { /* private mode: the choice lasts until the page closes */ } },
};

/** Page URL of video `id` at the same output scale. */
function videoUrl(id: string): string {
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('project', id);
  if (SCALE !== 1) u.searchParams.set('scale', String(SCALE));
  return u.toString();
}

// the loading screen is up from the first moment; main() fills it
let loader: Loader | null = null;

function fail(message: string) {
  loader?.fail(message);
  splashStatus.textContent = loader ? '' : message;
  splashStatus.classList.add('error');
  splashPlay.textContent = 'Unavailable';
}

/** The cards of the videos in the start dialog (only with more than one). */
function showVideos(videos: SiteProject[], current: string, always = false) {
  const el = $('videos');
  el.hidden = !always && videos.length < 2;
  el.innerHTML = videos
    .map((v) => `<a class="pl-card${v.id === current ? ' current' : ''}" href="${esc(videoUrl(v.id))}" title="${esc(v.title)}">${v.thumbnail ? `<img src="${DATA}${v.id}/thumbnail.jpg" alt="" loading="lazy" />` : '<span class="pl-card-blank"></span>'}<span>${esc(v.title)}</span></a>`)
    .join('');
}

async function main() {
  if (DATA === undefined) throw new Error('The player needs the site build (vite.site.config.ts): it has no data folder.');
  canvas.width = PW;
  canvas.height = PH;
  $('mon-res').textContent = `[16:9 \u00b7 ${PW}\u00d7${PH}]`;

  const id = projectId();
  const videos = await siteProjects();
  if (!id) {
    // nothing loads until the visitor picks a video: no scenes, no audio, no palette
    frame.classList.add('choose');
    $('dlg-title').textContent = 'Choose a video';
    $('splash-foot').hidden = true;
    showVideos(videos, '', true);
    splash.firstElementChild!.classList.remove('loading');
    return;
  }
  const me = videos.find((v) => v.id === id);
  if (!me) throw new Error(`There is no video "${id}".`);
  document.title = me.title;
  $('title').textContent = me.title;
  $('dlg-title').textContent = me.title;
  showVideos(videos, id);
  const cover = $<HTMLImageElement>('cover');
  if (me.thumbnail) {
    cover.src = `${DATA}${id}/thumbnail.jpg`;
    cover.hidden = false;
  }
  loader = new Loader($('loader-host'), { title: me.title, steps: ['data', 'fonts', 'scenes', 'audio'], diag: `${PW}\u00d7${PH} \u00b7 WebGL2` });
  loader.step('data', 'run', 0.3);

  // the song downloads while the scenes load
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
  const audio = new StudioAudioEngine(inputs.mix, undefined, () => ended(), (f) => loader?.audio(f));
  void audio.ready.then(() => loader?.audio(1, true));

  // the options of the project: a remembered choice takes effect before the first scene loads
  const optionModules = import.meta.glob<{ options: PlayerOption[] }>('../../projects/*/video/player.ts');
  const optionModule = optionModules[`../../projects/${id}/video/player.ts`];
  const options = optionModule ? (await optionModule()).options : [];
  const assetsUrl = `${DATA}${id}/assets/`;
  const chosen = new Map<string, string>();
  for (const o of options) {
    const saved = store.get(`${id}.${o.id}`);
    const v = o.values.some((x) => x.id === saved) ? saved! : o.default;
    chosen.set(o.id, v);
    if (v !== o.default) await o.apply(v, assetsUrl);
  }

  await Promise.all([engine.init(undefined, (p) => loader?.engine(p)), audio.ready]);
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

  // speed
  const speedSel = $<HTMLSelectElement>('speed');
  speedSel.innerHTML = SPEEDS.map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${s}\u00d7</option>`).join('');
  const setSpeed = (i: number) => {
    const k = clamp(i, 0, SPEEDS.length - 1);
    speedSel.value = String(SPEEDS[k]);
    audio.setPlaybackRate(SPEEDS[k]!);
  };
  speedSel.addEventListener('change', () => {
    audio.setPlaybackRate(Number(speedSel.value));
    speedSel.blur();
  });
  const stepSpeed = (d: number) => setSpeed(SPEEDS.indexOf(Number(speedSel.value) as (typeof SPEEDS)[number]) + d);

  // motion blur: the film's own, with 4 sub-frames. A clip or transition that video.json caps at 1 sample stays sharp
  // and costs one. The shutter is that of a frame of the film (its fps), not of the screen's refresh.
  const blurSel = $<HTMLSelectElement>('blur');
  let blur: AdaptiveSampling | null = BLUR[store.get('blur') ?? ''] ?? null;
  const frameDt = 1 / project.fps;
  blurSel.innerHTML = `<option value="off">Off</option>${Object.keys(BLUR).map((k) => `<option value="${k}">${k} samples</option>`).join('')}`;
  blurSel.value = Object.keys(BLUR).find((k) => BLUR[k] === blur) ?? 'off';
  blurSel.addEventListener('change', () => {
    blur = BLUR[blurSel.value] ?? null;
    store.set('blur', blurSel.value);
    dirty = true;
    blurSel.blur();
  });

  // video: another project loads the page again
  const videoSel = $<HTMLSelectElement>('video');
  $('field-video').hidden = videos.length < 2;
  videoSel.innerHTML = videos.map((v) => `<option value="${esc(v.id)}"${v.id === id ? ' selected' : ''}>${esc(v.title)}</option>`).join('');
  videoSel.addEventListener('change', () => location.assign(videoUrl(videoSel.value)));

  // the options of the project
  const optionsEl = $('options');
  const optionSelects = new Map<string, HTMLSelectElement>();
  optionsEl.innerHTML = options
    .map((o) => `<label class="pl-field"><span class="pl-muted">${esc(o.label)}:</span><select class="nle-select pl-select" data-option="${esc(o.id)}" aria-label="${esc(o.label)}">${o.values.map((v) => `<option value="${esc(v.id)}"${v.id === chosen.get(o.id) ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>`)
    .join('');
  for (const sel of optionsEl.querySelectorAll<HTMLSelectElement>('select')) {
    const o = options.find((x) => x.id === sel.dataset.option)!;
    optionSelects.set(o.id, sel);
    sel.addEventListener('change', async () => {
      // the scenes that took the old choice load again; each draws until its new self is ready
      sel.disabled = true;
      sel.blur();
      try {
        const scenes = new Set(await o.apply(sel.value, assetsUrl));
        for (const e of engine.timeline) if (e.scene && scenes.has(e.scene)) await engine.reload(e.id);
        chosen.set(o.id, sel.value);
        store.set(`${id}.${o.id}`, sel.value);
        dirty = true;
      } catch (e) {
        console.error(e);
        sel.value = chosen.get(o.id)!;
      } finally {
        sel.disabled = false;
      }
    });
  }

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
    u.searchParams.set('project', id);
    u.searchParams.set('scale', res.value);
    u.searchParams.set('t', t.toFixed(2));
    location.assign(u);
  });

  // ---------------------------------------------------------------- subtitles
  const subsEl = $('subs');
  const subGroup = $('sub-group'), btnSub = $('btn-sub'), subLang = $<HTMLSelectElement>('sub-lang');
  let tracks: SubTrack[] = [];
  let subTrack: SubTrack | null = null;
  let subOn = store.get('sub') === 'on';
  let subLine: SubLine | null = null;
  let subSpans: HTMLElement[] = [];
  let subState: number[] = [];
  const applySub = () => {
    btnSub.classList.toggle('active', subOn);
    btnSub.setAttribute('aria-pressed', String(subOn));
    subLine = null; // build the line again
    subsEl.hidden = true;
  };
  btnSub.addEventListener('click', () => {
    subOn = !subOn;
    store.set('sub', subOn ? 'on' : 'off');
    applySub();
  });
  subLang.addEventListener('change', () => {
    subTrack = tracks.find((x) => x.id === subLang.value) ?? tracks[0]!;
    store.set(`sub.${id}`, subTrack.id);
    subLang.blur();
    applySub();
  });
  fetch(`${DATA}${id}/subtitles.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Subtitles>) : null))
    .then((s) => {
      if (!s?.tracks.length) return;
      tracks = s.tracks;
      subTrack = tracks.find((x) => x.id === store.get(`sub.${id}`)) ?? tracks[0]!;
      subLang.innerHTML = tracks.map((x) => `<option value="${x.id}"${x === subTrack ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
      subLang.hidden = tracks.length < 2;
      subGroup.hidden = false;
      applySub();
    })
    .catch(() => {});
  /** The line at `now`, each token marked as to come, sung now or sung. Builds the line's markup only when the line changes. */
  const drawSubs = (now: number) => {
    const line = subOn && subTrack ? lineAt(subTrack, now) : null;
    if (line !== subLine) {
      subLine = line;
      subsEl.hidden = !line;
      if (line) {
        const join = subTrack!.joiner;
        subsEl.innerHTML = line.tokens.map((k) => `<span class="tk">${esc(k[0])}</span>`).join(join);
        subSpans = [...subsEl.querySelectorAll<HTMLElement>('.tk')];
        subState = subSpans.map(() => -1);
      }
    }
    if (!line) return;
    line.tokens.forEach((k, i) => {
      const s = now >= k[2] ? 2 : now >= k[1] ? 1 : 0;
      if (s !== subState[i]) {
        subState[i] = s;
        subSpans[i]!.className = `tk s${s}`;
      }
    });
  };

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
    else if (k === 'c') btnSub.click();
    else if (k === '<') stepSpeed(-1);
    else if (k === '>') stepSpeed(1);
    else if (k >= '0' && k <= '9') seekTo((Number(k) / 10) * duration);
    else return;
    e.preventDefault();
  });

  // ---------------------------------------------------------------- draw loop
  const timeNow = $('time-now'), sectionEl = $('section'), monFps = $('mon-fps'), monMs = $('mon-ms'), stat = $('stat');
  let lastDrawn = -1, shownPlaying: boolean | null = null, renderMs = 0, frameMs = 16.7, lastFrame = performance.now(), lastStats = 0;
  const tick = (now: number) => {
    if (audio.playing) t = audio.currentTime;
    if (audio.playing || dirty || t !== lastDrawn) {
      const t0 = performance.now();
      if (blur) engine.render(t, frameDt, true, blur, 0.5);
      else engine.render(t, 1 / 60);
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
    }
    timeNow.textContent = fmt(t);
    seekFill.style.width = `${(t / duration) * 100}%`;
    seek.setAttribute('aria-valuenow', String(Math.round(t)));
    sectionEl.textContent = sections[sectionAt(t)]?.name ?? '\u2014';
    drawSubs(t);
    if (now - lastStats > 500) {
      lastStats = now;
      const fps = `${(1000 / frameMs).toFixed(0)} FPS`, ms = `${renderMs.toFixed(1)} ms`;
      monFps.textContent = fps;
      monMs.textContent = ms;
      // the group box title is not on the screen in fullscreen: the bar carries the same numbers
      stat.textContent = `${project.title} \u00b7 ${PW}\u00d7${PH} \u00b7 ${fps} \u00b7 ${ms}${audio.playbackRate !== 1 ? ` \u00b7 ${audio.playbackRate}\u00d7` : ''}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // ---------------------------------------------------------------- start
  loader?.dispose();
  splash.firstElementChild!.classList.remove('loading');
  loader = null;
  splashStatus.textContent = engine.errors.length ? `${engine.errors.length} scene(s) failed to load, see the console` : startAt > 0 ? `Resumes at ${fmt(t)}` : '';
  splashPlay.disabled = false;
  splashPlay.textContent = startAt > 0 ? 'Resume' : 'Play';
  splashPlay.addEventListener('click', () => {
    splash.hidden = true;
    void play();
  });
  splashPlay.focus();
}

main().catch((e) => {
  console.error(e);
  fail(`Could not load: ${String((e as Error)?.message ?? e)}`);
});

// The project the page plays (inputs.ts): video/video.json resolved with @pve/core against the song timing,
// plus the engine's audio, lyrics, overlay, assets URL and font replacements.
import { resolveVideo, TimingData, validateVideo } from '@pve/core';
import { AudioData } from '@pve/engine/audio';
import type { EngineProject, TimelineEntry } from '@pve/engine/engine';
import { Lyrics } from '@pve/engine/lyrics';
import type { OverlayClass, SceneClass } from '@pve/engine/scene';
import { StoryboardCard } from '@pve/engine/storyboard';
import { fetchInputs, type ProjectInputs } from './inputs';

// Scene modules of every project, loaded on demand: only the open project's scenes are fetched.
const modules = import.meta.glob<{ default: SceneClass | OverlayClass }>('../../projects/*/video/scenes/*.ts');

/** The open project, filled by loadProject. */
export const project = { id: '', title: '', mix: '' };
export let inputs: ProjectInputs;
export const sceneTimestamps = new Map<string, number>();

export function updateSceneTimestamp(scene: string, timestamp: number) {
  sceneTimestamps.set(scene, timestamp);
}

export async function loadProject(): Promise<EngineProject> {
  inputs = await fetchInputs();
  const checked = validateVideo(inputs.video);
  if (!checked.ok) throw new Error(`projects/${inputs.id}/video/video.json:\n${checked.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
  const { timing, features } = inputs;
  const video = resolveVideo(checked.video, new TimingData(timing));
  Object.assign(project, { id: inputs.id, title: video.title, mix: inputs.mix });

  const scene = <T>(name: string) => () => {
    const ts = sceneTimestamps.get(name) ?? sceneTimestamps.get('*');
    if (ts) {
      return import(/* @vite-ignore */ `/projects/${inputs.id}/video/scenes/${name}.ts?t=${ts}`) as Promise<{ default: T }>;
    }
    const m = modules[`../../projects/${inputs.id}/video/scenes/${name}.ts`];
    return (m ? m() : import(/* @vite-ignore */ `/projects/${inputs.id}/video/scenes/${name}.ts`)) as Promise<{ default: T }>;
  };

  const card = () => Promise.resolve({ default: StoryboardCard });
  const timeline = video.clips.map((c): TimelineEntry => ({
    id: c.id,
    scene: c.scene,
    // a clip without a scene renders the storyboard card (DESIGN 6.4) with its brief
    load: c.scene ? scene<SceneClass>(c.scene) : card,
    start: c.start,
    // the engine draws the overlap of an xfade: the clip runs on past the cut
    end: c.end + (c.xfade ?? 0),
    ...(c.scene ? (c.params ? { params: c.params } : {}) : { params: { ...c.params, brief: c.brief ?? '' } }),
    ...(c.samples ? { maxSamples: c.samples.max } : {}),
  }));
  for (const tr of video.transitions) {
    timeline.push({
      id: tr.id,
      scene: tr.scene,
      load: scene<SceneClass>(tr.scene),
      start: tr.start,
      end: tr.end,
      over: true,
      params: { ...tr.params, at: tr.at },
    });
  }

  const audio = new AudioData({
    duration: timing.duration,
    bpm: timing.bpm,
    beats: timing.beats,
    downbeats: timing.downbeats,
    sections: timing.sections,
    fps: features.fps,
    envelopes: features.envelopes,
    onsets: features.onsets,
  });
  const lyrics = new Lyrics({ lines: inputs.lines });
  return {
    audio,
    lyrics,
    timeline,
    assets: `/projects/${inputs.id}/video/assets/`,
    fonts: inputs.assets.fonts,
    ...(video.overlay ? { overlay: scene<OverlayClass>(video.overlay), overlayScene: video.overlay } : {}),
  };
}

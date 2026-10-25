// Structure check of video.json v2 (DESIGN section 5).
// The syntax of time expressions is checked by the resolver, not here.

import type { VideoJson } from './types.ts';

export interface ValidationError {
  /** JSON path of the wrong value, for example `clips[3].at`. The root is `$`. */
  path: string;
  message: string;
}

export type ValidateResult = { ok: true; video: VideoJson } | { ok: false; errors: ValidationError[] };

/** Marker names and clip ids. Expressions refer to them as `@name` and `clip:id.start`. */
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const ROOT_KEYS = ['v', 'title', 'fps', 'size', 'markers', 'clips', 'transitions', 'overlay', 'post'];
const MARKER_KEYS = ['at'];
const CLIP_KEYS = ['id', 'scene', 'at', 'to', 'params', 'samples', 'xfade', 'brief'];
const SAMPLES_KEYS = ['max'];
const TRANSITION_KEYS = ['id', 'scene', 'at', 'pre', 'post', 'params', 'brief'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateVideo(json: unknown): ValidateResult {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string): void => {
    errors.push({ path, message });
  };

  const checkKeys = (obj: Record<string, unknown>, allowed: string[], path: string): void => {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) fail(path === '$' ? key : `${path}.${key}`, `unknown field "${key}"`);
    }
  };

  const checkTime = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) fail(path, 'must be a finite number of seconds >= 0');
    } else if (typeof value === 'string') {
      if (value.trim().length === 0) fail(path, 'must not be an empty expression');
    } else {
      fail(path, 'must be a number of seconds or a time expression string');
    }
  };

  const checkName = (value: unknown, path: string): void => {
    if (typeof value !== 'string' || value.trim().length === 0) fail(path, 'must be a non-empty string');
  };

  if (!isObject(json)) {
    return { ok: false, errors: [{ path: '$', message: 'must be an object' }] };
  }
  checkKeys(json, ROOT_KEYS, '$');

  if (json.v !== 2) fail('v', 'must be 2');
  if (typeof json.title !== 'string') fail('title', 'must be a string');
  if (typeof json.fps !== 'number' || !Number.isFinite(json.fps) || json.fps <= 0) {
    fail('fps', 'must be a positive number');
  }

  const size = json.size;
  if (!Array.isArray(size) || size.length !== 2) {
    fail('size', 'must be [width, height]');
  } else {
    size.forEach((n, i) => {
      if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) fail(`size[${i}]`, 'must be a positive integer');
    });
  }

  if (!isObject(json.markers)) {
    fail('markers', 'must be an object of { at } entries');
  } else {
    for (const [name, marker] of Object.entries(json.markers)) {
      const path = `markers.${name}`;
      if (!ID_PATTERN.test(name)) fail(path, `marker name must match ${ID_PATTERN}`);
      if (!isObject(marker)) {
        fail(path, 'must be an object with "at"');
        continue;
      }
      checkKeys(marker, MARKER_KEYS, path);
      checkTime(marker.at, `${path}.at`);
    }
  }

  if (!Array.isArray(json.clips) || json.clips.length === 0) {
    fail('clips', 'must be a non-empty array');
  } else {
    const seen = new Map<string, number>();
    json.clips.forEach((clip: unknown, i) => {
      const path = `clips[${i}]`;
      if (!isObject(clip)) {
        fail(path, 'must be an object');
        return;
      }
      checkKeys(clip, CLIP_KEYS, path);

      if (typeof clip.id !== 'string' || !ID_PATTERN.test(clip.id)) {
        fail(`${path}.id`, `must be a string that matches ${ID_PATTERN}`);
      } else {
        const first = seen.get(clip.id);
        if (first !== undefined) fail(`${path}.id`, `duplicate clip id "${clip.id}" (first at clips[${first}])`);
        else seen.set(clip.id, i);
      }

      if (clip.scene !== undefined) checkName(clip.scene, `${path}.scene`);
      checkTime(clip.at, `${path}.at`);
      if (clip.to !== undefined) checkTime(clip.to, `${path}.to`);
      if (clip.params !== undefined && !isObject(clip.params)) fail(`${path}.params`, 'must be an object');

      if (clip.samples !== undefined) {
        if (!isObject(clip.samples)) {
          fail(`${path}.samples`, 'must be an object with "max"');
        } else {
          checkKeys(clip.samples, SAMPLES_KEYS, `${path}.samples`);
          const max = clip.samples.max;
          if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
            fail(`${path}.samples.max`, 'must be an integer >= 1');
          }
        }
      }

      if (clip.xfade !== undefined && (typeof clip.xfade !== 'number' || !Number.isFinite(clip.xfade) || clip.xfade < 0)) {
        fail(`${path}.xfade`, 'must be a number of seconds >= 0');
      }
      if (clip.brief !== undefined && typeof clip.brief !== 'string') fail(`${path}.brief`, 'must be a string');
    });
  }

  if (json.transitions !== undefined) {
    if (!Array.isArray(json.transitions)) {
      fail('transitions', 'must be an array');
    } else {
      const seen = new Map<string, number>();
      json.transitions.forEach((tr: unknown, i) => {
        const path = `transitions[${i}]`;
        if (!isObject(tr)) {
          fail(path, 'must be an object');
          return;
        }
        checkKeys(tr, TRANSITION_KEYS, path);
        if (typeof tr.id !== 'string' || !ID_PATTERN.test(tr.id)) {
          fail(`${path}.id`, `must be a string that matches ${ID_PATTERN}`);
        } else {
          const first = seen.get(tr.id);
          const clips = Array.isArray(json.clips) ? (json.clips as unknown[]) : [];
          if (first !== undefined) fail(`${path}.id`, `duplicate transition id "${tr.id}" (first at transitions[${first}])`);
          else if (clips.some((c) => isObject(c) && c.id === tr.id)) fail(`${path}.id`, `"${tr.id}" is also a clip id`);
          else seen.set(tr.id, i);
        }
        checkName(tr.scene, `${path}.scene`);
        checkTime(tr.at, `${path}.at`);
        if (tr.pre !== undefined && (typeof tr.pre !== 'number' || !Number.isFinite(tr.pre) || tr.pre < 0)) {
          fail(`${path}.pre`, 'must be a number of seconds >= 0');
        }
        if (typeof tr.post !== 'number' || !Number.isFinite(tr.post) || tr.post < 0) {
          fail(`${path}.post`, 'must be a number of seconds >= 0');
        } else if ((typeof tr.pre === 'number' ? tr.pre : 0) + tr.post <= 0) {
          fail(path, 'pre + post must be > 0');
        }
        if (tr.params !== undefined && !isObject(tr.params)) fail(`${path}.params`, 'must be an object');
        if (tr.brief !== undefined && typeof tr.brief !== 'string') fail(`${path}.brief`, 'must be a string');
      });
    }
  }

  if (json.overlay !== undefined) checkName(json.overlay, 'overlay');
  if (json.post !== undefined && !isObject(json.post)) fail('post', 'must be an object');

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, video: json as unknown as VideoJson };
}

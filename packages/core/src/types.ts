// Types of video/video.json v2 (DESIGN section 5) and of its resolved form.

/** Seconds, or a time expression (DESIGN section 5.1). */
export type TimeValue = number | string;

export interface Marker {
  at: TimeValue;
}

export interface ClipSamples {
  /** Cap for adaptive motion blur samples. */
  max: number;
}

export interface Clip {
  id: string;
  /** Scene module name. Without a scene, the clip renders the storyboard card. */
  scene?: string;
  at: TimeValue;
  /** Clip end. Default: the `at` of the next clip, or `end` for the last clip. */
  to?: TimeValue;
  /** Given to the scene unchanged. */
  params?: Record<string, unknown>;
  samples?: ClipSamples;
  /** Seconds of overlap with the next clip. */
  xfade?: number;
  /** What the scene must show. */
  brief?: string;
}

/**
 * An "Over" transition: a scene drawn on top of the clips around a cut, decoupled from both. It runs
 * from `at - pre` to `at + post` and gets the composited clips under it.
 */
export interface Transition {
  id: string;
  scene: string;
  /** The moment it is placed on, usually a cut (`clip:room.start`). */
  at: TimeValue;
  /** Seconds before `at` it starts. Default 0. */
  pre?: number;
  /** Seconds after `at` it ends. */
  post: number;
  /** Given to the scene unchanged. */
  params?: Record<string, unknown>;
  brief?: string;
}

export interface VideoJson {
  v: 2;
  title: string;
  fps: number;
  /** Logical size in px: [width, height]. */
  size: [number, number];
  markers: Record<string, Marker>;
  /** One ordered track. */
  clips: Clip[];
  /** Over transitions, drawn on top of the clips. */
  transitions?: Transition[];
  /** Scene drawn over every clip. */
  overlay?: string;
  /** Project defaults for PostParams. */
  post?: Record<string, unknown>;
}

export interface ResolvedClip {
  id: string;
  start: number;
  end: number;
  dur: number;
  startBeat: number;
  endBeat: number;
  scene?: string;
  params?: Record<string, unknown>;
  samples?: ClipSamples;
  xfade?: number;
  brief?: string;
}

export interface ResolvedTransition {
  id: string;
  scene: string;
  at: number;
  start: number;
  end: number;
  params?: Record<string, unknown>;
  brief?: string;
}

export interface ResolvedVideo {
  title: string;
  fps: number;
  size: [number, number];
  duration: number;
  bpm: number;
  markers: Record<string, number>;
  clips: ResolvedClip[];
  transitions: ResolvedTransition[];
  overlay?: string;
  post?: Record<string, unknown>;
}

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  message: string;
  clipId?: string;
  t?: number;
}

export interface LintResult {
  valid: boolean;
  findings: LintFinding[];
}

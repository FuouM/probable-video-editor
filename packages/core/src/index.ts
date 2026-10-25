export type { Features, MixEnvelopeKey, OnsetKey, SongLine, SongSection, SongSyllable, SongTiming, SongWord, StemEnvelopeKey } from './song.ts';
// load.ts reads files (node:fs, lyricsync): import loadSong and its types (Song, SongPrompt, CalibrationDoc)
// from '@pve/core/load'. This index stays free of them so the browser can import it.
export type {
  Clip,
  ClipSamples,
  LintFinding,
  LintResult,
  LintSeverity,
  Marker,
  ResolvedClip,
  ResolvedTransition,
  ResolvedVideo,
  TimeValue,
  Transition,
  VideoJson,
} from './types.ts';
export { foldText, TimingData, TimingError, type TimingErrorCode } from './timing.ts';
export {
  parseExpression,
  resolveAnchor,
  resolveVideo,
  ResolveError,
  type AnchorClauseNode,
  type Edge,
  type ErrorCode,
  type ExpressionNode,
  type OffsetNode,
  type OffsetUnit,
  type ResolveContext,
  type SnapDirectiveKind,
  type TargetNode,
} from './resolve.ts';
export { lintVideo, OFF_BEAT_TOLERANCE_SEC } from './lint.ts';
export { validateVideo, type ValidateResult, type ValidationError } from './validate.ts';
export { validateNotes, type Note, type NotesJson, type NotesResult } from './notes.ts';

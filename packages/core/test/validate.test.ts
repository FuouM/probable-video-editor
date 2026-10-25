import { describe, expect, it } from 'bun:test';
import { validateVideo, type ValidationError } from '../src/validate.ts';

/** The sample of DESIGN section 5. */
function designSample(): Record<string, any> {
  return {
    v: 2,
    title: "I'm Upping My P(doom)",
    fps: 60,
    size: [1920, 1080],
    markers: {
      loss: { at: 'lyric:There was a sudden drop @beat<=' },
      hook1: { at: "lyric:I'm upping#0 @beat<=" },
      outro: { at: 'section:Outro || lyric:Was it all for show @downbeat~' },
    },
    clips: [
      { id: 'open', scene: 'open', at: 0, to: '@loss' },
      { id: 'loss', scene: 'loss', at: '@loss', to: '@pre1' },
      { id: 'prompt1', scene: 'prompt', at: '@pre1', to: '@hook1', params: { variant: 'chatgpt' } },
      { id: 'shoggoth', scene: 'shoggoth', at: '@shog', to: '@space', samples: { max: 108 } },
      { id: 'outro', scene: 'outro', at: '@outro', to: 'end' },
    ],
    transitions: [{ id: 'shards', scene: 'shards', at: 'clip:loss.start', pre: 0.5, post: 1.2, params: { n: 40 } }],
    overlay: 'hud',
    post: { grain: 1 },
  };
}

function errorsOf(json: unknown): ValidationError[] {
  const result = validateVideo(json);
  if (result.ok) throw new Error('expected validation errors');
  return result.errors;
}

describe('validateVideo', () => {
  it('accepts the DESIGN section 5 sample', () => {
    const json = designSample();
    const result = validateVideo(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.video).toBe(json as never);
  });

  it('accepts a storyboard clip with only id, at and brief, plus xfade', () => {
    const json = designSample();
    json.clips = [
      { id: 'a', at: 0, brief: 'the title card', xfade: 0.5 },
      { id: 'b', at: 'bar:5' },
    ];
    delete json.overlay;
    delete json.post;
    expect(validateVideo(json).ok).toBe(true);
  });

  it('rejects a value that is not an object', () => {
    expect(errorsOf(null)).toEqual([{ path: '$', message: 'must be an object' }]);
    expect(errorsOf([])).toEqual([{ path: '$', message: 'must be an object' }]);
  });

  const cases: [string, (j: Record<string, any>) => void, string][] = [
    ['v is not 2', (j) => (j.v = 1), 'v'],
    ['title is missing', (j) => delete j.title, 'title'],
    ['fps is 0', (j) => (j.fps = 0), 'fps'],
    ['fps is a string', (j) => (j.fps = '60'), 'fps'],
    ['size has one value', (j) => (j.size = [1920]), 'size'],
    ['size height is negative', (j) => (j.size = [1920, -1]), 'size[1]'],
    ['size width is fractional', (j) => (j.size = [19.5, 1080]), 'size[0]'],
    ['markers is missing', (j) => delete j.markers, 'markers'],
    ['markers is an array', (j) => (j.markers = []), 'markers'],
    ['marker name has a space', (j) => (j.markers['my marker'] = { at: 0 }), 'markers.my marker'],
    ['marker is a string', (j) => (j.markers.loss = 'beat:4'), 'markers.loss'],
    ['marker at is missing', (j) => (j.markers.loss = {}), 'markers.loss.at'],
    ['marker at is empty', (j) => (j.markers.loss = { at: '  ' }), 'markers.loss.at'],
    ['marker has an unknown field', (j) => (j.markers.loss.note = 'x'), 'markers.loss.note'],
    ['clips is missing', (j) => delete j.clips, 'clips'],
    ['clips is empty', (j) => (j.clips = []), 'clips'],
    ['clip is not an object', (j) => (j.clips[1] = 'loss'), 'clips[1]'],
    ['clip id is missing', (j) => delete j.clips[2].id, 'clips[2].id'],
    ['clip id has a dot', (j) => (j.clips[2].id = 'a.b'), 'clips[2].id'],
    ['clip id is a duplicate', (j) => (j.clips[3].id = 'open'), 'clips[3].id'],
    ['clip scene is empty', (j) => (j.clips[0].scene = ''), 'clips[0].scene'],
    ['clip at is missing', (j) => delete j.clips[3].at, 'clips[3].at'],
    ['clip at is negative', (j) => (j.clips[0].at = -1), 'clips[0].at'],
    ['clip at is an object', (j) => (j.clips[0].at = { t: 1 }), 'clips[0].at'],
    ['clip to is empty', (j) => (j.clips[4].to = ''), 'clips[4].to'],
    ['clip to is boolean', (j) => (j.clips[4].to = true), 'clips[4].to'],
    ['clip params is an array', (j) => (j.clips[2].params = []), 'clips[2].params'],
    ['clip samples is a number', (j) => (j.clips[3].samples = 108), 'clips[3].samples'],
    ['clip samples.max is 0', (j) => (j.clips[3].samples = { max: 0 }), 'clips[3].samples.max'],
    ['clip samples.max is fractional', (j) => (j.clips[3].samples = { max: 2.5 }), 'clips[3].samples.max'],
    ['clip samples has an unknown field', (j) => (j.clips[3].samples.min = 1), 'clips[3].samples.min'],
    ['clip xfade is negative', (j) => (j.clips[0].xfade = -0.1), 'clips[0].xfade'],
    ['clip xfade is a string', (j) => (j.clips[0].xfade = '0.5'), 'clips[0].xfade'],
    ['clip brief is a number', (j) => (j.clips[0].brief = 3), 'clips[0].brief'],
    ['clip has the old maxSamples field', (j) => (j.clips[3].maxSamples = 8), 'clips[3].maxSamples'],
    ['clip has the old dur field', (j) => (j.clips[0].dur = 4), 'clips[0].dur'],
    ['overlay is a number', (j) => (j.overlay = 5), 'overlay'],
    ['post is an array', (j) => (j.post = []), 'post'],
    ['root has the old tracks field', (j) => (j.tracks = []), 'tracks'],
    ['transitions is an object', (j) => (j.transitions = {}), 'transitions'],
    ['transition id is a duplicate', (j) => j.transitions.push({ ...j.transitions[0] }), 'transitions[1].id'],
    ['transition id is a clip id', (j) => (j.transitions[0].id = 'loss'), 'transitions[0].id'],
    ['transition scene is missing', (j) => delete j.transitions[0].scene, 'transitions[0].scene'],
    ['transition at is missing', (j) => delete j.transitions[0].at, 'transitions[0].at'],
    ['transition post is missing', (j) => delete j.transitions[0].post, 'transitions[0].post'],
    ['transition pre is negative', (j) => (j.transitions[0].pre = -1), 'transitions[0].pre'],
    ['transition has zero length', (j) => ((j.transitions[0].pre = 0), (j.transitions[0].post = 0)), 'transitions[0]'],
    ['transition has a clip field', (j) => (j.transitions[0].xfade = 1), 'transitions[0].xfade'],
  ];

  for (const [name, mutate, path] of cases) {
    it(`reports ${path} when ${name}`, () => {
      const json = designSample();
      mutate(json);
      const errors = errorsOf(json);
      expect(errors.map((e) => e.path)).toEqual([path]);
      expect(errors[0]!.message.length).toBeGreaterThan(0);
    });
  }

  it('reports every error, not only the first', () => {
    const json = designSample();
    json.v = 3;
    json.clips[1].at = null;
    json.clips[4].id = 'open';
    expect(errorsOf(json).map((e) => e.path)).toEqual(['v', 'clips[1].at', 'clips[4].id']);
  });

  it('names the first clip of a duplicate id', () => {
    const json = designSample();
    json.clips[4].id = 'loss';
    expect(errorsOf(json)[0]!.message).toContain('clips[1]');
  });
});

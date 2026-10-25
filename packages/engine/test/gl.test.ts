import { describe, expect, it } from 'bun:test';
import { GlitchPass } from '../src/gl.ts';

describe('GlitchPass', () => {
  it('instantiates and disposes without errors', () => {
    const pass = new GlitchPass();
    expect(pass).toBeDefined();
    expect(pass.dispose).toBeInstanceOf(Function);
    pass.dispose();
  });
});

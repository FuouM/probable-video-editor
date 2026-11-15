// Pipelined readback of the engine's finished frame as packed RGB (rgb24) through pixel-pack buffers and fences.
import * as THREE from 'three';
import { FSPass, PW, PH } from './gl';

/** Resolve on the next task (a MessageChannel message: no timer clamping), to poll GPU fences cheaply. */
const yieldChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldQueue: (() => void)[] = [];
if (yieldChannel) yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
function yieldTask() {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (!yieldChannel) setTimeout(resolve, 0);
  else {
    yieldQueue.push(resolve);
    yieldChannel.port2.postMessage(0);
  }
  return promise;
}

/**
 * The frame as packed RGB (rgb24, a quarter fewer bytes to read back and send than RGBA), read through three
 * pixel-pack buffer slots. Engine.readStart / Engine.readFinish hand off to it.
 */
export class PackedReadback {
  /** Bytes per frame (packed RGB, bottom-up rows). */
  static readonly BYTES = PW * PH * 3;
  private pbos: WebGLBuffer[] = [];
  private packs: ({ buf: WebGLBuffer; sync: WebGLSync } | undefined)[] = [];
  // texel i of a row holds bytes 4i..4i+3 of the row's R,G,B stream, copied exactly (8-bit in, 8-bit out)
  readonly rgbRT = new THREE.WebGLRenderTarget((PW * 3) / 4, PH, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  readonly rgbPass = new FSPass(/* glsl */ `
    uniform sampler2D src;
    void main() {
      ivec2 o = ivec2(gl_FragCoord.xy);
      vec4 v;
      for (int c = 0; c < 4; c++) {
        int b = o.x * 4 + c, i = b / 3, ch = b - i * 3;
        vec4 p = texelFetch(src, ivec2(i, o.y), 0);
        v[c] = ch == 0 ? p.r : ch == 1 ? p.g : p.b;
      }
      fragColor = v;
    }`, { src: { value: null } });

  /** `src`: the RGBA8 frame (PW x PH) to read. */
  constructor(private renderer: THREE.WebGLRenderer, private src: THREE.WebGLRenderTarget) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.pbos = [gl.createBuffer()!, gl.createBuffer()!, gl.createBuffer()!];
    for (const b of this.pbos) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, PackedReadback.BYTES, gl.STREAM_READ);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /** Pack the frame and queue its copy into pixel-pack buffer `slot` (see Engine.readStart). */
  start(slot: number) {
    const r = this.renderer, gl = r.getContext() as WebGL2RenderingContext;
    const old = this.packs[slot];
    if (old) { gl.deleteSync(old.sync); }
    const buf = this.pbos[slot]!;
    this.rgbPass.u.src!.value = this.src.texture;
    this.rgbPass.render(r, this.rgbRT);
    r.setRenderTarget(this.rgbRT);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
    gl.readPixels(0, 0, this.rgbRT.width, PH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.packs[slot] = { buf, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)! };
    gl.flush();
  }

  /** Wait for start(slot)'s copy and copy it into `out` (PackedReadback.BYTES). */
  async finish(slot: number, out: Uint8Array) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext, p = this.packs[slot];
    if (!p) throw new Error(`readFinish: nothing queued in slot ${slot}`);
    // (a sync object's status only changes between tasks: yield to the event loop between polls)
    for (;;) {
      const s = gl.clientWaitSync(p.sync, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
      if (s === gl.ALREADY_SIGNALED || s === gl.CONDITION_SATISFIED) break;
      if (s === gl.WAIT_FAILED) throw new Error('readFinish: fence wait failed');
      await yieldTask();
    }
    this.packs[slot] = undefined;
    gl.deleteSync(p.sync);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return out;
  }

  dispose() {
    this.rgbRT.dispose();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    for (let i = 0; i < this.packs.length; i++) {
      const p = this.packs[i];
      if (p) {
        gl.deleteSync(p.sync);
        gl.deleteBuffer(p.buf);
        this.packs[i] = undefined;
      }
    }
    for (const b of this.pbos) gl.deleteBuffer(b);
    this.pbos = [];
  }
}

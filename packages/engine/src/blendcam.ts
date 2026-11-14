// A perspective camera whose projection can be a blend with the orthographic projection of the same frame. Use it for a move from a
// map camera (orthographic) into the world (perspective) with no jump.
import * as THREE from 'three';

/**
 * `mix` 0: orthographic, the frame `2 * aimDist * tan(fov / 2)` high at the distance `aimDist`; 1: the plain perspective. Both put the
 * plane at `aimDist` at the same place in the picture, so the blend changes only how much nearer things grow.
 * `LitView.render` calls `updateProjectionMatrix`, so the blend is kept there.
 */
export class BlendCamera extends THREE.PerspectiveCamera {
  mix = 1;
  aimDist = 1;
  private readonly orthoM = new THREE.Matrix4();

  override updateProjectionMatrix() {
    super.updateProjectionMatrix();
    // (the base constructor calls this before the fields exist: then `mix` is undefined and the projection is the plain one)
    if (!(this.mix < 1)) return;
    const hh = this.aimDist * Math.tan(THREE.MathUtils.degToRad(this.fov) / 2), hw = hh * this.aspect;
    const p = this.projectionMatrix.elements, o = this.orthoM.makeOrthographic(-hw, hw, hh, -hh, this.near, this.far).elements;
    for (let i = 0; i < 16; i++) p[i] = o[i]! + (p[i]! - o[i]!) * this.mix;
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

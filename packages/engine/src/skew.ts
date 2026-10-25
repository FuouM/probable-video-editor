/**
 * Motion-blur sub-frames render at times spread over the shutter, but a layer held at a lower rate
 * (`floor(t * 12)`) must show ONE state per output frame: if a step falls inside the shutter, some
 * sub-frames show the old state and some the new, and the frame is a cross-fade of the two (ghosting,
 * and at 30 fps on every 2nd or 5th frame). `value` is (frame time - this sub-frame's time), 0 outside
 * motion-blur sub-frames. Quantize `t + FRAME_SKEW.value`, where `t` is any f.t minus a constant:
 * the sum is the same frame time (plus that constant) in every sub-frame.
 *
 * Kept in its own module so util.ts can import it without a circular dependency through gl.ts -> common.ts -> palette.ts.
 */
export const FRAME_SKEW: { value: number } = { value: 0 };

// The time grid of the song: 135 BPM from t = 0, and the frame rate of the video.

/** Seconds per beat at 135 BPM. */
export const SPB = 60 / 135;
/** Seconds per 4-beat bar at 135 BPM. */
export const BAR = 4 * SPB;
/** Bar n (1-indexed) in song seconds. */
export const bar = (n: number) => (n - 1) * BAR;
/** The frame rate of the video. */
export const FPS = 36;
/** One frame step (s). */
export const FR = 1 / 36;

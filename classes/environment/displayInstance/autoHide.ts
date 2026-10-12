/**
 * Per-window auto-hide, after XSOverlay's "vision clipping": a window fades out once the head
 * turns far enough away from it, and back in when you face it again. Orientation only, like XSO:
 * it compares where the head looks with where the window faces, not where the window is.
 */

/** XSO's default `OverlayClipAngle`. */
export const AUTO_HIDE_ANGLE_DEG = 60;
/** A few degrees of hysteresis, so a head held at the edge doesn't flicker the window. */
export const AUTO_SHOW_ANGLE_DEG = 55;
/** XSO's fade time. */
export const AUTO_HIDE_FADE_S = 0.2;

type Vec3 = { x: number; y: number; z: number };

/** Angle in degrees between two directions (any length). */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const length = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (length === 0) return 0;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / length;
  return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
}

/** Whether the window should be hidden, given the head-to-window angle and its current state. */
export function nextAutoHidden(hidden: boolean, angleDeg: number): boolean {
  return hidden ? angleDeg >= AUTO_SHOW_ANGLE_DEG : angleDeg >= AUTO_HIDE_ANGLE_DEG;
}

/** Moves the opacity factor toward 0 (hidden) or 1 over `AUTO_HIDE_FADE_S`. */
export function stepAutoHideFade(factor: number, hidden: boolean, deltaS: number): number {
  const step = deltaS / AUTO_HIDE_FADE_S;
  return hidden ? Math.max(0, factor - step) : Math.min(1, factor + step);
}

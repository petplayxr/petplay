/**
 * Pushing a held window away along the grabbing ray, or pulling it back (the joystick and the
 * mouse wheel).
 *
 * A grab keeps the window rigid to the pointer as it was when the grab started (or was last
 * rebased): the window's offset is measured from `initialPointerWorldPoint` in the frame of
 * `initialPointerWorldQuaternion`. Sliding that start point backward along the start ray
 * therefore slides the window forward along the *current* ray, however the controller has turned
 * since. Sliding it along the current ray instead would be turned once more by the grab, and the
 * window would drift sideways whenever the hand had rotated.
 */
import type { HandleStore } from "@pmndrs/handle";

/**
 * Moves `pointerId`'s grab `distance` metres along its ray, positive away from the hand. The
 * store applies it on its next update. Returns false when there is nothing to move: no such grab,
 * a grab without a ray (a squeeze), or a handle with no free translation (a hinge's 'as-rotate'),
 * whose rotation is derived from the start point and would be corrupted by moving it.
 */
export function pushPullGrab(
  store: HandleStore<unknown>,
  pointerId: number,
  distance: number,
): boolean {
  const pointer = store.inputState.get(pointerId);
  const direction = pointer?.initialPointerWorldDirection;
  if (pointer == null || direction == null || !Number.isFinite(distance) || distance === 0) {
    return false;
  }
  const translate = store.getOptions().translate;
  if (translate === false || typeof translate === "string") return false;
  pointer.initialPointerWorldPoint.addScaledVector(direction, -distance);
  return true;
}

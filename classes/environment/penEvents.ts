import type { PointerEvent, WheelEvent } from "@pmndrs/pointer-events";

/**
 * PetPlay's `on*` pointer props are dispatched by @pmndrs/pointer-events, not r3f's raycaster, so
 * handlers receive its event types. r3f v10 types those props as `ThreeEvent`; this adapts a
 * handler to that prop signature without changing what it receives at runtime.
 */
export function penHandler<E extends PointerEvent | WheelEvent>(
  handler: (event: E) => void,
): <T>(event: T) => void {
  return handler as unknown as <T>(event: T) => void;
}

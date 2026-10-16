/**
 * Where a controller pose space sits on its OpenVR tracked device, for overlays that other
 * processes position (desktop screens): while a controller carries a window they are set relative
 * to the device, so the compositor moves them with its own fresh controller pose like the
 * decoupled renderer does for the window itself.
 *
 * The webxr worker registers the resolver once OpenVR is up; without it everything stays absolute.
 */
import type { RenderAnchorSpace } from "../overlayRenderTracking.ts";

export type ControllerDeviceFrame = {
  deviceIndex: number;
  /** Column-major 4×4: the pose space (target ray or grip) in the device's own frame. */
  deviceToPose: ArrayLike<number>;
};

let resolver: ((space: RenderAnchorSpace) => ControllerDeviceFrame | null) | null = null;

export function setControllerDeviceFrameResolver(next: typeof resolver): void {
  resolver = next;
}

export function getControllerDeviceFrame(space: RenderAnchorSpace): ControllerDeviceFrame | null {
  return resolver?.(space) ?? null;
}

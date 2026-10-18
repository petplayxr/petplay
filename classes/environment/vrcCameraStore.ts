/**
 * The VRC camera setup state for the wrist page (`wristMenu/cameraView.tsx`) and the predicted
 * camera ball in the scene.
 *
 * The `webxr` actor owns the `VrcCameraTracker` and publishes its status here (throttled, plus on
 * every switch change and new fit), registers the controls the page calls, and a predictor the
 * ball reads every frame. Everything runs in the webxr worker; elsewhere (the desktop-control
 * child) nothing registers, and the page says so.
 */
import { useSyncExternalStore } from "react";
import type { TrackedPose, VrcCameraTrackerStatus } from "../vrcCameraCalibration.ts";

export type VrcCameraLayerStatus = {
  running: boolean;
  width: number | null;
  height: number | null;
};

export type VrcCameraSnapshot = {
  tracker: VrcCameraTrackerStatus;
  layer: VrcCameraLayerStatus;
  /** When this snapshot was taken, so the page can age `poseAgeMs` between publishes. */
  publishedAt: number;
};

export type VrcCameraControls = {
  setLive(on: boolean): void;
  clear(): void;
  setLayer(running: boolean): Promise<void>;
  refreshLayer(): Promise<void>;
};

export function createVrcCameraStore() {
  let snapshot: VrcCameraSnapshot | null = null;
  let controls: VrcCameraControls | null = null;
  let predictor: (() => TrackedPose | null) | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    publish(next: Omit<VrcCameraSnapshot, "publishedAt">) {
      snapshot = { ...next, publishedAt: Date.now() };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    controls: () => controls,
    setControls(next: VrcCameraControls | null) {
      controls = next;
      for (const listener of listeners) listener();
    },
    /** Predicted camera position while calibrating or recording; null hides the ball. */
    predicted: () => predictor?.() ?? null,
    setPredictor(next: (() => TrackedPose | null) | null) {
      predictor = next;
    },
  };
}

export const vrcCameraStore = createVrcCameraStore();

export function useVrcCameraSnapshot(): VrcCameraSnapshot | null {
  return useSyncExternalStore(vrcCameraStore.subscribe, vrcCameraStore.get, vrcCameraStore.get);
}

export function useVrcCameraControls(): VrcCameraControls | null {
  return useSyncExternalStore(
    vrcCameraStore.subscribe,
    vrcCameraStore.controls,
    vrcCameraStore.controls,
  );
}

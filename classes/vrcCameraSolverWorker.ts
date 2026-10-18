/// <reference lib="deno.worker" />
/**
 * Runs `solveVrcCameraCalibration` off the render thread: one solve takes 60–110 ms, which the
 * webxr worker cannot spend inside a 13 ms frame. See `createVrcCameraWorkerSolver`.
 */
import {
  solveVrcCameraCalibration,
  type VrcCameraCalibrationSample,
} from "./vrcCameraCalibration.ts";

self.onmessage = (event: MessageEvent<{ id: number; samples: VrcCameraCalibrationSample[] }>) => {
  const { id, samples } = event.data;
  try {
    self.postMessage({ id, fit: solveVrcCameraCalibration(samples) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};

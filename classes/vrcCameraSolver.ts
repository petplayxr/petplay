import type {
  VrcCameraCalibration,
  VrcCameraCalibrationSample,
  VrcCameraSolver,
} from "./vrcCameraCalibration.ts";

/**
 * A `VrcCameraSolver` backed by one long-lived worker, started on first use. `dispose` stops it.
 */
export function createVrcCameraWorkerSolver(): VrcCameraSolver & { dispose(): void } {
  let worker: Worker | null = null;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (fit: VrcCameraCalibration | null) => void; reject: (error: Error) => void }
  >();
  const start = () => {
    const created = new Worker(new URL("./vrcCameraSolverWorker.ts", import.meta.url), {
      type: "module",
    });
    created.onmessage = (
      event: MessageEvent<{ id: number; fit?: VrcCameraCalibration | null; error?: string }>,
    ) => {
      const request = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.error != null) request?.reject(new Error(event.data.error));
      else request?.resolve(event.data.fit ?? null);
    };
    created.onerror = (event) => {
      event.preventDefault();
      for (const request of pending.values()) request.reject(new Error(event.message));
      pending.clear();
      worker = null; // Restarted by the next solve.
    };
    return created;
  };
  const solve = (samples: VrcCameraCalibrationSample[]) =>
    new Promise<VrcCameraCalibration | null>((resolve, reject) => {
      worker ??= start();
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, samples });
    });
  return Object.assign(solve, {
    dispose() {
      worker?.terminate();
      worker = null;
      for (const request of pending.values()) request.reject(new Error("solver disposed"));
      pending.clear();
    },
  });
}

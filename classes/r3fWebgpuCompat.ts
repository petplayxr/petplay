export * from "npm:@react-three/fiber@10.0.0-alpha.5/webgpu";

import { getScheduler, useStore } from "npm:@react-three/fiber@10.0.0-alpha.5/webgpu";
import type {
  FrameNextState,
  UseFrameNextOptions,
} from "npm:@react-three/fiber@10.0.0-alpha.5/webgpu";
import React from "react";
import { currentXRFrame } from "./xrFrameBridge.ts";

/**
 * Legacy `useFrame` callback: optional third argument is `XRFrame`.
 * R3F v10 `FrameNextCallback` is only `(state, delta)`; see `node_modules/@react-three/fiber/dist/webgpu/index.d.ts`.
 *
 * **v10 `UseFrameNextOptions` pass-through:** `phase`, `fps`, `drop`, `enabled`, `id`, etc. are
 * forwarded to the scheduler as-is. A **numeric** second argument is still treated as
 * `priority` for backwards compatibility.
 */
export type LegacyUseFrameCallback = (
  state: FrameNextState,
  delta: number,
  xrFrame?: XRFrame | null,
) => void;

/** Legacy `THREE.Clock` subset that the old callback API exposed as `state.clock`. */
type FrameClock = {
  elapsed: number;
  delta: number;
  getElapsedTime: () => number;
  getDelta: () => number;
};

type LegacyFrameState = FrameNextState & { clock: FrameClock };

const callbackOptionsKey = (options?: UseFrameNextOptions | number): string =>
  typeof options === "number" ? `p:${options}` : options
    ? JSON.stringify({
      id: options.id,
      phase: options.phase,
      priority: options.priority,
      fps: options.fps,
      drop: options.drop,
      enabled: options.enabled,
      before: options.before,
      after: options.after,
    })
    : "";

type SchedulerJob = {
  id: string;
  enabled: boolean;
  fps?: number;
  drop?: boolean;
  lastRun?: number;
  lastRunElapsed?: number;
  callback: (state: unknown, delta: number) => void;
};
type SchedulerRoot = {
  needsRebuild: boolean;
  sortedJobs: SchedulerJob[];
  lastTickTime: number | null;
  accumulatedTime: number;
  getState?: () => Record<string, unknown>;
};
type SchedulerInternals = {
  phaseGraph: unknown;
  loopState: { frameCount: number };
  computeRootDelta(root: SchedulerRoot, timestamp: number, driverDelta: number): number;
  triggerError(error: Error): void;
  tickRoot(root: SchedulerRoot, timestamp: number, driverDelta: number): void;
};

/** `@pmndrs/scheduler` 0.2.0's private `shouldRun`, unchanged. */
function shouldRunJob(job: SchedulerJob, now: number): boolean {
  if (!job.enabled) return false;
  if (!job.fps) return true;
  const minInterval = 1e3 / job.fps;
  const lastRun = job.lastRun ?? 0;
  const elapsed = now - lastRun;
  if (elapsed < minInterval - 1) return false;
  if (job.drop) {
    job.lastRun = now;
  } else {
    const steps = Math.floor(elapsed / minInterval);
    job.lastRun = lastRun + steps * minInterval;
    if (job.lastRun < now - minInterval) job.lastRun = now;
  }
  return true;
}

/**
 * `Scheduler#tickRoot` from `@pmndrs/scheduler` 0.2.0 with one change. A job that ran last tick
 * gets the shared frame state only if `accumulatedTime - lastRunElapsed === delta`, and in floating
 * point that is almost never exact, so every job (743 in a full scene) got its own spread of the
 * ~50-key store state every frame: about 30 MB/s of garbage, which is what made the webxr worker's
 * old space fill and stall the simulation for up to a second per full GC. Deltas now match within
 * a microsecond; fps-limited jobs, whose delta really differs, still get their own copy.
 */
function patchSchedulerTickRoot(): void {
  const scheduler = getScheduler() as unknown as SchedulerInternals;
  const proto = Object.getPrototypeOf(scheduler) as SchedulerInternals & {
    __petplayTickRoot?: true;
  };
  if (proto.__petplayTickRoot) return;
  proto.__petplayTickRoot = true;
  const original = proto.tickRoot;
  proto.tickRoot = function (this: SchedulerInternals, root, timestamp, driverDelta) {
    // Re-sorting jobs needs the library's private `rebuildSortedJobs`: that frame runs unpatched.
    if (root.needsRebuild) return original.call(this, root, timestamp, driverDelta);
    const delta = this.computeRootDelta(root, timestamp, driverDelta);
    root.lastTickTime = timestamp;
    root.accumulatedTime += delta;
    const frameState = {
      ...(root.getState?.() ?? {}),
      time: timestamp,
      delta,
      elapsed: root.accumulatedTime,
      frame: this.loopState.frameCount,
    };
    for (const job of root.sortedJobs) {
      if (!shouldRunJob(job, timestamp)) continue;
      const jobDelta = job.lastRunElapsed === undefined
        ? delta
        : root.accumulatedTime - job.lastRunElapsed;
      job.lastRunElapsed = root.accumulatedTime;
      const sameDelta = Math.abs(jobDelta - delta) < 1e-6;
      const jobState = sameDelta ? frameState : { ...frameState, delta: jobDelta };
      try {
        job.callback(jobState, sameDelta ? delta : jobDelta);
      } catch (error) {
        console.error(`[Scheduler] Error in job "${job.id}":`, error);
        this.triggerError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
patchSchedulerTickRoot();

/**
 * R3F-compatible `useFrame` that registers directly with the scheduler.
 *
 * The stock hook wraps every callback in `(state, delta) => ({...store.getState(), time, delta,
 * elapsed, frame})`, allocating a fresh ~45-key object for **every registered job on every frame**
 * — with this scene's ~460 jobs (one per uikit node, one per `Handle`, one per XR pointer) that is
 * the single largest JS cost in the overlay's frame budget, and it scales with UI size rather than
 * scene size. The scheduler already builds that exact object once per frame in
 * `Scheduler#tickRoot` and hands it to the job, so register the callback ourselves and pass it
 * through, attaching only the legacy per-hook clock.
 *
 * Registration semantics match the stock hook: the job is (re)registered when the store,
 * the resolved id, or any option in {@link callbackOptionsKey} changes, and the latest callback is
 * read at frame time, so callers may pass an inline closure without re-registering.
 *
 * A numeric `priority` is honoured as `{ priority }`. Legacy numeric priorities above zero
 * additionally suppressed R3F's internal render job by bumping `internal.priority`; no caller in
 * this repository uses one (and the overlay patches the render phase itself), so that side effect
 * is intentionally not reproduced.
 */
export function useFrame(
  callback?: LegacyUseFrameCallback,
  options?: UseFrameNextOptions | number,
): void {
  const store = useStore();
  const scheduler = getScheduler();
  const optionsKey = callbackOptionsKey(options);
  // Underlying option object identity only needs to change when `optionsKey` changes: an inline
  // `{ phase: "finish" }` literal must not re-register the job on every render.
  const registrationOptions = React.useMemo<UseFrameNextOptions>(
    () => (typeof options === "number" ? { priority: options } : options ?? {}),
    [optionsKey],
  );
  const jobId = registrationOptions.id ?? `petplay-frame-${React.useId()}`;

  // The scheduler calls jobs synchronously from `advance()`, so a stable per-hook clock can be
  // attached to the frame state for the duration of the callback.
  const clockRef = React.useRef<FrameClock>({
    elapsed: 0,
    delta: 0,
    getElapsedTime() {
      return this.elapsed;
    },
    getDelta() {
      return this.delta;
    },
  });
  const callbackRef = React.useRef(callback);
  React.useLayoutEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  React.useLayoutEffect(() => {
    const rootId = store.getState().internal.rootId;
    const job = (state: FrameNextState, delta: number): void => {
      const onFrame = callbackRef.current;
      if (onFrame == null) {
        return;
      }
      const clock = clockRef.current;
      clock.elapsed += delta;
      clock.delta = delta;
      const legacyState = state as LegacyFrameState;
      legacyState.clock = clock;
      onFrame(legacyState, delta, currentXRFrame.value);
    };
    return scheduler.register(job, {
      ...registrationOptions,
      id: jobId,
      rootId,
    });
    // Only `optionsKey` (not `registrationOptions`) drives re-registration: the options object is
    // recreated from that key, so its identity carries no extra information.
  }, [store, scheduler, jobId, optionsKey]);
}

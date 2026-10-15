/**
 * Measurement: how many frames a laser-grabbed window trails the
 * controller, and how long frames take when the window's hover chrome appears.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { aim, display, LEFT_ORIGIN, showWindows, squeeze, worldOf } from "./lib/steps.ts";

type FrameCb = (state: unknown, delta: number) => void;

function onFrame(ctx: PlaytestContext, priority: number, cb: FrameCb): () => void {
  // deno-lint-ignore no-explicit-any
  const internal = (ctx.host as any).rootStore.getState().internal;
  // r3f v10 scheduler: higher priority runs earlier.
  return internal.scheduler.register(cb, { priority, rootId: internal.rootId });
}

/** Least-squares slope and intercept of y over x. */
function fit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "grab-latency",
    run: async (ctx) => {
      const target = display(ctx);
      const start = worldOf(target).position;
      const right = worldOf(target).right;
      aim(ctx, "left", LEFT_ORIGIN, start);
      await ctx.sleep(400);
      squeeze(ctx, "left", true);
      await ctx.sleep(300);
      // Each frame: record where the window is now, then command the next hand offset.
      // Input set in frame k is sampled at the start of frame k+1, so zero lag reads
      // offset(k) in frame k+1.
      const step = 0.004;
      const commanded: number[] = [];
      const seen: number[] = [];
      let k = 0;
      const stop = onFrame(ctx, -1e9, () => {
        const p = worldOf(display(ctx)).position.sub(start).dot(right);
        seen.push(p);
        k++;
        const offset = right.clone().multiplyScalar(step * k);
        commanded.push(step * k);
        aim(ctx, "left", LEFT_ORIGIN.clone().add(offset), start.clone().add(offset));
      });
      await ctx.waitFor(() => k >= 90, "90 frames of drag", 10_000);
      stop();
      squeeze(ctx, "left", false);
      await ctx.sleep(300);
      ctx.t.parkLeftHand();
      // seen[i] ~ step * (i - lag) once moving; skip the first frames while the drag starts.
      const xs: number[] = [], ys: number[] = [];
      for (let i = 20; i < seen.length; i++) {
        xs.push(i);
        ys.push(seen[i]);
      }
      const { slope, intercept } = fit(xs, ys);
      // seen = slope * (i - lagFromCommand); lagFromCommand = -intercept / slope; minus the
      // inherent one frame between setting input and the next frame sampling it.
      const lag = -intercept / slope - 1;
      ctx.note(
        `slope ${(slope / step).toFixed(3)}x step; lag ${
          lag.toFixed(2)
        } frames beyond input sampling`,
      );
      ctx.note(`seen[20..30] ${ys.slice(0, 10).map((v) => (v / step).toFixed(1)).join(" ")}`);
      ctx.memo.grabLag = lag;
    },
  },
  {
    name: "hover-spike",
    run: async (ctx) => {
      const target = display(ctx);
      const centre = worldOf(target).position;
      ctx.t.parkLeftHand();
      await ctx.sleep(600);
      const intervals: number[] = [];
      let last = 0;
      let marker = -1;
      const stop = onFrame(ctx, -1e9, () => {
        const now = performance.now();
        if (last > 0) intervals.push(now - last);
        last = now;
      });
      await ctx.sleep(500);
      marker = intervals.length;
      aim(ctx, "left", LEFT_ORIGIN, centre);
      await ctx.sleep(1000);
      const leaveAt = intervals.length;
      ctx.t.parkLeftHand();
      await ctx.sleep(800);
      // Second hover: is the spike only on first appearance?
      const second = intervals.length;
      aim(ctx, "left", LEFT_ORIGIN, centre);
      await ctx.sleep(1000);
      stop();
      ctx.t.parkLeftHand();
      const fmt = (a: number[]) => a.map((v) => v.toFixed(0)).join(" ");
      const before = intervals.slice(0, marker);
      const med = [...before].sort((a, b) => a - b)[before.length >> 1];
      ctx.note(`baseline median ${med?.toFixed(1)}ms max ${Math.max(...before).toFixed(1)}ms`);
      ctx.note(`hover1 first 15: ${fmt(intervals.slice(marker, marker + 15))}`);
      ctx.note(`leave first 10: ${fmt(intervals.slice(leaveAt, leaveAt + 10))}`);
      ctx.note(`hover2 first 15: ${fmt(intervals.slice(second, second + 15))}`);
      ctx.note(`hover1 max ${Math.max(...intervals.slice(marker, leaveAt)).toFixed(1)}ms`);
      ctx.note(`hover2 max ${Math.max(...intervals.slice(second)).toFixed(1)}ms`);
    },
  },
];

/**
 * Measurement: frame drops and r3f update cost while a window is
 * laser-grabbed and swept around, and while its hover chrome comes and goes. Meant to run on
 * a live OpenVR server through `/eval`, where the stability counters are the real ones.
 */
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { aim, display, LEFT_ORIGIN, showWindows, squeeze, worldOf } from "./lib/steps.ts";

type Stats = { frames: number; worstUpdate: number; over4: number; intervals: number[] };

/** Times the r3f update phase each frame: one job first, one job last. */
function timeFrames(ctx: PlaytestContext, perFrame?: (frame: number) => void) {
  // deno-lint-ignore no-explicit-any
  const internal = (ctx.host as any).rootStore.getState().internal;
  const stats: Stats = { frames: 0, worstUpdate: 0, over4: 0, intervals: [] };
  let start = 0;
  let last = 0;
  const first = internal.scheduler.register(() => {
    start = performance.now();
  }, { priority: 1e9, rootId: internal.rootId });
  const end = internal.scheduler.register(() => {
    const now = performance.now();
    const cost = now - start;
    stats.worstUpdate = Math.max(stats.worstUpdate, cost);
    if (cost > 4) stats.over4++;
    if (last > 0) stats.intervals.push(now - last);
    last = now;
    perFrame?.(stats.frames);
    stats.frames++;
  }, { priority: -1e9, rootId: internal.rootId });
  return {
    stats,
    stop: () => {
      first();
      end();
    },
  };
}

function summary(name: string, stats: Stats): string {
  const sorted = [...stats.intervals].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const over20 = stats.intervals.filter((v) => v > 20).length;
  return `${name}: frames ${stats.frames} updateWorst ${stats.worstUpdate.toFixed(1)}ms ` +
    `update>4ms ${stats.over4} interval p50 ${p(0.5)?.toFixed(1)} p99 ${p(0.99)?.toFixed(1)} ` +
    `max ${sorted.at(-1)?.toFixed(1)} >20ms ${over20}`;
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "idle-baseline",
    run: async (ctx) => {
      ctx.t.parkLeftHand();
      const timer = timeFrames(ctx);
      await ctx.sleep(6000);
      timer.stop();
      ctx.note(summary("idle", timer.stats));
    },
  },
  {
    name: "grab-sweep",
    run: async (ctx) => {
      const target = display(ctx);
      const { position: start, right } = worldOf(target);
      const up = right.clone().set(0, 1, 0);
      aim(ctx, "left", LEFT_ORIGIN, start);
      await ctx.sleep(400);
      squeeze(ctx, "left", true);
      await ctx.sleep(300);
      ctx.note(`sweep starts ${new Date().toISOString()}`);
      // A hand-like sweep: 0.3 m side to side, a little up and down, ~1 Hz.
      const timer = timeFrames(ctx, (frame) => {
        const t = frame / 75;
        const offset = right.clone().multiplyScalar(0.15 * Math.sin(2 * Math.PI * 0.8 * t))
          .addScaledVector(up, 0.05 * Math.sin(2 * Math.PI * 1.3 * t));
        aim(ctx, "left", LEFT_ORIGIN.clone().add(offset), start.clone().add(offset));
      });
      await ctx.sleep(6000);
      timer.stop();
      ctx.note(`sweep ends ${new Date().toISOString()}`);
      aim(ctx, "left", LEFT_ORIGIN, start);
      await ctx.sleep(200);
      squeeze(ctx, "left", false);
      await ctx.sleep(300);
      ctx.t.parkLeftHand();
      ctx.note(summary("grab", timer.stats));
    },
  },
  {
    name: "hover-cycles",
    run: async (ctx) => {
      const centre = worldOf(display(ctx)).position;
      ctx.t.parkLeftHand();
      await ctx.sleep(500);
      ctx.note(`hover starts ${new Date().toISOString()}`);
      const timer = timeFrames(ctx);
      for (let i = 0; i < 4; i++) {
        aim(ctx, "left", LEFT_ORIGIN, centre);
        await ctx.sleep(900);
        ctx.t.parkLeftHand();
        await ctx.sleep(600);
      }
      timer.stop();
      ctx.note(summary("hover", timer.stats));
    },
  },
];

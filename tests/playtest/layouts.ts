/**
 * Layout playtest: what keeps a layout where you put it. Lock a window from its toolbar, save the
 * layout to a slot and load it back, and recenter from the wrist.
 *
 * Run with `deno task playtest layouts`.
 */
import {
  type PlaytestContext,
  type PlaytestStep,
  WRIST_LAYOUTS,
  WRIST_MAIN,
  WRIST_SETTINGS,
} from "../../utils/playtest.ts";
import { getSpatialGraph } from "../../classes/environment/workspaceLayoutStore.ts";
import { ICON_CODEPOINTS } from "../../classes/environment/ui/icons.tsx";
import {
  display,
  laserClick,
  laserDrag,
  rootDisplayId,
  showWindows,
  toolbarOf,
  worldOf,
} from "./lib/steps.ts";

function node() {
  const id = rootDisplayId();
  return id == null ? undefined : getSpatialGraph()?.nodes[id];
}

function position(): [number, number, number] {
  const found = node();
  if (found == null) throw new Error("no top-level display in the layout");
  return [...found.localTransform.position];
}

function distance(a: readonly number[], b: readonly number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

async function clickToolbarLock(ctx: PlaytestContext) {
  const toolbar = toolbarOf(display(ctx));
  if (!ctx.expect(toolbar, "the window is selected and shows its toolbar")) return false;
  const icon = ctx.textObject(toolbar!, String.fromCodePoint(ICON_CODEPOINTS.lock));
  if (!ctx.expect(icon, "the toolbar has a lock button")) return false;
  await laserClick(ctx, worldOf(icon!).position);
  return true;
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "lock",
    run: async (ctx) => {
      // A short drag selects the window, which brings up its toolbar.
      await laserDrag(ctx, 0.05);
      if (!await clickToolbarLock(ctx)) return;
      if (
        !await ctx.waitFor(() => node()?.locked === true, "the toolbar's lock locks the window")
      ) {
        return;
      }
      const moved = await laserDrag(ctx, 0.25);
      ctx.note(`locked drag moved ${moved.toFixed(3)} m`);
      ctx.expect(moved < 0.01, `a locked window stays put (moved ${moved.toFixed(3)} m)`);
    },
  },
  {
    name: "unlock",
    run: async (ctx) => {
      if (!await clickToolbarLock(ctx)) return;
      if (!await ctx.waitFor(() => node()?.locked !== true, "the lock button unlocks it again")) {
        return;
      }
      const moved = await laserDrag(ctx, 0.25);
      ctx.expect(moved > 0.1, `an unlocked window moves again (moved ${moved.toFixed(3)} m)`);
    },
  },
  {
    name: "save-load",
    run: async (ctx) => {
      const saved = position();
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      await ctx.t.clickWristMenu(WRIST_SETTINGS.layouts);
      await ctx.t.clickWristMenu(WRIST_LAYOUTS.save(1));
      await ctx.settle();
      ctx.t.parkLeftHand();
      const moved = await laserDrag(ctx, -0.3);
      ctx.expect(moved > 0.1, `the window moves away from the saved spot (${moved.toFixed(3)} m)`);
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_LAYOUTS.load(1));
      await ctx.waitFor(
        () => distance(position(), saved) < 0.01,
        "loading slot 1 puts the window back where it was saved",
      );
      ctx.note(`off by ${distance(position(), saved).toFixed(4)} m after load`);
      await ctx.t.clickWristMenu(WRIST_LAYOUTS.back);
      await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
    },
  },
  {
    name: "recenter",
    run: async (ctx) => {
      await laserDrag(ctx, 0.5);
      const before = position();
      ctx.note(`before: ${before.map((v) => v.toFixed(2)).join(", ")}`);
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.recenter);
      ctx.t.parkLeftHand();
      // The IWER head sits at the origin looking down -z.
      await ctx.waitFor(() => {
        const [x, , z] = position();
        return Math.abs(x) < 0.05 && z < -0.2;
      }, "recenter puts the window straight ahead of the head");
      ctx.note(`after: ${position().map((v) => v.toFixed(2)).join(", ")}`);
    },
  },
];

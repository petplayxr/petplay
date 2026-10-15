/**
 * Measurement: frame stalls when the window layer is shown and hidden
 * repeatedly, past the first show that builds the windows.
 */
import type { PlaytestStep } from "../../utils/playtest.ts";
import { WRIST_MAIN } from "../../utils/playtest.ts";
import { showWindows } from "./lib/steps.ts";
import { getWindowLayerVisible } from "../../classes/environment/windowLayerMode.ts";

function toggle(name: string, want: boolean): PlaytestStep {
  return {
    name,
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      await ctx.settle();
      await ctx.t.clickWristMenu(WRIST_MAIN.layout);
      await ctx.waitFor(() => getWindowLayerVisible() === want, `window layer visible=${want}`);
      await ctx.settle();
    },
  };
}

export const steps: PlaytestStep[] = [
  showWindows,
  toggle("hide-1", false),
  toggle("show-2", true),
  toggle("hide-2", false),
  toggle("show-3", true),
];

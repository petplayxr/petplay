/**
 * Window lifecycle playtest: add a display beside a window from its toolbar, detach it (it stays
 * where it was and stops following the parent), delete it, and anchor a window to the left hand.
 *
 * Run with `deno task playtest lifecycle`.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { getSpatialGraph } from "../../classes/environment/workspaceLayoutStore.ts";
import {
  aim,
  display,
  laserDrag,
  LEFT_ORIGIN,
  openSettings,
  press,
  rootDisplayId,
  showWindows,
  toolbarButton,
  worldOf,
} from "./lib/steps.ts";

function displays() {
  return Object.values(getSpatialGraph()?.nodes ?? {}).filter((node) => node.kind === "display");
}

/** The display this script added, kept in the memo across steps. */
function added(ctx: PlaytestContext) {
  const id = ctx.memo.addedId as string | undefined;
  return id == null ? undefined : getSpatialGraph()?.nodes[id];
}

function addedObject(ctx: PlaytestContext): THREE.Object3D | null {
  const id = ctx.memo.addedId as string | undefined;
  return id == null ? null : ctx.nodeObject(id);
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "add-display",
    run: async (ctx) => {
      const before = new Set(displays().map((node) => node.id));
      if (!await toolbarButton(ctx, "add")) return;
      if (
        !await ctx.waitFor(
          () => displays().some((node) => !before.has(node.id)),
          "the toolbar's add button adds a display",
        )
      ) return;
      const node = displays().find((candidate) => !before.has(candidate.id))!;
      ctx.memo.addedId = node.id;
      ctx.note(`added ${node.id} under ${node.parentId}`);
      ctx.expect(node.parentId === rootDisplayId(), "the new display is linked to the window");
      await ctx.waitFor(() => addedObject(ctx), "the new display is in the scene");
    },
  },
  {
    name: "detach",
    run: async (ctx) => {
      const object = addedObject(ctx);
      if (!ctx.expect(object, "the added display is in the scene")) return;
      const before = worldOf(object!).position;
      if (!await toolbarButton(ctx, "link", object!)) return;
      if (
        !await ctx.waitFor(() => added(ctx)?.parentId == null, "the link button detaches it")
      ) return;
      await ctx.sleep(300);
      const after = addedObject(ctx);
      if (!ctx.expect(after, "the detached display is still in the scene")) return;
      const jump = worldOf(after!).position.distanceTo(before);
      ctx.note(`detaching moved it ${jump.toFixed(4)} m`);
      ctx.expect(jump < 0.01, "detaching leaves the display where it was");
    },
  },
  {
    name: "detached-stays",
    run: async (ctx) => {
      const object = addedObject(ctx);
      if (!ctx.expect(object, "the detached display is in the scene")) return;
      const before = worldOf(object!).position;
      const moved = await laserDrag(ctx, 0.25);
      ctx.expect(moved > 0.1, "the original window still moves");
      const drift = worldOf(addedObject(ctx)!).position.distanceTo(before);
      ctx.note(`window moved ${moved.toFixed(3)} m, detached display ${drift.toFixed(4)} m`);
      ctx.expect(drift < 0.01, "a detached display no longer follows the window");
      // Not dragged back: dropping it where it was would dock it onto the detached display's slot.
    },
  },
  {
    name: "delete",
    run: async (ctx) => {
      const object = addedObject(ctx);
      if (!ctx.expect(object, "the detached display is in the scene")) return;
      if (!await toolbarButton(ctx, "delete", object!)) return;
      await ctx.waitFor(() => added(ctx) == null, "the delete button removes it from the layout");
      await ctx.waitFor(() => addedObject(ctx) == null, "and from the scene");
      ctx.expect(rootDisplayId() != null, "the original window is still there");
    },
  },
  {
    name: "anchor-left-hand",
    run: async (ctx) => {
      if (!await openSettings(ctx)) return;
      const node = () => getSpatialGraph()?.nodes[rootDisplayId() ?? ""];
      if (!await press(ctx, "Anchored to", "Left hand")) return;
      if (
        !await ctx.waitFor(() => node()?.originId === "left-hand", "anchoring to Left hand")
      ) return;
      // Hold the left hand pointing down, then slide it 0.3 m right without turning it: the
      // window should slide the same 0.3 m.
      const start = LEFT_ORIGIN.clone();
      const below = start.clone().add(new THREE.Vector3(0, -1, 0));
      aim(ctx, "left", start, below);
      await ctx.sleep(300);
      const before = worldOf(display(ctx)).position;
      const shift = new THREE.Vector3(0.3, 0, 0);
      aim(ctx, "left", start.clone().add(shift), below.clone().add(shift));
      await ctx.sleep(300);
      const moved = worldOf(display(ctx)).position.distanceTo(before);
      ctx.note(`a 0.3 m hand slide moved the window ${moved.toFixed(3)} m`);
      ctx.expect(Math.abs(moved - 0.3) < 0.03, "a hand-anchored window moves with the hand");
      // Back to World with the other hand: aiming the left one would carry the window off.
      try {
        if (!await openSettings(ctx, display(ctx), "right")) return;
        if (!await press(ctx, "Anchored to", "World", display(ctx), "right")) return;
        await ctx.waitFor(
          () => (node()?.originId ?? "scene") !== "left-hand",
          "and back to World",
        );
      } finally {
        ctx.t.parkLeftHand();
        await ctx.t.faceWristMenu();
      }
    },
  },
];

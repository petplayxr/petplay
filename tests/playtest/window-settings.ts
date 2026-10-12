/**
 * Window settings playtest: open a window's settings from its toolbar and press each control,
 * checking the layout follows (opacity, curve, laser-drives-mouse, hide-when-looking-away, reset
 * pose, anchoring to the head).
 *
 * Run with `deno task playtest window-settings`.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import {
  editSpatialGraph,
  getSpatialGraph,
} from "../../classes/environment/workspaceLayoutStore.ts";
import { commitNodeTransform } from "../../classes/environment/spatialGraph.ts";
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

/** Turns the IWER head by `yaw` radians about +y (0 looks down -z). */
function turnHead(ctx: PlaytestContext, yaw: number) {
  const device = (ctx.host as unknown as {
    xrDevice: { quaternion: { set(x: number, y: number, z: number, w: number): void } };
  }).xrDevice;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  device.quaternion.set(turn.x, turn.y, turn.z, turn.w);
}

/** The pill labelled `label` in the settings section labelled `section`. */
function pill(ctx: PlaytestContext, section: string, label: string): THREE.Object3D | null {
  let scope: THREE.Object3D | null = ctx.textObject(display(ctx), section);
  while (scope != null) {
    const found = ctx.textObject(scope, label);
    if (found != null) return found;
    scope = scope.parent;
  }
  return null;
}

async function press(ctx: PlaytestContext, section: string, label: string) {
  const target = pill(ctx, section, label);
  if (!ctx.expect(target, `the ${section} section has a ${label} pill`)) return false;
  await ctx.clickObject(target!, display(ctx));
  return true;
}

async function openSettings(ctx: PlaytestContext) {
  if (ctx.textObject(display(ctx), "Opacity") != null) return true;
  if (toolbarOf(display(ctx)) == null) await laserDrag(ctx, 0.05);
  const toolbar = toolbarOf(display(ctx));
  if (!ctx.expect(toolbar, "the window is selected and shows its toolbar")) return false;
  const icon = ctx.textObject(toolbar!, "");
  if (!ctx.expect(icon, "the toolbar has a settings button")) return false;
  await laserClick(ctx, worldOf(icon!).position);
  return await ctx.waitFor(
    () => ctx.textObject(display(ctx), "Opacity"),
    "the toolbar's settings button opens the window's settings",
  );
}

/** Presses `on`, waits for `check`, then presses `off` and waits for it to clear. */
function toggleStep(
  name: string,
  section: string,
  on: string,
  off: string,
  check: () => boolean,
): PlaytestStep {
  return {
    name,
    run: async (ctx) => {
      if (!await openSettings(ctx)) return;
      if (!await press(ctx, section, on)) return;
      if (!await ctx.waitFor(check, `${section}: ${on} takes effect`)) return;
      if (!await press(ctx, section, off)) return;
      await ctx.waitFor(() => !check(), `${section}: ${off} puts it back`);
    },
  };
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "open-settings",
    run: async (ctx) => {
      await openSettings(ctx);
    },
  },
  toggleStep("opacity", "Opacity", "50%", "100%", () => node()?.opacity === 0.5),
  toggleStep("curve", "Curve", "20%", "Flat", () => node()?.curvature === 0.2),
  toggleStep("mouse", "Laser drives mouse", "Off", "On", () => node()?.mouseBlocked === true),
  {
    name: "auto-hide",
    run: async (ctx) => {
      if (!await openSettings(ctx)) return;
      if (!await press(ctx, "Hide when looking away", "On")) return;
      if (!await ctx.waitFor(() => node()?.autoHide === true, "Hide when looking away: On")) return;
      // This window's own fade, not that of a display attached under it (auto-hide is per window).
      const factor = () => {
        let value: number | undefined;
        display(ctx).traverse((object) => {
          if (value != null || typeof object.userData?.autoHideFactor !== "number") return;
          let owner: THREE.Object3D | null = object;
          while (owner != null && owner.userData?.spatialElementId == null) owner = owner.parent;
          if (owner?.userData.spatialElementId === rootDisplayId()) {
            value = object.userData.autoHideFactor;
          }
        });
        return value;
      };
      try {
        turnHead(ctx, Math.PI / 2);
        await ctx.waitFor(() => factor() === 0, "the window fades out when the head turns away");
        turnHead(ctx, 0);
        await ctx.waitFor(() => factor() === 1, "and back in when the head faces it again");
      } finally {
        turnHead(ctx, 0);
      }
      await ctx.sleep(300);
      if (!await press(ctx, "Hide when looking away", "Off")) return;
      await ctx.waitFor(() => node()?.autoHide !== true, "Hide when looking away: Off");
    },
  },
  {
    name: "reset-pose",
    run: async (ctx) => {
      // Tilt it first, so there is something to reset.
      const id = rootDisplayId()!;
      const before = node()!.localTransform;
      editSpatialGraph((graph) =>
        commitNodeTransform(graph, id, { ...before, rotation: [0, 0.4, 0] })
      );
      await ctx.waitFor(() => node()?.localTransform.rotation[1] === 0.4, "the tilt lands");
      if (!await openSettings(ctx)) return;
      const label = ctx.textObject(display(ctx), "Reset pose");
      if (!ctx.expect(label, "the settings have a Reset pose pill")) return;
      await ctx.clickObject(label!, display(ctx));
      await ctx.waitFor(
        () => node()?.localTransform.rotation.every((r) => r === 0),
        "Reset pose squares the window up",
      );
    },
  },
  {
    name: "anchor-head",
    run: async (ctx) => {
      if (!await openSettings(ctx)) return;
      const label = rootDisplayId() === node()?.id ? "Anchored to" : "Group anchored to";
      if (!await press(ctx, label, "Head")) return;
      if (!await ctx.waitFor(() => node()?.originId === "head", "anchoring to Head")) return;
      // The window should ride along when the head turns.
      const before = worldOf(display(ctx)).position;
      turnHead(ctx, 0.6);
      try {
        await ctx.sleep(500);
        const moved = worldOf(display(ctx)).position.distanceTo(before);
        ctx.note(`head turn moved the window ${moved.toFixed(3)} m`);
        ctx.expect(moved > 0.2, "a head-anchored window follows the head");
      } finally {
        turnHead(ctx, 0);
        await ctx.sleep(300);
      }
      if (!await openSettings(ctx)) return;
      if (!await press(ctx, label, "World")) return;
      await ctx.waitFor(() => (node()?.originId ?? "scene") !== "head", "and back to World");
    },
  },
];

/**
 * Smoke playtest: the everyday path, end to end, in `--novr`. Show the windows from the wrist,
 * move a window, resize it, type on the keyboard, open the window's settings, change a setting.
 *
 * Run with `deno task playtest smoke`. Steps run inside the `webxr` actor (see
 * `utils/playtest.ts`), so imports here resolve to the same modules the app uses.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { aimAt, type HandState } from "../../utils/overlay-perf-harness.ts";
import {
  type PlaytestContext,
  type PlaytestStep,
  WRIST_MAIN,
  WRIST_SETTINGS,
} from "../../utils/playtest.ts";
import { getSpatialGraph } from "../../classes/environment/workspaceLayoutStore.ts";
import { getWindowLayerVisible } from "../../classes/environment/windowLayerMode.ts";
import { onKeyboardEvent } from "../../classes/environment/keyboard/keyEvents.ts";
import type { KeyboardLogicEvent } from "../../classes/environment/keyboard/types.ts";
import { getSetting } from "../../classes/settings.ts";

/** Where the synthetic hands point from: either side of the IWER default head at 1.6 m. */
const LEFT_ORIGIN = new THREE.Vector3(-0.15, 1.45, 0);
const RIGHT_ORIGIN = new THREE.Vector3(0.15, 1.45, 0);

/** The top-level display: the one a grab moves. */
function rootDisplayId(): string | null {
  const graph = getSpatialGraph();
  const node = Object.values(graph?.nodes ?? {}).find((node) =>
    node.kind === "display" && node.parentId == null
  );
  return node?.id ?? null;
}

function worldOf(object: THREE.Object3D) {
  object.updateWorldMatrix(true, false);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  object.matrixWorld.decompose(position, quaternion, scale);
  return {
    position,
    quaternion,
    scale,
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion),
  };
}

function aim(ctx: PlaytestContext, hand: "left" | "right", from: THREE.Vector3, to: THREE.Vector3) {
  aimAt(ctx.t.input, hand, [from.x, from.y, from.z], [to.x, to.y, to.z]);
}

function squeeze(ctx: PlaytestContext, hand: "left" | "right", down: boolean) {
  (ctx.t.input[hand] as HandState).squeeze = down;
}

function display(ctx: PlaytestContext): THREE.Object3D {
  const id = rootDisplayId();
  if (id == null) throw new Error("no top-level display in the layout");
  const object = ctx.nodeObject(id);
  if (object == null) throw new Error(`${id} is not in the scene`);
  return object;
}

export const steps: PlaytestStep[] = [
  {
    name: "show-windows",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      if (!getWindowLayerVisible()) await ctx.t.clickWristMenu(WRIST_MAIN.layout);
      await ctx.waitFor(getWindowLayerVisible, "the wrist's windows tile shows the window layer");
      await ctx.waitFor(() => rootDisplayId() != null, "the layout has a top-level display");
      const id = rootDisplayId();
      if (id != null) await ctx.waitFor(() => ctx.nodeObject(id), `${id} is in the scene`);
      ctx.note(`display: ${id}`);
    },
  },
  {
    name: "move-window",
    run: async (ctx) => {
      const target = display(ctx);
      const before = worldOf(target).position;
      const shift = worldOf(target).right.multiplyScalar(0.25);
      // Laser grab: squeeze on the window, slide the whole ray sideways, let go.
      aim(ctx, "left", LEFT_ORIGIN, before);
      await ctx.sleep(300);
      squeeze(ctx, "left", true);
      await ctx.sleep(200);
      for (let i = 1; i <= 10; i++) {
        const offset = shift.clone().multiplyScalar(i / 10);
        aim(ctx, "left", LEFT_ORIGIN.clone().add(offset), before.clone().add(offset));
        await ctx.sleep(50);
      }
      await ctx.sleep(200);
      squeeze(ctx, "left", false);
      await ctx.sleep(300);
      ctx.t.parkLeftHand();
      const moved = worldOf(display(ctx)).position.distanceTo(before);
      ctx.note(`moved ${moved.toFixed(3)} m`);
      ctx.expect(moved > 0.1, `a laser grab moves the window (moved ${moved.toFixed(3)} m)`);
    },
  },
  {
    name: "resize-window",
    run: async (ctx) => {
      const { position: centre, right, scale } = worldOf(display(ctx));
      const before = scale.x;
      // Two-handed pinch: both lasers squeeze on the window, then spread apart.
      const at = (spread: number) => centre.clone().addScaledVector(right, spread);
      aim(ctx, "left", LEFT_ORIGIN, at(-0.1));
      aim(ctx, "right", RIGHT_ORIGIN, at(0.1));
      await ctx.sleep(300);
      squeeze(ctx, "left", true);
      squeeze(ctx, "right", true);
      await ctx.sleep(200);
      for (let i = 1; i <= 10; i++) {
        const spread = 0.1 + 0.05 * i / 10;
        aim(ctx, "left", LEFT_ORIGIN, at(-spread));
        aim(ctx, "right", RIGHT_ORIGIN, at(spread));
        await ctx.sleep(50);
      }
      await ctx.sleep(200);
      squeeze(ctx, "left", false);
      squeeze(ctx, "right", false);
      await ctx.sleep(300);
      ctx.t.parkLeftHand();
      const after = worldOf(display(ctx)).scale.x;
      ctx.note(`scale ${before.toFixed(3)} -> ${after.toFixed(3)}`);
      ctx.expect(after > before * 1.2, "a two-handed spread makes the window bigger");
    },
  },
  {
    name: "type",
    run: async (ctx) => {
      const keyboard = ctx.nodeObject("keyboard");
      if (!ctx.expect(keyboard, "the keyboard is in the scene with the windows")) return;
      const typed: KeyboardLogicEvent[] = [];
      const stop = onKeyboardEvent((event) => typed.push(event));
      try {
        for (const legend of ["h", "i"]) {
          // Legends follow caps lock and the locale's casing.
          const cap = ctx.textObject(keyboard!, legend) ??
            ctx.textObject(keyboard!, legend.toUpperCase());
          if (!ctx.expect(cap, `the keyboard has an ${legend} key`)) continue;
          await ctx.clickObject(cap!, keyboard!);
        }
        await ctx.waitFor(() => typed.length >= 2, "two key presses reach the keyboard sink");
      } finally {
        stop();
      }
      ctx.note(
        `typed: ${
          typed.map((event) => event.kind === "key" ? event.char ?? event.scanCodeHex : event.kind)
            .join(" ")
        }`,
      );
    },
  },
  {
    // The toolbar of a selected window hangs through its hinged keyboard; past the keys it must
    // still take the click.
    name: "window-settings",
    run: async (ctx) => {
      const target = display(ctx);
      let toolbar: THREE.Object3D | null = null;
      target.traverse((object) => {
        if (toolbar == null && object.userData?.spatialContextToolbar) toolbar = object;
      });
      if (!ctx.expect(toolbar, "the moved window is selected and shows its toolbar")) return;
      // The settings glyph (Material Symbols "settings").
      const icon = ctx.textObject(toolbar!, "\ue8b8");
      if (!ctx.expect(icon, "the toolbar has a settings button")) return;
      aim(ctx, "left", LEFT_ORIGIN, worldOf(icon!).position);
      await ctx.sleep(300);
      ctx.t.input.left.trigger = true;
      await ctx.sleep(150);
      ctx.t.input.left.trigger = false;
      await ctx.sleep(300);
      ctx.t.parkLeftHand();
      await ctx.waitFor(
        () => ctx.textObject(display(ctx), "Opacity"),
        "the toolbar's settings button opens the window's settings",
      );
    },
  },
  {
    name: "change-setting",
    run: async (ctx) => {
      const before = getSetting("grabboxOutline");
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      await ctx.t.clickWristMenu(WRIST_SETTINGS.grabboxOutline);
      const changed = await ctx.waitFor(
        () => getSetting("grabboxOutline") !== before,
        "the Settings page toggles the grab-box outline",
      );
      if (changed) {
        await ctx.t.clickWristMenu(WRIST_SETTINGS.grabboxOutline);
        await ctx.waitFor(() => getSetting("grabboxOutline") === before, "and toggles it back");
      }
      await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
    },
  },
];

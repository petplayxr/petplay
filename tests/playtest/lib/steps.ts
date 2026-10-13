/** Shared helpers for playtest scripts: synthetic hands and the top-level display. */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { aimAt, type HandState } from "../../../utils/overlay-perf-harness.ts";
import { type PlaytestContext, type PlaytestStep, WRIST_MAIN } from "../../../utils/playtest.ts";
import { getWindowLayerVisible } from "../../../classes/environment/windowLayerMode.ts";
import { getSpatialGraph } from "../../../classes/environment/workspaceLayoutStore.ts";
import { ICON_CODEPOINTS, type IconName } from "../../../classes/environment/ui/icons.tsx";

/** Where the synthetic hands point from: either side of the IWER default head at 1.6 m. */
export const LEFT_ORIGIN = new THREE.Vector3(-0.15, 1.45, 0);
export const RIGHT_ORIGIN = new THREE.Vector3(0.15, 1.45, 0);

/** The top-level display: the one a grab moves. */
export function rootDisplayId(): string | null {
  const graph = getSpatialGraph();
  const node = Object.values(graph?.nodes ?? {}).find((node) =>
    node.kind === "display" && node.parentId == null
  );
  return node?.id ?? null;
}

export function worldOf(object: THREE.Object3D) {
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

export function aim(
  ctx: PlaytestContext,
  hand: "left" | "right",
  from: THREE.Vector3,
  to: THREE.Vector3,
) {
  aimAt(ctx.t.input, hand, [from.x, from.y, from.z], [to.x, to.y, to.z]);
}

export function squeeze(ctx: PlaytestContext, hand: Hand, down: boolean) {
  (ctx.t.input[hand] as HandState).squeeze = down;
}

export function display(ctx: PlaytestContext): THREE.Object3D {
  const id = rootDisplayId();
  if (id == null) throw new Error("no top-level display in the layout");
  const object = ctx.nodeObject(id);
  if (object == null) throw new Error(`${id} is not in the scene`);
  return object;
}

/**
 * The display's own toolbar, if it is selected. Displays attached under it are skipped: their
 * toolbars are in its subtree too.
 */
export function toolbarOf(object: THREE.Object3D): THREE.Object3D | null {
  const own = object.userData?.spatialElementId;
  const search = (node: THREE.Object3D): THREE.Object3D | null => {
    for (const child of node.children) {
      // Every node keeps its toolbar mounted; only the selected one's shows.
      if (child.userData?.spatialContextToolbar) {
        if (child.visible) return child;
        continue;
      }
      const id = child.userData?.spatialElementId;
      if (id != null && id !== own) continue;
      const found = search(child);
      if (found != null) return found;
    }
    return null;
  };
  return search(object);
}

export type Hand = "left" | "right";

/**
 * Points a laser at `target` from `from` and pulls the trigger once. The left hand is parked
 * afterwards; the right one stays put (it holds the wrist menu, which `faceWristMenu` restores).
 * The right hand is for windows anchored to the left one, which move when the left hand aims.
 */
export async function laserClick(
  ctx: PlaytestContext,
  target: THREE.Vector3,
  hand: Hand = "left",
  from: THREE.Vector3 = hand === "left" ? LEFT_ORIGIN : RIGHT_ORIGIN,
) {
  aim(ctx, hand, from, target);
  await ctx.sleep(300);
  ctx.t.input[hand].trigger = true;
  await ctx.sleep(150);
  ctx.t.input[hand].trigger = false;
  await ctx.sleep(300);
  if (hand === "left") ctx.t.parkLeftHand();
}

/** Laser-grabs the top-level display and slides it `distance` m along its right axis. */
export async function laserDrag(ctx: PlaytestContext, distance: number) {
  const target = display(ctx);
  const before = worldOf(target).position;
  const shift = worldOf(target).right.multiplyScalar(distance);
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
  return worldOf(display(ctx)).position.distanceTo(before);
}

/** First step of most scripts: show the windows from the wrist and wait for the display. */
export const showWindows: PlaytestStep = {
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
};

/** Turns the IWER head by `yaw` radians about +y (0 looks down -z). */
export function turnHead(ctx: PlaytestContext, yaw: number) {
  const device = (ctx.host as unknown as {
    xrDevice: { quaternion: { set(x: number, y: number, z: number, w: number): void } };
  }).xrDevice;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  device.quaternion.set(turn.x, turn.y, turn.z, turn.w);
}

/** The pill labelled `label` in the settings section labelled `section` of `root`'s toolbar. */
export function pill(
  ctx: PlaytestContext,
  section: string,
  label: string,
  root: THREE.Object3D = display(ctx),
): THREE.Object3D | null {
  let scope: THREE.Object3D | null = ctx.textObject(root, section);
  while (scope != null) {
    const found = ctx.textObject(scope, label);
    if (found != null) return found;
    scope = scope.parent;
  }
  return null;
}

export async function press(
  ctx: PlaytestContext,
  section: string,
  label: string,
  root: THREE.Object3D = display(ctx),
  hand: Hand = "left",
) {
  const target = pill(ctx, section, label, root);
  if (!ctx.expect(target, `the ${section} section has a ${label} pill`)) return false;
  if (hand === "left") {
    await ctx.clickObject(target!, root);
  } else {
    // Straight on, from 0.6 m in front of the pill, like `clickObject`.
    const point = worldOf(target!).position;
    const facing = worldOf(root).quaternion;
    const from = new THREE.Vector3(0, 0, 0.6).applyQuaternion(facing).add(point);
    await laserClick(ctx, point, "right", from);
  }
  return true;
}

/** Selects `root` (by pointing at it) so its toolbar shows; returns the toolbar. */
export async function select(
  ctx: PlaytestContext,
  root: THREE.Object3D = display(ctx),
  hand: Hand = "left",
) {
  if (toolbarOf(root) == null) {
    aim(ctx, hand, hand === "left" ? LEFT_ORIGIN : RIGHT_ORIGIN, worldOf(root).position);
    await ctx.sleep(300);
    if (hand === "left") ctx.t.parkLeftHand();
  }
  await ctx.waitFor(() => toolbarOf(root), "pointing at the window selects it");
  return toolbarOf(root);
}

/** Clicks the toolbar button showing `icon` on `root`. */
export async function toolbarButton(
  ctx: PlaytestContext,
  icon: IconName,
  root: THREE.Object3D = display(ctx),
  hand: Hand = "left",
) {
  const toolbar = await select(ctx, root, hand);
  if (toolbar == null) return false;
  const glyph = ctx.textObject(toolbar, String.fromCodePoint(ICON_CODEPOINTS[icon]));
  if (!ctx.expect(glyph, `the toolbar has a ${icon} button`)) return false;
  await laserClick(ctx, worldOf(glyph!).position, hand);
  return true;
}

/** Opens `root`'s settings from its toolbar's settings button. */
export async function openSettings(
  ctx: PlaytestContext,
  root: THREE.Object3D = display(ctx),
  hand: Hand = "left",
) {
  if (ctx.textObject(root, "Opacity") != null) return true;
  if (!await toolbarButton(ctx, "settings", root, hand)) return false;
  return await ctx.waitFor(
    () => ctx.textObject(root, "Opacity"),
    "the toolbar's settings button opens the window's settings",
  );
}

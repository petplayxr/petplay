/** Shared helpers for playtest scripts: synthetic hands and the top-level display. */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { aimAt, type HandState } from "../../../utils/overlay-perf-harness.ts";
import { type PlaytestContext, type PlaytestStep, WRIST_MAIN } from "../../../utils/playtest.ts";
import { getWindowLayerVisible } from "../../../classes/environment/windowLayerMode.ts";
import { getSpatialGraph } from "../../../classes/environment/workspaceLayoutStore.ts";

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

export function squeeze(ctx: PlaytestContext, hand: "left" | "right", down: boolean) {
  (ctx.t.input[hand] as HandState).squeeze = down;
}

export function display(ctx: PlaytestContext): THREE.Object3D {
  const id = rootDisplayId();
  if (id == null) throw new Error("no top-level display in the layout");
  const object = ctx.nodeObject(id);
  if (object == null) throw new Error(`${id} is not in the scene`);
  return object;
}

/** The selected display's toolbar, if it shows one. */
export function toolbarOf(object: THREE.Object3D): THREE.Object3D | null {
  let toolbar: THREE.Object3D | null = null;
  object.traverse((child) => {
    if (toolbar == null && child.userData?.spatialContextToolbar) toolbar = child;
  });
  return toolbar;
}

/** Points the left laser at `target` and pulls the trigger once. */
export async function laserClick(ctx: PlaytestContext, target: THREE.Vector3) {
  aim(ctx, "left", LEFT_ORIGIN, target);
  await ctx.sleep(300);
  ctx.t.input.left.trigger = true;
  await ctx.sleep(150);
  ctx.t.input.left.trigger = false;
  await ctx.sleep(300);
  ctx.t.parkLeftHand();
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

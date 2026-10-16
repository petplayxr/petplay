import * as THREE from "three";
import { createDefaultLowerers, type RenderLowerer } from "../submodules/raythree/src/lib.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";

export type RenderAnchorSpace = "head" | "left-hand" | "right-hand" | "left-ray" | "right-ray";
export type RenderAnchor = {
  space: RenderAnchorSpace;
  localMatrix: Float64Array;
  /** Carried by a grab ({@link RenderTrackingFollow}) rather than parented to the space. */
  follow?: true;
  /** Carried by two hands: held in the {@link followFrame} spanning both grab points. */
  pair?: FollowPair;
};

/** The second hand of a two-hand grab, and each pointer's grab point in its own space. */
export type FollowPair = {
  space: RenderAnchorSpace;
  points: [ArrayLike<number>, ArrayLike<number>];
};
export type Anchored = { renderAnchor?: RenderAnchor };
export type RenderAnchors = Partial<Record<RenderAnchorSpace, ArrayLike<number>>>;
const spaces: readonly string[] = ["head", "left-hand", "right-hand", "left-ray", "right-ray"];

/**
 * Set on a subtree root (`userData.renderTrackingFollow`) while something tracked carries it but
 * it is not parented there: a window held by a controller. Its items are sent relative to `pose`,
 * the world pose of `space` that the worker placed the subtree from, so the renderer re-poses them
 * with its own fresh tracking like children of that space. `pose` must be the exact sample used
 * (a grab's pointer pose at apply time): any other sample of the same space differs by up to a
 * frame of hand motion, which shows as jitter. `active` lets a grab that ended without notice
 * lapse.
 */
export type RenderTrackingFollow = {
  space: RenderAnchorSpace;
  /** The {@link followFrame} the worker placed the subtree from. */
  pose: THREE.Matrix4;
  active: () => boolean;
  pair?: FollowPair;
};

/** Key of a carry's frame: one pointer space, or both for two hands. */
export function followKey(space: RenderAnchorSpace, pair?: FollowPair): string {
  return pair == null ? space : `${space}+${pair.space}`;
}

const frameA = new THREE.Matrix4();
const frameB = new THREE.Matrix4();
const pointA = new THREE.Vector3();
const pointB = new THREE.Vector3();
const frameX = new THREE.Vector3();
const frameY = new THREE.Vector3();
const frameZ = new THREE.Vector3();
const upB = new THREE.Vector3();

/**
 * The frame a carried subtree is held in. One hand: the pointer pose. Two hands: origin at the
 * midpoint of the grab points, x from the first to the second, up from both hands' up directions,
 * uniformly scaled by their distance. A two-pointer grab moves, turns, twists and scales the
 * window with exactly these quantities, so between worker frames the window stays put in this
 * frame and the renderer can carry it with fresh poses of both controllers.
 */
export function followFrame(
  anchors: Partial<Record<string, ArrayLike<number>>>,
  space: RenderAnchorSpace,
  pair: FollowPair | undefined,
  target = new THREE.Matrix4(),
): THREE.Matrix4 | null {
  const a = anchors[space];
  if (!a) return null;
  if (pair == null) return target.fromArray(a as number[]);
  const b = anchors[pair.space];
  if (!b) return null;
  frameA.fromArray(a as number[]);
  frameB.fromArray(b as number[]);
  pointA.fromArray(pair.points[0] as number[]).applyMatrix4(frameA);
  pointB.fromArray(pair.points[1] as number[]).applyMatrix4(frameB);
  frameX.subVectors(pointB, pointA);
  const distance = frameX.length();
  if (distance < 1e-6) return null;
  frameX.divideScalar(distance);
  frameY.set(0, 1, 0).transformDirection(frameA).add(upB.set(0, 1, 0).transformDirection(frameB));
  frameY.addScaledVector(frameX, -frameY.dot(frameX));
  if (frameY.lengthSq() < 1e-8) {
    // Both hands' up directions lie along the axis: any perpendicular is as good.
    frameY.set(0, 0, 1).addScaledVector(frameX, -frameX.z);
    if (frameY.lengthSq() < 1e-8) frameY.set(0, 1, 0).addScaledVector(frameX, -frameX.y);
  }
  frameY.normalize();
  frameZ.crossVectors(frameX, frameY);
  target.makeBasis(frameX, frameY, frameZ);
  target.scale(upB.setScalar(distance));
  return target.setPosition(pointA.add(pointB).multiplyScalar(0.5));
}

/** IWER defines grip space relative to its target-ray space, rather than the tracked device. */
export function setRenderHandAnchors(
  anchors: RenderAnchors,
  hand: "left" | "right",
  targetRay: ArrayLike<number>,
  gripOffset?: ArrayLike<number>,
): void {
  anchors[`${hand}-ray`] = targetRay;
  anchors[`${hand}-hand`] = gripOffset
    ? new THREE.Matrix4().fromArray(targetRay).multiply(new THREE.Matrix4().fromArray(gripOffset))
      .elements
    : targetRay;
}

/** The nearest tracked root defines a local transform, without baking its old tracking pose. */
export function captureRenderAnchor(
  object: THREE.Object3D,
  worldMatrix: ArrayLike<number>,
  /** Transform of `worldMatrix` relative to `object` (an instance matrix), if any. */
  objectLocal?: ArrayLike<number>,
): RenderAnchor | undefined {
  for (let root: THREE.Object3D | null = object; root; root = root.parent) {
    const follow = root.userData?.renderTrackingFollow as RenderTrackingFollow | undefined;
    if (follow?.active() && spaces.includes(follow.space)) {
      return followAnchor(follow, worldMatrix);
    }
    const space = root.userData?.renderTrackingAnchor;
    if (space === "world") return undefined;
    if (!spaces.includes(space)) continue;
    if (Math.abs(root.matrixWorld.determinant()) < 1e-12) return undefined;
    return { space, localMatrix: localMatrixUnder(root, object, worldMatrix, objectLocal) };
  }
}

const followHelper = new THREE.Matrix4();

function followAnchor(
  follow: RenderTrackingFollow,
  worldMatrix: ArrayLike<number>,
): RenderAnchor | undefined {
  if (Math.abs(follow.pose.determinant()) < 1e-12) return undefined;
  return {
    space: follow.space,
    follow: true,
    ...(follow.pair ? { pair: follow.pair } : {}),
    localMatrix: new Float64Array(
      followHelper.copy(follow.pose).invert()
        .multiply(chainHelper.fromArray(worldMatrix as number[])).elements,
    ),
  };
}

const chainHelper = new THREE.Matrix4();
const checkHelper = new THREE.Matrix4();

/**
 * Prefer the product of local matrices below the anchor: it does not change while the anchor
 * moves, so an unchanged scene keeps bit-identical anchor matrices (see fingerprintScene).
 * Inverting the moving world matrix instead adds float noise every frame. Fall back to that
 * when the chain does not reproduce `worldMatrix` (stale or externally set matrices).
 */
function localMatrixUnder(
  root: THREE.Object3D,
  object: THREE.Object3D,
  worldMatrix: ArrayLike<number>,
  objectLocal: ArrayLike<number> | undefined,
): Float64Array {
  const local = new THREE.Matrix4();
  if (objectLocal) local.fromArray(objectLocal as number[]);
  for (let node: THREE.Object3D | null = object; node && node !== root; node = node.parent) {
    local.premultiply(node.matrix);
  }
  checkHelper.multiplyMatrices(root.matrixWorld, local);
  let error = 0, scale = 0;
  for (let i = 0; i < 16; i++) {
    error = Math.max(error, Math.abs(checkHelper.elements[i]! - Number(worldMatrix[i])));
    scale = Math.max(scale, Math.abs(Number(worldMatrix[i])));
  }
  if (error <= 1e-4 * Math.max(1, scale)) return new Float64Array(local.elements);
  const inverted = chainHelper.copy(root.matrixWorld).invert()
    .multiply(local.fromArray(worldMatrix as number[])).elements;
  // uikit derives matrixWorld from layout, so its nodes take this path. Holding the previous
  // result through rounding noise keeps them bit-identical while nothing moves.
  const previous = objectLocal ? undefined : invertedLocals.get(object);
  if (previous) {
    let drift = 0, size = 1;
    for (let i = 0; i < 16; i++) {
      drift = Math.max(drift, Math.abs(previous[i]! - inverted[i]!));
      size = Math.max(size, Math.abs(inverted[i]!));
    }
    if (drift <= 1e-9 * size) return previous.slice();
  }
  const result = new Float64Array(inverted);
  if (!objectLocal) invertedLocals.set(object, result.slice());
  return result;
}

const invertedLocals = new WeakMap<THREE.Object3D, Float64Array>();

export function anchoredLowerers(): RenderLowerer[] {
  return createDefaultLowerers().map((lowerer) => ({
    canLower: (object) => lowerer.canLower(object),
    lower: (object, context) =>
      lowerer.lower(object, context).map((instance) => {
        (instance as typeof instance & Anchored).renderAnchor = captureRenderAnchor(
          object,
          instance.worldMatrix,
        );
        return instance;
      }),
  }));
}

/** Mutates only the child-owned working copy. The saved local matrices never change. */
export function resolveRenderAnchors(
  payload: WebXRRaythreeRenderPayload,
  anchors: RenderAnchors,
  /** Optional per-space tally of anchored items, resolved or not (tracking lost). */
  spaceCounts?: Partial<Record<RenderAnchorSpace, number>>,
  /**
   * Poses for grab-carried items only (`follow`), overriding `anchors`: a released grab holds
   * its window at the last shown pose until the worker's landed scene arrives.
   */
  followAnchors?: Partial<Record<string, ArrayLike<number>>>,
  /** Optional tally of grab-carried items per {@link followKey}. */
  followCounts?: Partial<Record<string, number>>,
): number {
  let count = 0;
  const resolve = (
    item: Anchored & {
      worldMatrix: Float32Array | Float64Array;
      normalMatrix?: Float64Array;
      clipping?: Float32Array;
    },
  ) => {
    const anchor = item.renderAnchor;
    if (!anchor) return;
    if (spaceCounts) spaceCounts[anchor.space] = (spaceCounts[anchor.space] ?? 0) + 1;
    let tracked: ArrayLike<number> | undefined | null = anchors[anchor.space];
    if (anchor.follow) {
      const key = followKey(anchor.space, anchor.pair);
      if (followCounts) followCounts[key] = (followCounts[key] ?? 0) + 1;
      tracked = followAnchors?.[key] ??
        (anchor.pair ? followFrame(anchors, anchor.space, anchor.pair)?.elements : tracked);
    }
    // Hold last visual placement on tracking loss, matching the existing scene policy.
    if (!tracked) return;
    const old = new THREE.Matrix4().fromArray(item.worldMatrix);
    const next = new THREE.Matrix4().fromArray(tracked).multiply(
      new THREE.Matrix4().fromArray(anchor.localMatrix),
    );
    if (item.clipping && Math.abs(old.determinant()) > 1e-12) {
      const delta = next.clone().multiply(old.clone().invert());
      const planeTransform = delta.invert().transpose();
      for (let i = 0; i < 16; i += 4) {
        const plane = new THREE.Vector4().fromArray(item.clipping, i).applyMatrix4(planeTransform);
        plane.toArray(item.clipping, i);
      }
    }
    // The process transport JSON-encodes typed arrays as numeric-keyed objects.
    // Indexed writes work for that wire representation as well as typed arrays.
    for (let i = 0; i < 16; i++) item.worldMatrix[i] = next.elements[i];
    if (item.normalMatrix) new THREE.Matrix3().getNormalMatrix(next).toArray(item.normalMatrix);
    count++;
  };
  // Extracted scene data is eye invariant; do not resolve an aliased eye twice.
  const eyes = new Set([payload.leftEye, payload.rightEye]);
  for (const eye of eyes) for (const item of eye.frame.instances) resolve(item);
  for (const items of [payload.ui.panels, payload.ui.texts, payload.ui.images]) {
    for (const item of items) {
      resolve(item);
    }
  }
  return count;
}

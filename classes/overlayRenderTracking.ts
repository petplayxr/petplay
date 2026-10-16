import * as THREE from "three";
import { createDefaultLowerers, type RenderLowerer } from "../submodules/raythree/src/lib.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";

export type RenderAnchorSpace = "head" | "left-hand" | "right-hand" | "left-ray" | "right-ray";
export type RenderAnchor = { space: RenderAnchorSpace; localMatrix: Float64Array };
export type Anchored = { renderAnchor?: RenderAnchor };
export type RenderAnchors = Partial<Record<RenderAnchorSpace, ArrayLike<number>>>;
const spaces: readonly string[] = ["head", "left-hand", "right-hand", "left-ray", "right-ray"];

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
): RenderAnchor | undefined {
  for (let root: THREE.Object3D | null = object; root; root = root.parent) {
    const space = root.userData?.renderTrackingAnchor;
    if (space === "world") return undefined;
    if (!spaces.includes(space)) continue;
    if (Math.abs(root.matrixWorld.determinant()) < 1e-12) return undefined;
    return {
      space,
      localMatrix: new Float64Array(
        new THREE.Matrix4().copy(root.matrixWorld).invert()
          .multiply(new THREE.Matrix4().fromArray(worldMatrix)).elements,
      ),
    };
  }
}

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
    const tracked = anchors[anchor.space];
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

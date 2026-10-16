/** Deterministic renderer-side control; bypasses scene/IR cadence and real controller tracking. */
import * as THREE from "three";
import { type WebXRRaythreeRenderPayload, WebXRRaythreeSceneBridge } from "./webxrRaythreeScene.ts";
import type { WebXRShadowFrame } from "./webxrhost.ts";
import type { Anchored, RenderAnchors } from "./overlayRenderTracking.ts";

export const MOTION_PROBE_PERIOD_MS = 2000;
export function motionProbeX(elapsedMs: number): number {
  return .25 * Math.sin(2 * Math.PI * elapsedMs / MOTION_PROBE_PERIOD_MS);
}

export function motionProbeFrame(eyeSize: number): WebXRShadowFrame {
  const camera = new THREE.PerspectiveCamera(90, 1, .05, 100);
  const identity = () => new Float32Array(new THREE.Matrix4().elements);
  return {
    frameCount: 0,
    eyeWidth: eyeSize,
    eyeHeight: eyeSize,
    outputWidth: eyeSize * 2,
    outputHeight: eyeSize * 2,
    lookRotation: identity(),
    viewerPosition: new Float32Array(3),
    viewerQuaternion: new Float32Array([0, 0, 0, 1]),
    leftEyePosition: new Float32Array([-.032, 0, 0]),
    rightEyePosition: new Float32Array([.032, 0, 0]),
    leftEyeQuaternion: new Float32Array([0, 0, 0, 1]),
    rightEyeQuaternion: new Float32Array([0, 0, 0, 1]),
    leftEyeViewMatrix: identity(),
    rightEyeViewMatrix: identity(),
    leftEyeProjectionMatrix: new Float32Array(camera.projectionMatrix.elements),
    rightEyeProjectionMatrix: new Float32Array(camera.projectionMatrix.elements),
    halfFovInRadians: Math.PI / 4,
    ipdMeters: .064,
  };
}

/** Diagnostic word: four sentinel cells, generation, its complement, four end cells. */
export function motionProbeCell(generation: number, cell: number): number {
  if (cell < 4) return [0, 0, 1, 0][cell];
  if (cell >= 36) return [1, 1, 0, 1][cell - 36];
  const bit = cell - 4;
  return ((generation >>> (bit % 16)) & 1) ^ (bit >= 16 ? 1 : 0);
}

/** Green controller marker; 16 head-fixed red/blue tiles encode generation, LSB at left. */
export class OverlayMotionProbe {
  readonly payload: WebXRRaythreeRenderPayload;
  private readonly bits: { localMatrix: Float64Array; bit: number; value: number; x: number }[] =
    [];
  constructor(frame: WebXRShadowFrame, readonly nativeController = false) {
    const scene = new THREE.Scene();
    const head = new THREE.Group();
    head.userData.renderTrackingAnchor = "head";
    scene.add(head);
    const ray = new THREE.Group();
    ray.userData.renderTrackingAnchor = "right-ray";
    scene.add(ray);
    ray.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(nativeController ? .025 : .045, nativeController ? .025 : .045),
        new THREE.MeshBasicMaterial({
          color: nativeController ? 0xff0000 : 0x00ff00,
          side: THREE.DoubleSide,
        }),
      ),
    );
    for (let bit = 0; bit < (nativeController ? 40 : 16); bit++) {
      for (let value = 0; value < 2; value++) {
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(.025, .035),
          new THREE.MeshBasicMaterial({
            color: value ? 0x0000ff : nativeController ? 0x00ff00 : 0xff0000,
            side: THREE.DoubleSide,
          }),
        );
        tile.name = `motion-probe-bit-${bit}-${value}`;
        tile.position.set((bit - (nativeController ? 19.5 : 7.5)) * .035, .22, -1);
        head.add(tile);
      }
    }
    const camera = new THREE.PerspectiveCamera(90, 1, .05, 100);
    this.payload = new WebXRRaythreeSceneBridge().buildPayload({
      scene,
      leftCamera: camera,
      rightCamera: camera,
    }, structuredClone(frame));
    // Extracted mesh order is lowerer order; identify tiles by their distinct local x and z.
    const occurrences = new Map<number, number>();
    for (const instance of this.payload.leftEye.frame.instances) {
      const anchor = (instance as typeof instance & Anchored).renderAnchor;
      if (anchor?.space !== "head") continue;
      const x = anchor.localMatrix[12];
      const bit = Math.round(x / .035 + (nativeController ? 19.5 : 7.5));
      const value = occurrences.get(bit) ?? 0;
      occurrences.set(bit, value + 1);
      this.bits.push({ localMatrix: anchor.localMatrix, bit, value, x });
    }
    if (this.bits.length !== (nativeController ? 80 : 32)) {
      throw new Error("Motion probe tile extraction failed");
    }
  }
  sample(
    elapsedMs: number,
    head: THREE.Matrix4,
    generation: number,
  ): { anchors: RenderAnchors; x: number } {
    const x = motionProbeX(elapsedMs);
    const controller = head.clone().multiply(new THREE.Matrix4().makeTranslation(x, -.12, -.8));
    for (const tile of this.bits) {
      // Move inactive tile behind the camera, preserving both materials in the asset baseline.
      const visible = (this.nativeController
        ? motionProbeCell(generation, tile.bit)
        : ((generation >>> tile.bit) & 1)) === tile.value;
      new THREE.Matrix4().makeTranslation(tile.x, .22, visible ? -1 : 1).toArray(tile.localMatrix);
    }
    this.payload.frame.frameCount = generation;
    return { x, anchors: { head: head.elements, "right-ray": controller.elements } };
  }
}

/** Full-scene diagnostic: preserve normal wrist/IR/cameras and append only a frame tag. */
import * as THREE from "three";
import { motionProbeFrame, OverlayMotionProbe } from "./overlayMotionProbe.ts";
import { type Anchored, resolveRenderAnchors } from "./overlayRenderTracking.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";

export class OverlayWristMotionProbe {
  private readonly tag = new OverlayMotionProbe(motionProbeFrame(512), true);
  generation = 0;
  private readonly markerMaterials = new Set<number>();
  readonly rows: Record<string, unknown>[] = [];
  constructor() {
    // Keep the head-fixed ID strip; the marker comes from the actual WristMenuPanel.
    for (const eye of [this.tag.payload.leftEye]) {
      eye.frame.instances = eye.frame.instances.filter((item) =>
        (item as typeof item & Anchored).renderAnchor?.space === "head"
      );
      const geometryIds = new Map(
        eye.assets.geometries.map((asset, i) => [asset.id, 0x70000000 + i]),
      );
      const materialIds = new Map(
        eye.assets.materials.map((asset, i) => [asset.id, 0x71000000 + i]),
      );
      for (const [index, item] of eye.frame.instances.entries()) {
        item.nodeId = 0x72000000 + index;
        item.geometryId = geometryIds.get(item.geometryId)!;
        item.materialId = materialIds.get(item.materialId)!;
      }
      for (const asset of eye.assets.geometries) asset.id = geometryIds.get(asset.id)!;
      for (const asset of eye.assets.materials) asset.id = materialIds.get(asset.id)!;
    }
    this.tag.payload.rightEye = this.tag.payload.leftEye;
  }
  /** Call after ordinary fresh-anchor resolution; restore the inbox payload after drawing. */
  append(payload: WebXRRaythreeRenderPayload, head: THREE.Matrix4): () => void {
    this.tag.sample(0, head, ++this.generation);
    resolveRenderAnchors(this.tag.payload, { head: head.elements });
    const restore: (() => void)[] = [];
    for (
      const [eye, tag] of [[payload.leftEye, this.tag.payload.leftEye], [
        payload.rightEye,
        this.tag.payload.rightEye,
      ]] as const
    ) {
      // Some payloads alias both eyes. Append only once to an aliased extraction.
      if (payload.leftEye === payload.rightEye && eye === payload.rightEye && restore.length) {
        continue;
      }
      const assets = eye.assets, instances = eye.frame.instances;
      const ids = new Set([...assets.geometries, ...assets.materials].map((asset) => asset.id));
      if ([...tag.assets.geometries, ...tag.assets.materials].some((asset) => ids.has(asset.id))) {
        throw new Error("Wrist probe diagnostic asset ID collision");
      }
      eye.assets = {
        geometries: [...assets.geometries, ...tag.assets.geometries],
        materials: [...assets.materials, ...tag.assets.materials],
        textures: assets.textures,
      };
      eye.frame.instances = [...instances, ...tag.frame.instances];
      restore.push(() => {
        eye.assets = assets;
        eye.frame.instances = instances;
      });
    }
    return () => {
      for (const undo of restore) undo();
    };
  }
  marker(
    payload: WebXRRaythreeRenderPayload,
    cameras: {
      leftEyeViewMatrix: Float32Array;
      rightEyeViewMatrix: Float32Array;
      leftEyeProjectionMatrix: Float32Array;
      rightEyeProjectionMatrix: Float32Array;
    },
  ) {
    const eye = payload.leftEye;
    // Inbox asset packets are deltas after adoption. Keep diagnostic material
    // identity across those packets rather than requiring a baseline every frame.
    for (const m of eye.assets.materials) {
      if (m.baseColor[0] > .99 && m.baseColor[1] < .01 && m.baseColor[2] > .99) {
        this.markerMaterials.add(m.id);
      } else this.markerMaterials.delete(m.id);
    }
    const markers = eye.frame.instances.filter((item) =>
      this.markerMaterials.has(item.materialId) &&
      (item as typeof item & Anchored).renderAnchor?.space?.endsWith("-hand")
    );
    if (markers.length !== 1) {
      throw new Error(`Expected one wrist-mounted magenta marker, found ${markers.length}`);
    }
    const marker = markers[0];
    const world = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray(marker.worldMatrix),
    );
    const worldMatrix = new THREE.Matrix4().fromArray(marker.worldMatrix);
    const worldCorners = [[-.05, -.05, 0], [.05, -.05, 0], [.05, .05, 0], [-.05, .05, 0]].map((p) =>
      new THREE.Vector3(...p as [number, number, number]).applyMatrix4(worldMatrix).toArray()
    );
    const project = (view: Float32Array, projection: Float32Array) => {
      const transform = new THREE.Matrix4().fromArray(projection).multiply(
        new THREE.Matrix4().fromArray(view),
      );
      const points = worldCorners.map((p) => {
        const ndc = new THREE.Vector3().fromArray(p).applyMatrix4(transform);
        return { x: (ndc.x + 1) * 480 - .5, y: (1 - ndc.y) * 480 - .5 };
      });
      let area = 0, x = 0, y = 0;
      for (let i = 0; i < points.length; i++) {
        const p = points[i], q = points[(i + 1) % points.length];
        const cross = p.x * q.y - q.x * p.y;
        area += cross;
        x += (p.x + q.x) * cross;
        y += (p.y + q.y) * cross;
      }
      if (Math.abs(area) < 1e-8) throw new Error("Wrist marker projects to a degenerate polygon");
      return { x: x / (3 * area), y: y / (3 * area), corners: points };
    };
    return {
      space: (marker as typeof marker & Anchored).renderAnchor!.space,
      world: world.toArray(),
      worldCorners,
      left: project(cameras.leftEyeViewMatrix, cameras.leftEyeProjectionMatrix),
      right: project(cameras.rightEyeViewMatrix, cameras.rightEyeProjectionMatrix),
      localMatrix: Array.from((marker as typeof marker & Anchored).renderAnchor!.localMatrix),
    };
  }
}

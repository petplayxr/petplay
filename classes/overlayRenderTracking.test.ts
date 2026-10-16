import * as THREE from "three";
import {
  captureRenderAnchor,
  type RenderAnchors,
  resolveRenderAnchors,
  setRenderHandAnchors,
} from "./overlayRenderTracking.ts";
import { writeStereoRenderViews } from "./overlayRenderCamera.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";
import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
} from "../submodules/stageforge/src/lib/webSocketWorkerCodec.ts";
function assert(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
function near(a: number, b: number) {
  assert(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
}
Deno.test("fresh controller tracking preserves target-ray to grip calibration", () => {
  const anchors: RenderAnchors = {};
  const ray = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(10, 0, 0);
  setRenderHandAnchors(
    anchors,
    "left",
    ray.elements,
    new THREE.Matrix4().makeTranslation(0, 2, 0).elements,
  );
  near(anchors["left-ray"]![12], 10);
  near(anchors["left-hand"]![12], 8);
  near(anchors["left-hand"]![13], 0);
  near(ray.elements[12], 10);
});
Deno.test("render cameras advance with unchanged scene and preserve measured eye separation", () => {
  const left = new THREE.Matrix4().makeTranslation(-.03, 0, 0),
    right = new THREE.Matrix4().makeTranslation(.03, 0, 0);
  const output = {
    leftEyeViewMatrix: new Float32Array(16),
    rightEyeViewMatrix: new Float32Array(16),
  };
  writeStereoRenderViews(new THREE.Matrix4().makeTranslation(4, 2, 1), left, right, output);
  near(output.leftEyeViewMatrix[12], -3.97);
  near(output.rightEyeViewMatrix[12], -4.03);
  writeStereoRenderViews(new THREE.Matrix4().makeTranslation(5, 2, 1), left, right, output);
  near(output.leftEyeViewMatrix[12], -4.97);
  near(output.rightEyeViewMatrix[12], -5.03);
});
Deno.test("tracked-local transforms resolve repeatedly without compounding tracking", () => {
  const root = new THREE.Group();
  root.userData.renderTrackingAnchor = "head";
  root.position.x = 10;
  const mesh = new THREE.Mesh();
  mesh.position.x = 2;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const item = {
    worldMatrix: new Float64Array(mesh.matrixWorld.elements),
    normalMatrix: new Float64Array(9),
    renderAnchor: captureRenderAnchor(mesh, mesh.matrixWorld.elements),
  };
  const eye = { frame: { instances: [item] } };
  const payload = {
    leftEye: eye,
    rightEye: eye,
    ui: { panels: [], texts: [], images: [] },
  } as unknown as WebXRRaythreeRenderPayload;
  assert(
    resolveRenderAnchors(payload, {
      head: new THREE.Matrix4().makeTranslation(20, 0, 0).elements,
    }) === 1,
    "aliased stereo extraction resolved once",
  );
  near(item.worldMatrix[12], 22);
  resolveRenderAnchors(payload, { head: new THREE.Matrix4().makeTranslation(30, 0, 0).elements });
  near(item.worldMatrix[12], 32);
  resolveRenderAnchors(payload, {});
  near(item.worldMatrix[12], 32);
});
Deno.test("world-anchored hit cursors opt out of tracked ancestors", () => {
  const root = new THREE.Group();
  root.userData.renderTrackingAnchor = "left-ray";
  const cursor = new THREE.Mesh();
  cursor.userData.renderTrackingAnchor = "world";
  root.add(cursor);
  root.updateMatrixWorld(true);
  assert(
    captureRenderAnchor(cursor, cursor.matrixWorld.elements) === undefined,
    "world-space hit does not follow a newer ray",
  );
});
Deno.test("late tracked panel transforms move clipping planes with the panel", () => {
  const item = {
    worldMatrix: new Float32Array(new THREE.Matrix4().elements),
    renderAnchor: {
      space: "head" as const,
      localMatrix: new Float64Array(new THREE.Matrix4().elements),
    },
    clipping: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  };
  const eye = { frame: { instances: [] } };
  const payload = {
    leftEye: eye,
    rightEye: eye,
    ui: { panels: [item], texts: [], images: [] },
  } as unknown as WebXRRaythreeRenderPayload;
  resolveRenderAnchors(payload, { head: new THREE.Matrix4().makeTranslation(3, 0, 0).elements });
  near(item.worldMatrix[12], 3);
  near(item.clipping[3], -3);
  resolveRenderAnchors(payload, { head: new THREE.Matrix4().makeTranslation(4, 0, 0).elements });
  near(item.clipping[3], -4);
});

Deno.test("tracked scene and UI transforms survive the actual process wire codec", () => {
  const matrix = new Float64Array(new THREE.Matrix4().elements);
  const anchor = { space: "left-hand", localMatrix: matrix };
  const item = { worldMatrix: matrix, normalMatrix: new Float64Array(9), renderAnchor: anchor };
  const panel = {
    worldMatrix: new Float32Array(matrix),
    renderAnchor: anchor,
    clipping: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  };
  const eye = { frame: { instances: [item] } };
  const payload = decodeWebSocketWorkerMessage(encodeWebSocketWorkerMessage({
    leftEye: eye,
    rightEye: eye,
    ui: { panels: [panel], texts: [], images: [] },
  })) as WebXRRaythreeRenderPayload;
  // JSON also removes shared-object aliasing between the two extracted eyes.
  resolveRenderAnchors(payload, {
    "left-hand": new THREE.Matrix4().makeTranslation(3, 0, 0).elements,
  });
  for (const eye of [payload.leftEye, payload.rightEye]) {
    near(eye.frame.instances[0].worldMatrix[12], 3);
    near(eye.frame.instances[0].normalMatrix[0], 1);
  }
  near(payload.ui.panels[0].worldMatrix[12], 3);
  near(payload.ui.panels[0].clipping[3], -3);
  resolveRenderAnchors(payload, {
    "left-hand": new THREE.Matrix4().makeTranslation(4, 0, 0).elements,
  });
  near(payload.leftEye.frame.instances[0].worldMatrix[12], 4);
  near(payload.ui.panels[0].clipping[3], -4);
});

Deno.test("a held window follows the grabbing controller while the grab is live", () => {
  const window = new THREE.Group();
  window.position.set(0.2, 1.2, -1);
  const panel = new THREE.Mesh();
  panel.position.set(0, 0.1, 0);
  window.add(panel);
  window.updateMatrixWorld(true);
  let live = true;
  window.userData.renderTrackingFollow = {
    space: "right-hand",
    pose: new THREE.Matrix4().makeTranslation(0.25, 1, -0.3),
    active: () => live,
  };

  const anchor = captureRenderAnchor(panel, panel.matrixWorld.elements);
  assert(anchor?.space === "right-hand", "held window is sent relative to the grabbing hand");
  const position = new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().fromArray(anchor.localMatrix),
  );
  near(position.x, -0.05);
  near(position.y, 0.3);
  near(position.z, -0.7);

  live = false;
  assert(
    captureRenderAnchor(panel, panel.matrixWorld.elements) === undefined,
    "an ended grab leaves the window in the world",
  );
});

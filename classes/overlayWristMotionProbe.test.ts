import * as THREE from "three";
import { OverlayWristMotionProbe } from "./overlayWristMotionProbe.ts";
import { motionProbeFrame } from "./overlayMotionProbe.ts";
import { WebXRRaythreeSceneBridge } from "./webxrRaythreeScene.ts";
import { resolveRenderAnchors } from "./overlayRenderTracking.ts";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("full-scene tag preserves inbox content and resolves the real wrist marker", () => {
  const scene = new THREE.Scene();
  const hand = new THREE.Group();
  hand.userData.renderTrackingAnchor = "right-hand";
  scene.add(hand);
  const mount = new THREE.Group();
  mount.position.set(.1, .02, 0);
  mount.rotation.set(.2, .3, .1);
  mount.scale.setScalar(.235);
  hand.add(mount);
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(.1, .1),
    new THREE.MeshBasicMaterial({ color: 0xff00ff }),
  );
  marker.position.set(-.2, .2, .03);
  mount.add(marker);
  const camera = new THREE.PerspectiveCamera(90, 1, .05, 100);
  const payload = new WebXRRaythreeSceneBridge().buildPayload({
    scene,
    leftCamera: camera,
    rightCamera: camera,
  }, motionProbeFrame(512));
  const probe = new OverlayWristMotionProbe();
  const original = payload.leftEye.frame.instances;
  const assets = payload.leftEye.assets;
  const cameras = {
    leftEyeViewMatrix: new Float32Array(new THREE.Matrix4().elements),
    rightEyeViewMatrix: new Float32Array(new THREE.Matrix4().elements),
    leftEyeProjectionMatrix: new Float32Array(camera.projectionMatrix.elements),
    rightEyeProjectionMatrix: new Float32Array(camera.projectionMatrix.elements),
  };
  for (const x of [-.1, .12, -.1]) {
    const transform = new THREE.Matrix4().makeTranslation(x, 0, -.5);
    resolveRenderAnchors(payload, { "right-hand": transform.elements });
    const expected = new THREE.Vector3().setFromMatrixPosition(
      transform.clone().multiply(mount.matrixWorld).multiply(marker.matrix),
    );
    const observed = probe.marker(payload, cameras);
    assert(
      Math.abs(observed.world[0] - expected.x) < 1e-6,
      "marker follows full local mount chain",
    );
    const restore = probe.append(payload, new THREE.Matrix4());
    assert(
      payload.leftEye.frame.instances.length === original.length + 80,
      "tag appended without replacing marker",
    );
    assert(
      new Set(payload.leftEye.assets.materials.map((a) => a.id)).size ===
        payload.leftEye.assets.materials.length,
      "asset IDs remain distinct",
    );
    restore();
    assert(
      payload.leftEye.frame.instances === original && payload.leftEye.assets === assets,
      "inbox arrays restored by identity",
    );
  }
  assert(probe.generation === 3, "one tag generation per render");
});
Deno.test("tilted wrist uses projected polygon centroid, not projected 3D center", () => {
  const scene = new THREE.Scene();
  const hand = new THREE.Group();
  hand.userData.renderTrackingAnchor = "right-hand";
  scene.add(hand);
  const marker = new THREE.Mesh(
    new THREE.PlaneGeometry(.1, .1),
    new THREE.MeshBasicMaterial({ color: 0xff00ff }),
  );
  marker.rotation.y = .9;
  hand.add(marker);
  const camera = new THREE.PerspectiveCamera(90, 1, .05, 100);
  const payload = new WebXRRaythreeSceneBridge().buildPayload({
    scene,
    leftCamera: camera,
    rightCamera: camera,
  }, motionProbeFrame(512));
  resolveRenderAnchors(payload, {
    "right-hand": new THREE.Matrix4().makeTranslation(.1, 0, -.5).elements,
  });
  const probe = new OverlayWristMotionProbe();
  const identity = new Float32Array(new THREE.Matrix4().elements),
    projection = new Float32Array(camera.projectionMatrix.elements);
  const result = probe.marker(payload, {
    leftEyeViewMatrix: identity,
    rightEyeViewMatrix: identity,
    leftEyeProjectionMatrix: projection,
    rightEyeProjectionMatrix: projection,
  });
  const center = new THREE.Vector3(...result.world).applyMatrix4(camera.projectionMatrix);
  assert(
    Math.abs(result.left.x - ((center.x + 1) * 480 - .5)) > .1,
    "perspective area-centroid correction is material for tilted quad",
  );
  assert(
    result.worldCorners.length === 4 && result.left.corners.length === 4,
    "full geometry retained for analysis",
  );
});

import * as THREE from "three";
import {
  motionProbeCell,
  motionProbeFrame,
  motionProbeX,
  OverlayMotionProbe,
} from "./overlayMotionProbe.ts";
import { type Anchored, resolveRenderAnchors } from "./overlayRenderTracking.ts";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("probe motion depends on target time, survives irregular sampling and is periodic", () => {
  for (const t of [0, 1, 15.3, 228, 501, 999, 1231, 1980]) {
    assert(Math.abs(motionProbeX(t) - motionProbeX(t + 2000)) < 1e-12, "periodic trajectory");
  }
  assert(Math.abs(motionProbeX(500) - .25) < 1e-12, "known peak");
});
Deno.test("probe generation tiles and marker survive repeated anchor resolution", () => {
  const probe = new OverlayMotionProbe(motionProbeFrame(256));
  const head = new THREE.Matrix4().makeTranslation(2, 1, 3);
  for (const generation of [0, 1, 30, 0xaaaa, 0xffff, 0]) {
    const sample = probe.sample(500, head, generation);
    resolveRenderAnchors(probe.payload, sample.anchors);
    const marker = probe.payload.leftEye.frame.instances.find((i) =>
      (i as typeof i & Anchored).renderAnchor?.space === "right-ray"
    )!;
    assert(
      Math.abs(marker.worldMatrix[12] - 2.25) < 1e-6,
      "fresh marker x without accumulating deltas",
    );
    const tiles = probe.payload.leftEye.frame.instances.filter((i) =>
      (i as typeof i & Anchored).renderAnchor?.space === "head" &&
      i.worldMatrix[14] < head.elements[14]
    );
    assert(tiles.length === 16, "one visible tile per bit");
    for (let bit = 0; bit < 16; bit++) {
      const tile = tiles.find((i) =>
        Math.round(((i as typeof i & Anchored).renderAnchor!.localMatrix[12]) / .035 + 7.5) === bit
      )!;
      const material = probe.payload.leftEye.assets.materials.find((m) =>
        m.id === tile.materialId
      )!;
      const actual = material.baseColor[2] > material.baseColor[0] ? 1 : 0;
      assert(actual === ((generation >>> bit) & 1), `tile ${bit} encodes generation ${generation}`);
    }
  }
});
Deno.test("native-controller probe has one marker and follows the supplied raw pose", () => {
  const probe = new OverlayMotionProbe(motionProbeFrame(512), true);
  assert(probe.nativeController, "native mode retained");
  assert(probe.payload.leftEye.frame.instances.length === 81, "marker and paired ID cells");
  const controller = new THREE.Matrix4().makeTranslation(-.31, 1.2, -.5);
  for (const x of [-.31, -.2, -.31]) {
    controller.elements[12] = x;
    resolveRenderAnchors(probe.payload, { "right-ray": controller.elements });
    const marker = probe.payload.leftEye.frame.instances.find((i) =>
      (i as typeof i & Anchored).renderAnchor?.space === "right-ray"
    )!;
    assert(Math.abs(marker.worldMatrix[12] - x) < 1e-6, "raw controller origin preserved");
    assert(Math.abs(marker.worldMatrix[13] - 1.2) < 1e-6, "height preserved");
    assert(Math.abs(marker.worldMatrix[14] + .5) < 1e-6, "depth preserved");
  }
  const marker = probe.payload.leftEye.frame.instances.find((i) =>
    (i as typeof i & Anchored).renderAnchor?.space === "right-ray"
  )!;
  const material = probe.payload.leftEye.assets.materials.find((m) => m.id === marker.materialId)!;
  assert(material.baseColor[0] > .9 && material.baseColor[1] < .01, "red capture marker");
});

Deno.test("image ID encodes all generation bits with complementary redundancy", () => {
  for (const generation of [0, 1, 2, 255, 256, 0xaaaa, 0xffff]) {
    let decoded = 0;
    for (let bit = 0; bit < 16; bit++) {
      const value = motionProbeCell(generation, bit + 4);
      assert(value !== motionProbeCell(generation, bit + 20), "complementary word");
      decoded |= value << bit;
    }
    assert(decoded === generation, "round-trip ID");
  }
});

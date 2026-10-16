/** Untimed GPU geometry control. No SteamVR required; does NOT measure display cadence.
 * deno run -A --no-check utils/overlay-motion-probe.ts [output-directory]
 */
import * as THREE from "three";
import { motionProbeFrame, OverlayMotionProbe } from "../classes/overlayMotionProbe.ts";
import { resolveRenderAnchors } from "../classes/overlayRenderTracking.ts";
import { writeStereoRenderViews } from "../classes/overlayRenderCamera.ts";
import { WebXROverlayRaylib } from "../classes/webxrOverlayRaylib.ts";
import { PNG } from "pngjs";

const directory = Deno.args[0] ?? "/tmp/petplay-motion-probe";
await Deno.mkdir(directory, { recursive: true });
const size = 512;
const frame = motionProbeFrame(size);
const probe = new OverlayMotionProbe(frame);
const renderer = new WebXROverlayRaylib(size);
const head = new THREE.Matrix4();
const cameras = {
  leftEyeViewMatrix: frame.leftEyeViewMatrix,
  rightEyeViewMatrix: frame.rightEyeViewMatrix,
  leftEyeProjectionMatrix: frame.leftEyeProjectionMatrix,
  rightEyeProjectionMatrix: frame.rightEyeProjectionMatrix,
};
writeStereoRenderViews(
  head,
  new THREE.Matrix4().makeTranslation(-.032, 0, 0),
  new THREE.Matrix4().makeTranslation(.032, 0, 0),
  cameras,
);
const lookRotation = new Float32Array(new THREE.Matrix4().makeScale(1, 1, -1).elements);
const rows: Record<string, unknown>[] = [];
let previousEyes = 0, previousOutput = 0;
try {
  renderer.initialize("Deterministic overlay geometry control");
  for (let generation = 0; generation < 120; generation++) {
    // Fixed virtual sample times test rasterization independently of actual GPU/CPU speed.
    const targetMs = generation * 2000 / 120;
    const sample = probe.sample(targetMs, head, generation);
    resolveRenderAnchors(probe.payload, sample.anchors);
    renderer.useEyeTargetsOtherThan([previousEyes]);
    renderer.useOutputTargetOtherThan([previousOutput]);
    renderer.renderRaythreeFrame(probe.payload, { cameras, lookRotation });
    previousEyes = renderer.getEyeTextureHandles()!.left;
    previousOutput = renderer.getTextureHandle();
    for (const target of ["left", "right", "output"] as const) {
      const image = renderer.readRenderTargetRgba(target);
      const regions = target === "output"
        ? [{ label: "panorama-left", lo: image.height / 2, hi: image.height, offset: .032 }, {
          label: "panorama-right",
          lo: 0,
          hi: image.height / 2,
          offset: -.032,
        }]
        : [{ label: target, lo: 0, hi: image.height, offset: target === "left" ? .032 : -.032 }];
      for (const region of regions) {
        const panorama = target === "output";
        let n = 0, sx = 0, sy = 0;
        for (let y = region.lo; y < region.hi; y++) {
          for (let x = 0; x < image.width; x++) {
            // The combine also has a rear/seam copy. Measure only the forward hemisphere.
            if (panorama && (x < image.width / 4 || x >= image.width * 3 / 4)) continue;
            const i = (y * image.width + x) * 4;
            if (
              image.data[i + 1] > 180 && image.data[i] < 40 && image.data[i + 2] < 40 &&
              image.data[i + 3] > 180
            ) {
              n++;
              sx += x;
              sy += y;
            }
          }
        }
        const expectedCentroidX = panorama
          ? image.width / 2 - .5 +
            Math.atan((sample.x + region.offset) / .8) * image.width / (2 * Math.PI)
          : image.width / 2 - .5 + (sample.x + region.offset) / .8 * image.width / 2;
        let decodedGeneration = 0, missingBits = 0;
        for (let bit = 0; bit < 16; bit++) {
          const x = (bit - 7.5) * .035 + region.offset;
          const px = panorama
            ? image.width / 2 - .5 + Math.atan(x) * image.width / (2 * Math.PI)
            : image.width / 2 - .5 + x * image.width / 2;
          const py = panorama
            ? (region.lo + region.hi) / 2 - .5 +
              Math.atan(.22 / Math.sqrt(1 + x * x)) * image.width / (2 * Math.PI)
            : image.height / 2 - .5 + .22 * image.height / 2;
          const i = (Math.round(py) * image.width + Math.round(px)) * 4;
          if (image.data[i] < 100 && image.data[i + 2] < 100) missingBits++;
          if (image.data[i + 2] > image.data[i]) decodedGeneration |= 1 << bit;
        }
        rows.push({
          generation,
          targetMs,
          expectedX: sample.x,
          target: region.label,
          expectedCentroidX,
          greenPixels: n,
          centroidX: n ? sx / n : null,
          centroidY: n ? sy / n : null,
          decodedGeneration,
          missingBits,
        });
      }
      if ([0, 30, 60, 90].includes(generation)) {
        const png = new PNG({ width: image.width, height: image.height });
        for (let y = 0; y < image.height; y++) {
          png.data.set(
            image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
            (image.height - 1 - y) * image.width * 4,
          );
        }
        await Deno.writeFile(`${directory}/${target}-${generation}.png`, PNG.sync.write(png));
      }
    }
  }
  await Deno.writeTextFile(
    `${directory}/producer.json`,
    JSON.stringify(
      {
        scope: "Untimed producer GL readback; no compositor or display cadence measurement",
        eyeSize: size,
        rows,
      },
      null,
      2,
    ),
  );
  if (
    rows.some((row) =>
      !row.greenPixels || row.missingBits || row.decodedGeneration !== row.generation
    )
  ) {
    throw new Error("Marker or generation mismatch in a readback; inspect producer.json");
  }
  console.log(`Saved ${rows.length} producer samples and 12 images to ${directory}`);
} finally {
  renderer.cleanup();
}

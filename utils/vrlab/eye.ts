/**
 * What the synthetic headset is shown: the driver-direct layers of one presented frame, read
 * back by the driver (`CAPTUREDIRECTFRAME`, `submodules/petplay_ovrdriver/src/direct_reader.zig`)
 * and merged here. Needs the lab on `--driver-direct` (`vrlab up` does this by default).
 *
 * Unlike the VRChat desktop window, this keeps showing the eye view while VRChat's camera is in
 * Stream mode (the window then shows the camera), and it includes overlays such as PetPlay's.
 *
 * The merge follows ALVR/ALXR's Windows direct-mode FrameRender: clear to black, draw layers in
 * submission order, each sampled through its SubmitLayer bounds; the first layer is opaque (its
 * alpha is ignored, since apps may submit zero alpha) and later ones blend with straight alpha.
 */
import { join } from "@std/path";
import { PNG } from "pngjs";
import { SyntheticDriver } from "./driver.ts";
import { waitFor } from "./util.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const RAW_DIR = join(ROOT, "logs", "vrlab", "eye-raw");

type CapturedEye = {
  file: string;
  width: number;
  height: number;
  format: number;
  bounds: [number, number, number, number];
};
type Capture = { present: number; layers: [CapturedEye, CapturedEye][] };

/** VkFormat values the driver accepts; B8G8R8A8 formats need their channels swapped. */
const BGRA_FORMATS = new Set([44, 50]);

type Pixels = { width: number; height: number; data: Uint8Array; bgra: boolean };

function readLayer(eye: CapturedEye): Pixels {
  const data = Deno.readFileSync(join(RAW_DIR, eye.file));
  if (data.length !== eye.width * eye.height * 4) throw new Error(`short image ${eye.file}`);
  return { width: eye.width, height: eye.height, data, bgra: BGRA_FORMATS.has(eye.format) };
}

function compose(eyes: { pixels: Pixels; bounds: CapturedEye["bounds"] }[]): PNG {
  const width = Math.max(...eyes.map((e) => e.pixels.width));
  const height = Math.max(...eyes.map((e) => e.pixels.height));
  const out = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) out.data[i * 4 + 3] = 255;
  eyes.forEach(({ pixels, bounds: [uMin, vMin, uMax, vMax] }, layer) => {
    const [r, b] = pixels.bgra ? [2, 0] : [0, 2];
    for (let y = 0; y < height; y++) {
      const sy = Math.min(
        pixels.height - 1,
        Math.floor((vMin + (y + 0.5) / height * (vMax - vMin)) * pixels.height),
      );
      for (let x = 0; x < width; x++) {
        const sx = Math.min(
          pixels.width - 1,
          Math.floor((uMin + (x + 0.5) / width * (uMax - uMin)) * pixels.width),
        );
        const s = (sy * pixels.width + sx) * 4;
        const d = (y * width + x) * 4;
        const alpha = layer === 0 ? 1 : pixels.data[s + 3] / 255;
        out.data[d] = pixels.data[s + r] * alpha + out.data[d] * (1 - alpha);
        out.data[d + 1] = pixels.data[s + 1] * alpha + out.data[d + 1] * (1 - alpha);
        out.data[d + 2] = pixels.data[s + b] * alpha + out.data[d + 2] * (1 - alpha);
      }
    }
  });
  return out;
}

function sideBySide(left: PNG, right: PNG): PNG {
  const out = new PNG({
    width: left.width + right.width,
    height: Math.max(left.height, right.height),
  });
  PNG.bitblt(left, out, 0, 0, left.width, left.height, 0, 0);
  PNG.bitblt(right, out, 0, 0, right.width, right.height, left.width, 0);
  return out;
}

/**
 * Captures the next presented frame. Writes `<path>` (both eyes side by side) and, with
 * `layers`, each layer per eye as `<path>-L<layer>-<eye>.png`. Returns the paths and layer sizes.
 */
export async function captureEyes(
  outPath: string,
  /** `driver`: reuse an open connection; the driver socket serves one client at a time. */
  options: { layers?: boolean; driver?: SyntheticDriver } = {},
): Promise<
  {
    path: string;
    layers: { width: number; height: number; format: number; bounds: number[] }[][];
    files: string[];
  }
> {
  Deno.mkdirSync(RAW_DIR, { recursive: true, mode: 0o700 });
  const driver = options.driver ?? await SyntheticDriver.attach();
  let capture: Capture;
  try {
    capture = await driver.send<Capture>("CAPTUREDIRECTFRAME", { directory: RAW_DIR });
  } finally {
    if (!options.driver) driver.close();
  }
  const raw = new Set(capture.layers.flat().map((eye) => eye.file));
  try {
    if (!capture.layers.length) {
      throw new Error("the frame had no layers (is anything presenting?)");
    }
    const base = outPath.replace(/\.png$/, "");
    const files: string[] = [];
    const perEye = [0, 1].map((e) =>
      capture.layers.map((layer, l) => {
        const pixels = readLayer(layer[e]);
        if (options.layers) {
          const png = compose([{ pixels, bounds: layer[e].bounds }]);
          const path = `${base}-L${l}-${e ? "right" : "left"}.png`;
          Deno.writeFileSync(path, PNG.sync.write(png));
          files.push(path);
        }
        return { pixels, bounds: layer[e].bounds };
      })
    );
    const path = base + ".png";
    Deno.writeFileSync(path, PNG.sync.write(sideBySide(compose(perEye[0]), compose(perEye[1]))));
    return {
      path,
      files,
      layers: capture.layers.map((layer) =>
        layer.map(({ width, height, format, bounds }) => ({ width, height, format, bounds }))
      ),
    };
  } finally {
    for (const file of raw) {
      try {
        Deno.removeSync(join(RAW_DIR, file));
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * Waits until frames carry a scene layer besides the compositor's: VRChat reports a world well
 * before it presents, and until then the headset shows SteamVR's "Connecting…" scene.
 */
export async function waitForScenePresent(
  driver: SyntheticDriver,
  timeoutMs = 180_000,
): Promise<void> {
  await waitFor(
    "the scene app to present frames",
    async () => {
      const state = await driver.send<{ lastLayerCount: number }>("GETDIRECTSTATE");
      return state.lastLayerCount >= 2;
    },
    timeoutMs,
    500,
  );
}

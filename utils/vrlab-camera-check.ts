/**
 * End-to-end check of the VRC camera layer in the synthetic lab: VRChat's camera held by a
 * scripted hand, PetPlay's calibration, the transparent PetPlay layer, and the OBS composite.
 *
 * ```sh
 * deno task vrlab obs launch                          # once
 * deno task vrlab:camera-check [--reuse-vrchat] [--keep-marker]   # brings the stack up as needed
 * ```
 *
 * VRChat is restarted first (`--reuse-vrchat` skips it): the menu path is stateful (a submenu left
 * open turns the next long press into a close) and a stray stick tilt walks the avatar, so a fresh
 * session is the reliable starting point.
 *
 * Steps: open the camera from VRChat's Action Menu, grab it with the right hand, sweep it while
 * PetPlay calibrates, aim it over the user's shoulder, bring the left hand into frame with a
 * PetPlay marker on it, then capture through OBS. It asserts:
 *
 * - calibration error (rms) under 1 cm;
 * - the aimed camera lands within 1 cm of the requested pose (VRChat's report, mapped back);
 * - the PetPlay layer is transparent apart from content, and the marker's blob sits within 2% of
 *   the frame of where the calibrated camera projects PetPlay's left-controller pose.
 *
 * The VRChat side of the alignment (marker on the avatar's hand) is left to the saved composite:
 * `logs/vrlab/check-<time>/composite.png`, with a crosshair at the projected hand.
 */
import * as THREE from "three";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";
import { join } from "@std/path";
import {
  aimCamera,
  calibrationStatus,
  cameraTrackingPose,
  grabCamera,
  openCamera,
  sweepForCalibration,
} from "./vrlab/camera.ts";
import { euler, SyntheticDriver, type Vec3 } from "./vrlab/driver.ts";
import { captureEyes, waitForScenePresent } from "./vrlab/eye.ts";
import { setDashboard } from "./vrlab/steamvr.ts";
import { Obs } from "./vrlab/obs.ts";
import {
  controllerPosition,
  hideHandMarker,
  message,
  showHandMarker,
  showWindowLayer,
} from "./vrlab/petplay.ts";
import { freshVrchat, status, up } from "./vrlab/stack.ts";
import { sendOsc } from "./vrlab/vrchat.ts";
import { findX11Window } from "./vrlab/x11.ts";
import { desktopEnv, sleep, waitFor } from "./vrlab/util.ts";

const RUN_DIR = join(
  Deno.cwd(),
  "logs",
  "vrlab",
  `check-${new Date().toISOString().replaceAll(":", "-")}`,
);
const CAMERA_POSITION: Vec3 = [0.35, 1.75, 0.6];
const CAMERA_TARGET: Vec3 = [-0.1, 1.2, -1.0];
const LEFT_HAND_IN_FRAME: Vec3 = [0.05, 1.35, -0.55];
const FOV_DEG = 45;

type Check = { name: string; ok: boolean; detail: unknown };
const checks: Check[] = [];
function check(name: string, ok: boolean, detail: unknown): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
}
const step = (text: string) => console.log(`--    ${text}`);

/** Pixel of a tracking-space point in a `width`×`height` image from the calibrated camera. */
async function project(point: Vec3, width: number, height: number): Promise<[number, number]> {
  const pose = await cameraTrackingPose();
  const camera = new THREE.PerspectiveCamera(
    (await calibrationStatus()).fovYDeg ?? FOV_DEG,
    width / height,
    0.03,
    500,
  );
  camera.position.fromArray(pose.position);
  camera.quaternion.fromArray(pose.quaternion);
  camera.updateMatrixWorld(true);
  const ndc = new THREE.Vector3(...point).project(camera);
  return [(ndc.x + 1) / 2 * width, (1 - ndc.y) / 2 * height];
}

/** Centroid of opaque, strongly magenta pixels: the marker. */
function markerCentroid(png: PNG): { x: number; y: number; pixels: number } | null {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const [r, g, b, a] = png.data.subarray(i, i + 4);
      if (a > 200 && r > 200 && b > 200 && g < 80) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return n > 20 ? { x: sx / n, y: sy / n, pixels: n } : null;
}

function drawCrosshair(png: PNG, [cx, cy]: [number, number]): void {
  for (let d = -24; d <= 24; d++) {
    for (
      const [x, y] of [[Math.round(cx) + d, Math.round(cy)], [Math.round(cx), Math.round(cy) + d]]
    ) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (y * png.width + x) * 4;
      png.data.set([0, 255, 0, 255], i);
    }
  }
}

async function main(): Promise<boolean> {
  for (const [key, value] of Object.entries(desktopEnv())) {
    if (!Deno.env.get(key)) Deno.env.set(key, value);
  }
  Deno.mkdirSync(RUN_DIR, { recursive: true });
  // Starts only what is missing (lab, keepalive, PetPlay, VRChat); a no-op on a running stack.
  await up({ log: step });
  const stack = await status();
  const reuse = Deno.args.includes("--reuse-vrchat");
  if (stack.petplay !== "attached" || (reuse && stack.vrchat !== "in world")) {
    throw new Error(`stack not ready (${JSON.stringify(stack)})`);
  }
  if (!reuse) {
    step("restarting VRChat for a clean menu and camera state");
    await freshVrchat({ log: (line) => step(line) });
  }
  const driver = await SyntheticDriver.attach();
  try {
    step("waiting for VRChat to present frames");
    await waitForScenePresent(driver);
    for (const hand of ["left", "right"] as const) await driver.setInput(hand);
    await driver.setPose("right", { position: [0.3, 1.2, -0.3], rotation: euler(0, 0, 0) });
    step("opening the VRChat camera from the Action Menu");
    // Headset captures of each step (VRChat plus overlays), for when something changes.
    const snap = async (name: string) =>
      void await captureEyes(join(RUN_DIR, `${name}.png`), { driver });
    // The SteamVR dashboard sometimes opens by itself and takes the controllers away from VRChat.
    const noDashboard = async (before: string) => {
      if (await setDashboard(driver, false)) {
        step(`closed an unexpected SteamVR dashboard before ${before}`);
      }
    };
    await noDashboard("the Action Menu");
    await openCamera(driver, undefined, snap);
    await sendOsc("/usercamera/Zoom", { f: FOV_DEG });

    await noDashboard("the grab");
    step("grabbing it with the right hand");
    const held = await grabCamera(driver);
    await driver.setPose("left", { position: [-0.3, 1.2, -0.3], rotation: euler(0, 0, 0) });
    await snap("grabbed");

    await noDashboard("the calibration sweep");
    step("sweeping it while PetPlay calibrates");
    const calibration = await sweepForCalibration(driver, held.position);
    const fit = calibration.calibration;
    check(
      "calibration rms < 1 cm",
      fit != null && fit.rmsErrorMeters < 0.01,
      fit && {
            rmsCm: +(fit.rmsErrorMeters * 100).toFixed(2),
            samples: fit.samples,
            scale: +fit.scale.toFixed(3),
            hand: fit.hand,
          } || calibration.lastError,
    );
    await snap("calibrated");
    if (!fit) return false;

    step("starting the PetPlay layer and aiming the camera over the shoulder");
    await message("main", "STARTVRCCAMERAVIEW", { width: 1920, height: 1080, fovYDeg: FOV_DEG });
    await snap("layer-started");
    await showWindowLayer();
    await snap("window-layer");
    await noDashboard("aiming");
    const aim = await aimCamera(driver, CAMERA_POSITION, CAMERA_TARGET);
    await snap("aimed");
    check("aimed camera within 1 cm", aim.errorMeters < 0.01, {
      errorMm: +(aim.errorMeters * 1000).toFixed(1),
    });

    step("left hand into frame with a PetPlay marker");
    await driver.setPose("left", { position: LEFT_HAND_IN_FRAME, rotation: euler(0, 0, 0) });
    await showHandMarker("left");
    await sleep(1_500);

    step("capturing through OBS");
    const obs = await Obs.connect();
    try {
      const scene = (await obs.request<{ currentProgramSceneName: string }>("GetSceneList"))
        .currentProgramSceneName;
      const layerWindow = await waitFor(
        "the PetPlay VRC Camera window",
        () => findX11Window("PetPlay VRC Camera"),
        15_000,
      );
      const vrchatWindow = findX11Window("VRChat");
      if (!vrchatWindow) throw new Error("no VRChat window");
      await obs.captureWindow(scene, "VRChat", vrchatWindow);
      await obs.captureWindow(scene, "PetPlay Layer", layerWindow);
      await sleep(1_000);
      await obs.screenshot("PetPlay Layer", join(RUN_DIR, "layer.png"));
      await obs.screenshot(scene, join(RUN_DIR, "composite-raw.png"));
    } finally {
      obs.close();
    }

    const layer = PNG.sync.read(Buffer.from(Deno.readFileSync(join(RUN_DIR, "layer.png"))));
    let transparent = 0;
    for (let i = 3; i < layer.data.length; i += 4) if (layer.data[i] === 0) transparent++;
    const transparentShare = transparent / (layer.width * layer.height);
    check("layer is mostly transparent", transparentShare > 0.5 && transparentShare < 1, {
      transparentShare: +transparentShare.toFixed(3),
    });

    const hand = await controllerPosition("left");
    const expected = await project(hand!, layer.width, layer.height);
    const marker = markerCentroid(layer);
    const offset = marker
      ? Math.hypot(marker.x - expected[0], marker.y - expected[1]) / layer.width
      : null;
    check(
      "marker drawn where the calibrated camera projects the hand",
      offset != null && offset < 0.02,
      {
        expectedPx: expected.map(Math.round),
        markerPx: marker && [Math.round(marker.x), Math.round(marker.y)],
        offsetShare: offset && +offset.toFixed(4),
      },
    );

    const composite = PNG.sync.read(
      Buffer.from(Deno.readFileSync(join(RUN_DIR, "composite-raw.png"))),
    );
    drawCrosshair(composite, [
      expected[0] * composite.width / layer.width,
      expected[1] * composite.height / layer.height,
    ]);
    Deno.writeFileSync(join(RUN_DIR, "composite.png"), PNG.sync.write(composite));
  } finally {
    if (!Deno.args.includes("--keep-marker")) await hideHandMarker("left").catch(() => {});
    driver.close();
  }
  return checks.every((c) => c.ok);
}

let ok = false;
try {
  ok = await main();
} catch (error) {
  check("run completed", false, error instanceof Error ? error.message : String(error));
}
Deno.writeTextFileSync(join(RUN_DIR, "result.json"), JSON.stringify({ ok, checks }, null, 2));
console.log(
  `${
    ok ? "PASS" : "FAIL"
  }  ${RUN_DIR}  (check composite.png: the magenta marker should sit on the avatar's left hand)`,
);
Deno.exit(ok ? 0 : 1);

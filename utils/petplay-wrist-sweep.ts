/** Full-scene wrist capture; requires a running synthetic lab and normal PetPlay --wrist-motion-probe. */
import { PostalService } from "../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../classes/petplayOpenVrDriverProxy.ts";
const directory = Deno.args[0];
const condition = Deno.args[1] ?? "desktop-visible";
const mode = Deno.args[2] ?? "panorama";
if (!["panorama", "projection"].includes(mode)) throw new Error("Unknown presentation mode");
const label = `ws-${mode.slice(0, 4)}-${condition === "desktop-visible" ? "on" : "off"}-${
  Deno.args[3] ?? "test"
}`;
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(label)) throw new Error("Invalid capture label");
if (!directory || !["desktop-visible", "desktop-hidden"].includes(condition)) {
  throw new Error("Usage: directory desktop-visible|desktop-hidden");
}
const settings = JSON.parse(
  await Deno.readTextFile(`${Deno.env.get("HOME")}/.local/share/Steam/config/steamvr.vrsettings`),
);
if (settings.steamvr?.forcedDriver !== "petplay" || !settings.driver_petplay?.syntheticHmd) {
  throw new Error("Synthetic-only lab required");
}
const postal = new PostalService();
const driver = await attachOpenVrDriverProxy(
  postal,
  `${settings.driver_petplay.socketDirectory}/control.sock`,
);
const native = (type: string, payload: unknown = null) =>
  postal.PostMessage({ target: driver, type, payload }, true);
async function message(target: string, type: string, payload: unknown = null) {
  const response = await fetch("http://127.0.0.1:3987/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target, type, payload, reply: true, timeoutMs: 5000 }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(JSON.stringify(result));
  return result.result;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const original = await native("GETCONTROLLERSTATE") as { config: unknown };
let renderer: string | undefined;
let originalMode: string | undefined;
let originalVisible: boolean | undefined;
try {
  const webxr = await message("webxr", "__HEALTH__");
  renderer = webxr.independentRenderer.actor;
  if (!renderer) throw new Error("Independent renderer required");
  originalMode = webxr.independentRenderer.status?.presentMode;
  await message("webxr", "SETPRESENTMODE", mode);
  const previousDesktop = await message("displayOverlayHost", "__HEALTH__");
  originalVisible = previousDesktop.visible;
  await message("displayOverlayHost", "WRIST_MENU_ACTION", {
    id: "layout",
    active: condition === "desktop-visible",
  });
  const beforeDesktop = await message("displayOverlayHost", "__HEALTH__");
  if (
    condition === "desktop-visible" &&
    (!beforeDesktop.visible || !beforeDesktop.virtualOverlays.length || !beforeDesktop.textureReady)
  ) throw new Error("No visible live desktop overlay");
  const config = { mode: "sweep", frequencyHz: .35, positionAmplitudeM: .12, yawAmplitudeRad: 0 };
  const ack = await native("SETCONTROLLERMOTION", config) as { commandId: number };
  let state: { appliedId: number; epochSeconds: number };
  const deadline = performance.now() + 1000;
  do {
    state = await native("GETCONTROLLERSTATE") as typeof state;
    if (state.appliedId === ack.commandId) break;
    if (performance.now() > deadline) throw new Error("Motion command timeout");
    await pause(5);
  } while (true);
  await message(renderer, "SETWRISTMOTIONPROBE", true);
  await pause(1000);
  const initial = await message(renderer, "__HEALTH__");
  if (initial.error) throw new Error(JSON.stringify(initial));
  await Deno.writeTextFile(`${directory}/stream.tmp`, label, { createNew: true, mode: 0o600 });
  await Deno.rename(`${directory}/stream.tmp`, `${directory}/stream`);
  let completion;
  const limit = performance.now() + 10000;
  while (true) {
    try {
      completion = JSON.parse(await Deno.readTextFile(`${directory}/${label}.complete`));
      break;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    if (performance.now() > limit) throw new Error("Capture timed out");
    const health = await message(renderer, "__HEALTH__");
    if (health.error) throw new Error(JSON.stringify(health));
    await pause(100);
  }
  const report = {
    experiment: "normal-wrist-sweep",
    condition,
    mode,
    captureLabel: label,
    config,
    epochSeconds: state.epochSeconds,
    completion,
    renderer: await message(renderer, "GETWRISTMOTIONPROBE"),
    beforeDesktop,
    afterDesktop: await message("displayOverlayHost", "__HEALTH__"),
    webxrBefore: webxr,
    webxrAfter: await message("webxr", "__HEALTH__"),
    driver: await native("GETDIRECTSTATE"),
  };
  console.log(JSON.stringify(report));
} finally {
  if (renderer) await message(renderer, "SETWRISTMOTIONPROBE", false);
  if (originalMode) await message("webxr", "SETPRESENTMODE", originalMode);
  if (originalVisible !== undefined) {
    await message("displayOverlayHost", "WRIST_MENU_ACTION", {
      id: "layout",
      active: originalVisible,
    });
  }
  await native("SETCONTROLLERMOTION", original.config);
  postal.detachProxy(driver);
}

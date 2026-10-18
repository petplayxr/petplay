/**
 * The lab SteamVR's own UI, read through a background OpenVR client in this process.
 *
 * The SteamVR dashboard sometimes opens on its own mid-run (cause unknown, 2026-10-18). While it
 * is open it takes controller input: VRChat stops following the hands, and a held camera stays
 * where it was. `setDashboard` toggles it with the left controller's system button (the Touch
 * menu button; the right one does nothing) and checks the result through
 * `IVROverlay::IsDashboardVisible`, which flips 0.1–0.3 s after the release.
 */
import * as VR from "../../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { stringToPointer } from "../../submodules/OpenVR_TS_Bindings_Deno/utils.ts";
import { getOpenVrLibraryPath } from "../../classes/nativeLibraryPaths.ts";
import type { SyntheticDriver } from "./driver.ts";
import { sleep, waitFor } from "./util.ts";

let overlay: VR.IVROverlay | null = null;

/** Connects once per process, as a background app: it never becomes the scene or an overlay. */
function openVrOverlay(): VR.IVROverlay {
  if (overlay) return overlay;
  const settings = JSON.parse(
    Deno.readTextFileSync(`${Deno.env.get("HOME")}/.local/share/Steam/config/steamvr.vrsettings`),
  );
  if (
    settings.steamvr?.forcedDriver !== "petplay" || settings.driver_petplay?.syntheticHmd !== true
  ) {
    throw new Error(
      "the synthetic lab configuration is not active (refusing to touch a real SteamVR)",
    );
  }
  if (!VR.initializeOpenVR(getOpenVrLibraryPath())) throw new Error("OpenVR library unavailable");
  const err = new Int32Array(1);
  const errPtr = Deno.UnsafePointer.of(err) as VR.InitErrorPTRType;
  VR.VR_InitInternal(errPtr, VR.ApplicationType.VRApplication_Background);
  if (err[0]) throw new Error(`OpenVR init failed: ${err[0]} (is the lab SteamVR running?)`);
  const pointer = VR.VR_GetGenericInterface(stringToPointer(VR.IVROverlay_Version), errPtr);
  if (!pointer || err[0]) throw new Error(`no ${VR.IVROverlay_Version}: ${err[0]}`);
  overlay = new VR.IVROverlay(pointer);
  return overlay;
}

export function dashboardVisible(): boolean {
  return openVrOverlay().IsDashboardVisible();
}

/**
 * Opens or closes the dashboard, verified. Returns whether it had to change anything, so callers
 * can log an unexpected dashboard. Retries the toggle once if SteamVR did not react.
 */
export async function setDashboard(driver: SyntheticDriver, visible: boolean): Promise<boolean> {
  if (dashboardVisible() === visible) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    await driver.press("left", { system: true }, 150);
    try {
      await waitFor(
        `the dashboard to ${visible ? "open" : "close"}`,
        () => dashboardVisible() === visible,
        3_000,
        100,
      );
      await sleep(300);
      return true;
    } catch {
      // Try the toggle once more.
    }
  }
  throw new Error(`the SteamVR dashboard did not ${visible ? "open" : "close"}`);
}

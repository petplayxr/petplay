/** Layer-metadata experiment, called only after the lab probe verifies the synthetic HMD. */
import * as VR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { PostalService } from "../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../classes/petplayOpenVrDriverProxy.ts";
export async function probeDirectMarkers(
  overlay: VR.IVROverlay,
  socketDirectory: string,
  captureDirectory?: string,
) {
  const postal = new PostalService();
  const id = await attachOpenVrDriverProxy(postal, `${socketDirectory}/control.sock`);
  const handles: bigint[] = [];
  const state = () =>
    postal.PostMessage({ target: id, type: "GETDIRECTSTATE", payload: null }, true);
  function ok(error: number, operation: string) {
    if (error) throw new Error(`${operation}: OpenVR overlay error ${error}`);
  }
  try {
    for (const mode of ["quad", "panorama", "projection"] as const) {
      const out = new BigUint64Array(1);
      ok(
        overlay.CreateOverlay(
          `petplay.lab.direct.${Deno.pid}.${mode}`,
          `PetPlay lab ${mode}`,
          Deno.UnsafePointer.of(out),
        ),
        "CreateOverlay",
      );
      const handle = out[0];
      handles.push(handle);
      const pixels = new Uint8Array(32 * 16 * 4);
      const channel = mode === "quad" ? 0 : mode === "panorama" ? 1 : 2;
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i + channel] = 255;
        pixels[i + 3] = 255;
      }
      ok(overlay.SetOverlayRaw(handle, Deno.UnsafePointer.of(pixels), 32, 16, 4), "SetOverlayRaw");
      ok(
        overlay.SetOverlayWidthInMeters(handle, mode === "panorama" ? 3 : .6),
        "SetOverlayWidthInMeters",
      );
      const matrix = new Float32Array([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        mode === "projection" ? -1.6 : 0,
        0,
        0,
        1,
        mode === "quad" || mode === "panorama" ? -1 : 0,
      ]);
      if (mode === "projection") {
        const projection = new Float32Array([-1, 1, -1, 1]);
        ok(
          overlay.SetOverlayTransformProjection(
            handle,
            VR.TrackingUniverseOrigin.TrackingUniverseStanding,
            Deno.UnsafePointer.of(matrix) as Deno.PointerValue<VR.HmdMatrix34>,
            Deno.UnsafePointer.of(projection) as Deno.PointerValue<VR.OverlayProjection>,
            VR.Eye.Eye_Left,
          ),
          "SetOverlayTransformProjection",
        );
      } else {
        ok(
          overlay.SetOverlayTransformTrackedDeviceRelative(
            handle,
            0,
            Deno.UnsafePointer.of(matrix) as Deno.PointerValue<VR.HmdMatrix34>,
          ),
          "SetOverlayTransformTrackedDeviceRelative",
        );
      }
      if (mode === "panorama") {
        ok(
          overlay.SetOverlayFlag(handle, VR.OverlayFlags.VROverlayFlags_StereoPanorama, true),
          "SetOverlayFlag(StereoPanorama)",
        );
      }
    }
    for (
      const [name, visible] of [["baseline", []], ["quad", [0]], ["panorama", [1]], ["projection", [
        2,
      ]], ["all", [0, 1, 2]]] as const
    ) {
      const before = await state();
      const fenceAck = await postal.PostMessage({
        target: id,
        type: "PROBEDIRECTFENCES",
        payload: null,
      }, true);
      if (!(fenceAck as { accepted: boolean }).accepted) throw new Error("Fence probe unavailable");
      for (let i = 0; i < handles.length; i++) {
        ok(
          (visible as readonly number[]).includes(i)
            ? overlay.ShowOverlay(handles[i])
            : overlay.HideOverlay(handles[i]),
          "Set visibility",
        );
      }
      for (let i = 0; i < 60; i++) {
        ok(overlay.WaitFrameSync(captureDirectory ? 1000 : 100), "WaitFrameSync");
      }
      let capture: unknown;
      if (captureDirectory) {
        const request = `${captureDirectory}/request`;
        await Deno.writeTextFile(`${request}.tmp`, name, { createNew: true, mode: 0o600 });
        await Deno.rename(`${request}.tmp`, request);
        const done = `${captureDirectory}/${name}.complete`;
        const deadline = performance.now() + 6000;
        while (true) {
          try {
            capture = JSON.parse(await Deno.readTextFile(done));
            const result = capture as {
              captured: number;
              skipped: number;
              failures: number;
              disabled: boolean;
            };
            if (result.captured !== 2 || result.skipped || result.failures || result.disabled) {
              throw new Error(`Capture incomplete: ${JSON.stringify(capture)}`);
            }
            break;
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
          if (performance.now() >= deadline) throw new Error(`Capture timed out: ${name}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      console.log(
        JSON.stringify({
          experiment: "direct-overlay-layer-metadata",
          stage: name,
          capture,
          requestedVisible: visible.map((i) => handles[i].toString()),
          runtimeVisible: handles.map((h) => overlay.IsOverlayVisible(h)),
          before,
          after: await state(),
        }),
      );
    }
  } finally {
    for (const handle of handles) {
      overlay.HideOverlay(handle);
      overlay.ClearOverlayTexture(handle);
      overlay.DestroyOverlay(handle);
    }
    postal.detachProxy(id);
  }
}

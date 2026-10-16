/** Native controller-following quad: baseline for image-based motion measurements. */
import * as VR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { PostalService } from "../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../classes/petplayOpenVrDriverProxy.ts";
export async function probeMotionImages(
  system: VR.IVRSystem,
  overlay: VR.IVROverlay,
  socketDirectory: string,
  captureDirectory: string,
  stepped = false,
) {
  const postal = new PostalService();
  const id = await attachOpenVrDriverProxy(postal, `${socketDirectory}/control.sock`);
  const request = (type: string, payload: unknown = null) =>
    postal.PostMessage({ target: id, type, payload }, true);
  const clock = Deno.dlopen(
    "libc.so.6",
    {
      clock_gettime: { parameters: ["i32", "buffer"], result: "i32" },
    } as const,
  );
  const time = new BigInt64Array(2);
  function now() {
    if (clock.symbols.clock_gettime(1, time)) throw new Error("CLOCK_MONOTONIC failed");
    return Number(time[0]) + Number(time[1]) / 1e9;
  }
  const ok = (error: number) => {
    if (error) throw new Error(`OpenVR overlay error ${error}`);
  };
  const out = new BigUint64Array(1);
  let handle = 0n;
  let original: { config: unknown } | undefined;
  const buffer = new ArrayBuffer(
    VR.TrackedDevicePoseStruct.byteSize * VR.k_unMaxTrackedDeviceCount,
  );
  const pointer = Deno.UnsafePointer.of(buffer) as Deno.PointerValue<VR.TrackedDevicePose>;
  try {
    original = await request("GETCONTROLLERSTATE") as { config: unknown };
    const index = system.GetTrackedDeviceIndexForControllerRole(
      VR.TrackedControllerRole.TrackedControllerRole_LeftHand,
    );
    if (index === VR.k_unTrackedDeviceIndexInvalid) throw new Error("No synthetic left controller");
    const config = { mode: "sine", frequencyHz: .7, positionAmplitudeM: .12, yawAmplitudeRad: 0 };
    const ack = await request("SETCONTROLLERMOTION", config) as { commandId: number };
    let state: { appliedId: number; epochSeconds: number };
    const deadline = performance.now() + 1000;
    do {
      state = await request("GETCONTROLLERSTATE") as typeof state;
      if (state.appliedId === ack.commandId) break;
      if (performance.now() > deadline) throw new Error("Motion command not applied");
      await new Promise((r) => setTimeout(r, 5));
    } while (true);
    ok(
      overlay.CreateOverlay(
        `petplay.lab.motion.${Deno.pid}`,
        "Synthetic controller marker",
        Deno.UnsafePointer.of(out),
      ),
    );
    handle = out[0];
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 255;
      pixels[i + 3] = 255;
    }
    ok(overlay.SetOverlayRaw(handle, Deno.UnsafePointer.of(pixels), 16, 16, 4));
    ok(overlay.SetOverlayWidthInMeters(handle, .025));
    ok(overlay.SetOverlaySortOrder(handle, 100));
    const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    ok(
      overlay.SetOverlayTransformTrackedDeviceRelative(
        handle,
        index,
        Deno.UnsafePointer.of(matrix) as Deno.PointerValue<VR.HmdMatrix34>,
      ),
    );
    ok(overlay.ShowOverlay(handle));
    const rows: unknown[] = [];
    for (const stage of ["capture-off", "capture-on"] as const) {
      if (stage === "capture-on") {
        await Deno.writeTextFile(`${captureDirectory}/stream.tmp`, "motion", {
          createNew: true,
          mode: 0o600,
        });
        await Deno.rename(`${captureDirectory}/stream.tmp`, `${captureDirectory}/stream`);
      }
      const intervals: number[] = [];
      let previous = now(), syncErrors = 0;
      const count = stage === "capture-off" ? 225 : 500;
      for (let i = 0; i < count; i++) {
        if (overlay.WaitFrameSync(1000)) syncErrors++;
        const before = now();
        system.GetDeviceToAbsoluteTrackingPose(
          VR.TrackingUniverseOrigin.TrackingUniverseRawAndUncalibrated,
          0,
          pointer,
          VR.k_unMaxTrackedDeviceCount,
        );
        const after = now();
        const pose = VR.TrackedDevicePoseStruct.read(
          new DataView(
            buffer,
            index * VR.TrackedDevicePoseStruct.byteSize,
            VR.TrackedDevicePoseStruct.byteSize,
          ),
        ) as unknown as VR.TrackedDevicePose;
        if (stepped && i % 5 === 0) {
          const matrix = new Float32Array(pose.mDeviceToAbsoluteTracking.m.flat());
          ok(overlay.SetOverlayTransformAbsolute(
            handle,
            VR.TrackingUniverseOrigin.TrackingUniverseRawAndUncalibrated,
            Deno.UnsafePointer.of(matrix) as Deno.PointerValue<VR.HmdMatrix34>,
          ));
        }
        intervals.push((before - previous) * 1000);
        previous = before;
        rows.push({
          stage,
          before,
          after,
          x: pose.mDeviceToAbsoluteTracking.m[0][3],
          valid: pose.bPoseIsValid,
        });
      }
      const sorted = intervals.slice(10).sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          experiment: "motion-image-cadence",
          stage,
          syncErrors,
          intervalMs: {
            p50: sorted[Math.floor(sorted.length * .5)],
            p95: sorted[Math.floor(sorted.length * .95)],
            max: sorted.at(-1),
          },
        }),
      );
    }
    const completion = JSON.parse(await Deno.readTextFile(`${captureDirectory}/motion.complete`));
    console.log(
      JSON.stringify({
        experiment: "motion-images",
        publication: stepped ? "absolute-transform-15hz" : "native-controller-relative",
        config,
        epochSeconds: state.epochSeconds,
        index,
        completion,
        rows,
      }),
    );
    if (completion.writeFailed || completion.copiedImages === 0) throw new Error("Stream failed");
  } finally {
    if (handle) {
      overlay.HideOverlay(handle);
      overlay.ClearOverlayTexture(handle);
      overlay.DestroyOverlay(handle);
    }
    if (original) await request("SETCONTROLLERMOTION", original.config);
    clock.close();
    postal.detachProxy(id);
  }
}

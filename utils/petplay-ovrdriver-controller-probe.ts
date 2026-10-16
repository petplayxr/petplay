/** Controller trajectory measurement used by the guarded synthetic-HMD lab probe. */
import * as VR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { PostalService } from "../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../classes/petplayOpenVrDriverProxy.ts";

type Config = {
  mode: "stationary" | "sine";
  frequencyHz: number;
  positionAmplitudeM: number;
  yawAmplitudeRad: number;
};
type State = {
  enabled: boolean;
  failed: boolean;
  config: Config;
  epochSeconds: number;
  appliedId: number;
  hands: {
    role: string;
    active: boolean;
    index: number;
    updates: number;
    maxGapMs: number;
    sampleSeconds: number;
    submitSeconds: number;
  }[];
};
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.floor(sorted.length * .95)],
    max: sorted.at(-1),
  };
}
export async function probeControllers(
  system: VR.IVRSystem,
  overlay: VR.IVROverlay,
  socketDirectory: string,
) {
  if (!socketDirectory) throw new Error("Lab driver requires an explicit shared socket directory");
  const postal = new PostalService();
  const id = await attachOpenVrDriverProxy(postal, `${socketDirectory}/control.sock`);
  const request = (type: string, payload: unknown = null) =>
    postal.PostMessage({ target: id, type, payload }, true);
  const clock = Deno.dlopen(
    "libc.so.6",
    { clock_gettime: { parameters: ["i32", "buffer"], result: "i32" } } as const,
  );
  const time = new BigInt64Array(2);
  function now() {
    if (clock.symbols.clock_gettime(1, time) !== 0) throw new Error("CLOCK_MONOTONIC failed");
    return Number(time[0]) + Number(time[1]) / 1e9;
  }
  let motionChanged = false;
  async function setMotion(mode: Config["mode"]) {
    const ack = await request("SETCONTROLLERMOTION", {
      mode,
      frequencyHz: .7,
      positionAmplitudeM: .12,
      yawAmplitudeRad: .4,
    }) as { commandId: number };
    motionChanged = true;
    const deadline = performance.now() + 1000;
    while (performance.now() < deadline) {
      const state = await request("GETCONTROLLERSTATE") as State;
      if (state.appliedId === ack.commandId) return state;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("Controller motion was queued but not applied within one second");
  }
  const buffer = new ArrayBuffer(
    VR.TrackedDevicePoseStruct.byteSize * VR.k_unMaxTrackedDeviceCount,
  );
  const pointer = Deno.UnsafePointer.of(buffer) as Deno.PointerValue<VR.TrackedDevicePose>;
  const rows: unknown[] = [];
  try {
    const initial = await request("GETCONTROLLERSTATE") as State;
    if (
      !initial.enabled || initial.failed || initial.hands.some((h) => !h.active || h.updates === 0)
    ) throw new Error("Synthetic controllers not active");
    for (
      const [hand, role] of [
        VR.TrackedControllerRole.TrackedControllerRole_LeftHand,
        VR.TrackedControllerRole.TrackedControllerRole_RightHand,
      ].entries()
    ) {
      const index = system.GetTrackedDeviceIndexForControllerRole(role);
      if (
        index !== initial.hands[hand].index ||
        system.GetTrackedDeviceClass(index) !== VR.TrackedDeviceClass.TrackedDeviceClass_Controller
      ) throw new Error("Controller role/index mismatch");
    }
    const summaries = [];
    for (const mode of ["stationary", "sine"] as const) {
      const state = await setMotion(mode);
      // Warm the runtime cache after switching trajectories (no trajectory-dependent publication window).
      for (let i = 0; i < 10; i++) overlay.WaitFrameSync(100);
      for (const predictionSeconds of [0, .02]) {
        const positionErrors: number[] = [],
          yawErrors: number[] = [],
          queryDurations: number[] = [];
        let invalid = 0, syncErrors = 0;
        for (let frame = 0; frame < 150; frame++) {
          if (overlay.WaitFrameSync(100) !== 0) syncErrors++;
          const before = now();
          system.GetDeviceToAbsoluteTrackingPose(
            VR.TrackingUniverseOrigin.TrackingUniverseRawAndUncalibrated,
            predictionSeconds,
            pointer,
            VR.k_unMaxTrackedDeviceCount,
          );
          const after = now();
          const querySeconds = (before + after) / 2;
          queryDurations.push((after - before) * 1000);
          for (let hand = 0; hand < 2; hand++) {
            const index = initial.hands[hand].index;
            const pose = VR.TrackedDevicePoseStruct.read(
              new DataView(
                buffer,
                index * VR.TrackedDevicePoseStruct.byteSize,
                VR.TrackedDevicePoseStruct.byteSize,
              ),
            ) as unknown as VR.TrackedDevicePose;
            if (!pose.bPoseIsValid || !pose.bDeviceIsConnected) {
              invalid++;
              continue;
            }
            const m = pose.mDeviceToAbsoluteTracking.m;
            const phase = 2 * Math.PI * state.config.frequencyHz *
                (querySeconds + predictionSeconds - state.epochSeconds) + hand * Math.PI / 2;
            const sine = mode === "sine" ? Math.sin(phase) : 0;
            const expectedX = (hand === 0 ? -.25 : .25) + state.config.positionAmplitudeM * sine;
            const expectedYaw = state.config.yawAmplitudeRad * sine;
            const yaw = Math.atan2(m[0][2], m[0][0]);
            const errorM = Math.hypot(m[0][3] - expectedX, m[1][3] - 1.2, m[2][3] + .5);
            const errorRad = Math.atan2(Math.sin(yaw - expectedYaw), Math.cos(yaw - expectedYaw));
            positionErrors.push(errorM * 1000);
            yawErrors.push(Math.abs(errorRad) * 180 / Math.PI);
            rows.push({
              mode,
              config: state.config,
              phase,
              predictionSeconds,
              querySeconds,
              queryDurationMs: (after - before) * 1000,
              epochSeconds: state.epochSeconds,
              hand,
              position: [m[0][3], m[1][3], m[2][3]],
              velocity: pose.vVelocity.v,
              angularVelocity: pose.vAngularVelocity.v,
              yaw,
              expectedX,
              expectedYaw,
              errorM,
              errorRad,
            });
          }
        }
        summaries.push({
          mode,
          predictionSeconds,
          samples: positionErrors.length,
          invalid,
          syncErrors,
          positionErrorMm: stats(positionErrors),
          yawErrorDeg: stats(yawErrors),
          queryDurationMs: stats(queryDurations),
        });
      }
    }
    const final = await request("GETCONTROLLERSTATE") as State;
    const directory = new URL("../logs/ovrdriver-lab/", import.meta.url);
    await Deno.mkdir(directory, { recursive: true });
    const path = new URL(`controller-samples-${Date.now()}.ndjson`, directory);
    await Deno.writeTextFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    console.log(
      JSON.stringify(
        {
          controllerProbe: {
            summaries,
            nativeState: final,
            samplesFile: path.pathname,
            interpretation:
              "Client-pose measurement only; visual jitter and final-image consumption remain untested",
          },
        },
        null,
        2,
      ),
    );
    if (summaries.some((s) => s.invalid || s.syncErrors)) Deno.exitCode = 1;
  } finally {
    try {
      if (motionChanged) await setMotion("stationary");
    } finally {
      postal.detachProxy(id);
      clock.close();
    }
  }
}

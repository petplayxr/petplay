/** Inspect the real-HMD / synthetic-controller lab without changing display configuration. */
import * as VR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { stringToPointer } from "../submodules/OpenVR_TS_Bindings_Deno/utils.ts";
import { getOpenVrLibraryPath } from "../classes/nativeLibraryPaths.ts";
import { PostalService } from "../submodules/stageforge/mod.ts";
import { attachOpenVrDriverProxy } from "../classes/petplayOpenVrDriverProxy.ts";
const settings = JSON.parse(
  await Deno.readTextFile(`${Deno.env.get("HOME")}/.local/share/Steam/config/steamvr.vrsettings`),
);
if (settings.driver_petplay?.syntheticHmd || !settings.driver_petplay?.syntheticControllers) {
  throw new Error("Controller-only lab required");
}
if (!VR.initializeOpenVR(getOpenVrLibraryPath())) throw new Error("OpenVR unavailable");
const err = new Int32Array(1);
const ep = Deno.UnsafePointer.of(err) as VR.InitErrorPTRType;
VR.VR_InitInternal(ep, VR.ApplicationType.VRApplication_Overlay);
if (err[0]) throw new Error(`OpenVR init ${err[0]}`);
const postal = new PostalService();
let driver: Awaited<ReturnType<typeof attachOpenVrDriverProxy>> | undefined;
try {
  const ptr = VR.VR_GetGenericInterface(stringToPointer(VR.IVRSystem_Version), ep);
  if (!ptr || err[0]) throw new Error("IVRSystem unavailable");
  const system = new VR.IVRSystem(ptr);
  if (Deno.args.includes("--keep-awake")) {
    // The scoped lab owns exact settings recovery on exit; never alter an unscoped runtime.
    const recovery = new URL("../logs/ovrdriver-lab/restore.json", import.meta.url);
    await Deno.stat(recovery);
    const sp = VR.VR_GetGenericInterface(stringToPointer(VR.IVRSettings_Version), ep);
    if (!sp || err[0]) throw new Error("IVRSettings unavailable");
    const power = new VR.IVRSettings(sp);
    const se = new Int32Array(1);
    const sep = Deno.UnsafePointer.of(se) as Deno.PointerValue<VR.SettingsError>;
    const check = () => {
      if (se[0]) throw new Error(`Power settings error ${se[0]}`);
    };
    power.SetBool("power", "pauseCompositorOnStandby", false, sep);
    check();
    power.SetFloat("power", "turnOffScreensTimeout", 3600, sep);
    check();
    const paused = power.GetBool("power", "pauseCompositorOnStandby", sep);
    check();
    const timeout = power.GetFloat("power", "turnOffScreensTimeout", sep);
    check();
    if (paused || timeout !== 3600) throw new Error("Power override did not read back");
  }
  driver = await attachOpenVrDriverProxy(
    postal,
    `${settings.driver_petplay.socketDirectory}/control.sock`,
  );
  const state = await postal.PostMessage({
    target: driver,
    type: "GETCONTROLLERSTATE",
    payload: null,
  }, true) as {
    hands: { index: number }[];
    config: { worldTranslationM: number[]; worldYawRad: number };
  };
  const roles = [
    VR.TrackedControllerRole.TrackedControllerRole_LeftHand,
    VR.TrackedControllerRole.TrackedControllerRole_RightHand,
  ].map((r) => system.GetTrackedDeviceIndexForControllerRole(r));
  const poses = new ArrayBuffer(VR.TrackedDevicePoseStruct.byteSize * VR.k_unMaxTrackedDeviceCount);
  const origins: Record<string, unknown> = {};
  let rawHead: VR.TrackedDevicePose | undefined;
  for (
    const [name, origin] of [
      ["raw", VR.TrackingUniverseOrigin.TrackingUniverseRawAndUncalibrated],
      ["standing", VR.TrackingUniverseOrigin.TrackingUniverseStanding],
    ] as const
  ) {
    system.GetDeviceToAbsoluteTrackingPose(
      origin,
      0,
      Deno.UnsafePointer.of(poses) as Deno.PointerValue<VR.TrackedDevicePose>,
      VR.k_unMaxTrackedDeviceCount,
    );
    if (name === "raw") {
      rawHead = VR.TrackedDevicePoseStruct.read(
        new DataView(poses, 0, VR.TrackedDevicePoseStruct.byteSize),
      ) as unknown as VR.TrackedDevicePose;
    }
    origins[name] = [0, ...state.hands.map((h) => h.index)].map((index) => ({
      index,
      pose: VR.TrackedDevicePoseStruct.read(
        new DataView(
          poses,
          index * VR.TrackedDevicePoseStruct.byteSize,
          VR.TrackedDevicePoseStruct.byteSize,
        ),
      ),
    }));
  }
  let motionCommand: unknown;
  let stateAfter: unknown;
  if (["--sweep", "--place", "--hold", "--resume"].some((flag) => Deno.args.includes(flag))) {
    if (roles.some((r, i) => r !== state.hands[i].index)) {
      throw new Error(
        "Synthetic controllers do not own both hand roles; switch off physical controllers",
      );
    }
    let { worldYawRad, worldTranslationM } = state.config;
    if (!Deno.args.includes("--hold") && !Deno.args.includes("--resume")) {
      if (!rawHead?.bPoseIsValid) throw new Error("Headset must be tracking for placement");
      const m = rawHead.mDeviceToAbsoluteTracking.m;
      worldYawRad = Math.atan2(m[0][2], m[2][2]);
      worldTranslationM = [m[0][3], m[1][3] - 1.6, m[2][3]];
    }
    const ack = await postal.PostMessage({
      target: driver,
      type: "SETCONTROLLERMOTION",
      payload: {
        mode: Deno.args.includes("--sweep") || Deno.args.includes("--resume")
          ? "sweep"
          : "stationary",
        frequencyHz: Deno.args.includes("--fast") ? 1 : .35,
        positionAmplitudeM: Deno.args.includes("--fast") ? .20 : .12,
        yawAmplitudeRad: 0,
        worldTranslationM,
        worldYawRad,
      },
    }, true) as { accepted?: boolean; commandId?: number; __actorError?: unknown };
    if (!ack.accepted || ack.commandId === undefined) throw new Error(JSON.stringify(ack));
    motionCommand = ack;
    const deadline = performance.now() + 1000;
    while (true) {
      const applied = await postal.PostMessage({
        target: driver,
        type: "GETCONTROLLERSTATE",
        payload: null,
      }, true) as { appliedId: number };
      if (applied.appliedId === ack.commandId) {
        stateAfter = applied;
        break;
      }
      if (performance.now() > deadline) {
        throw new Error("Motion command was not applied within one second");
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  console.log(JSON.stringify({ roles, state, origins, motionCommand, stateAfter }));
} finally {
  if (driver) postal.detachProxy(driver);
  VR.VR_ShutdownInternal();
}

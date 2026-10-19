import { PostMan, actorState } from "../submodules/stageforge/mod.ts";
import * as OpenVR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { LogChannel } from "@mommysgoodpuppy/logchannel";


const state = actorState({
  name: "hmd_position_actor",
  vrSystem: null as OpenVR.IVRSystem | null,
  /** From `IVRSystem::GetFloatTrackedDeviceProperty(..., Prop_DisplayFrequency_Float, ...)`. */
  hmdDisplayFrequencyHz: null as number | null,
});

function readHmdDisplayFrequencyHz(vr: OpenVR.IVRSystem): number | null {
  const errBuf = new Int32Array(1);
  const pErr = Deno.UnsafePointer.of(errBuf) as
    | Deno.PointerValue<OpenVR.TrackedPropertyError>
    | null;
  if (pErr == null) {
    return null;
  }
  const hz = vr.GetFloatTrackedDeviceProperty(
    OpenVR.k_unTrackedDeviceIndex_Hmd,
    OpenVR.TrackedDeviceProperty.Prop_DisplayFrequency_Float,
    pErr,
  );
  if (errBuf[0] !== OpenVR.TrackedPropertyError.TrackedProp_Success) {
    return null;
  }
  if (!Number.isFinite(hz) || hz <= 0) {
    return null;
  }
  return hz;
}

export const api = {
  __INIT__: (_payload: void) => { },
  __HEALTH__: (_payload: unknown) => {
    let poseOk = false;
    let poseConnected: boolean | null = null;
    let poseValid: boolean | null = null;
    let error: string | null = null;
    try {
      if (state.vrSystem) {
        const pose = getHMDPose();
        poseConnected = Boolean(pose.bDeviceIsConnected);
        poseValid = Boolean(pose.bPoseIsValid);
        poseOk = poseConnected && poseValid;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      initialized: state.vrSystem != null,
      poseOk,
      poseConnected,
      poseValid,
      hmdDisplayFrequencyHz: state.vrSystem ? readHmdDisplayFrequencyHz(state.vrSystem) : null,
      error,
    };
  },
  GETHMDPOSITION: (_payload: void) => { return getHMDPose(); },
  /**
   * OpenVR `Prop_DisplayFrequency_Float` (Hz) for the HMD, or `null` if unavailable.
   * Reads live from `IVRSystem` when called.
   */
  GETHMDDISPLAYFREQUENCY: (_payload: void): number | null => {
    if (!state.vrSystem) {
      return null;
    }
    const hz = readHmdDisplayFrequencyHz(state.vrSystem);
    state.hmdDisplayFrequencyHz = hz;
    return hz;
  },
  INITOPENVR: (payload: bigint) => {
    const ptrn = payload;
    const systemPtr = Deno.UnsafePointer.create(ptrn);
    state.vrSystem = new OpenVR.IVRSystem(systemPtr);

    LogChannel.log("actor", `OpenVR system initialized in actor ${state.id} with pointer ${ptrn}`);
    const hz = readHmdDisplayFrequencyHz(state.vrSystem);
    state.hmdDisplayFrequencyHz = hz;
    if (hz != null) {
      LogChannel.log("actor", `[hmd] OpenVR HMD nominal display frequency: ${hz.toFixed(0)} Hz`);
    } else {
      LogChannel.log("actor", "[hmd] OpenVR HMD display frequency (Prop_DisplayFrequency_Float) not available");
    }
  },
} as const

new PostMan(state, api);

function getHMDPose(): OpenVR.TrackedDevicePose {
  const vrSystem = state.vrSystem!;
  const posesSize = OpenVR.TrackedDevicePoseStruct.byteSize * OpenVR.k_unMaxTrackedDeviceCount;
  const poseArrayBuffer = new ArrayBuffer(posesSize);
  const posePtr = Deno.UnsafePointer.of(poseArrayBuffer) as Deno.PointerValue<OpenVR.TrackedDevicePose>;

  vrSystem.GetDeviceToAbsoluteTrackingPose(
  OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding,
  0,
  posePtr,
  OpenVR.k_unMaxTrackedDeviceCount
  );

  const hmdIndex = OpenVR.k_unTrackedDeviceIndex_Hmd;
  const poseView = new DataView(
  poseArrayBuffer,
  hmdIndex * OpenVR.TrackedDevicePoseStruct.byteSize,
  OpenVR.TrackedDevicePoseStruct.byteSize
  );
  const hmdPose = OpenVR.TrackedDevicePoseStruct.read(poseView) as unknown as OpenVR.TrackedDevicePose;

  return hmdPose;
}

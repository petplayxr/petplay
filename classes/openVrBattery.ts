/**
 * Battery levels from OpenVR tracked-device properties, for `classes/environment/batteryStore.ts`.
 * Devices that do not report a battery (a tethered headset, a powered tracker) are left out.
 */
import * as OpenVR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import type { BatteryReading, BatteryReadings } from "./environment/batteryStore.ts";

export function readOpenVrBattery(
  vr: OpenVR.IVRSystem,
  index: number | null | undefined,
): BatteryReading | null {
  if (index == null || index === OpenVR.k_unTrackedDeviceIndexInvalid) return null;
  if (!vr.IsTrackedDeviceConnected(index)) return null;
  const errBuf = new Int32Array(1);
  const pErr = Deno.UnsafePointer.of(errBuf) as Deno.PointerValue<OpenVR.TrackedPropertyError>;
  const ok = () => errBuf[0] === OpenVR.TrackedPropertyError.TrackedProp_Success;

  const provides = vr.GetBoolTrackedDeviceProperty(
    index,
    OpenVR.TrackedDeviceProperty.Prop_DeviceProvidesBatteryStatus_Bool,
    pErr,
  );
  if (!ok() || !provides) return null;
  const fraction = vr.GetFloatTrackedDeviceProperty(
    index,
    OpenVR.TrackedDeviceProperty.Prop_DeviceBatteryPercentage_Float,
    pErr,
  );
  if (!ok() || !Number.isFinite(fraction)) return null;
  const charging = vr.GetBoolTrackedDeviceProperty(
    index,
    OpenVR.TrackedDeviceProperty.Prop_DeviceIsCharging_Bool,
    pErr,
  );
  return {
    // OpenVR reports 0..1.
    percent: Math.max(0, Math.min(100, fraction * 100)),
    charging: ok() && charging,
  };
}

export function readOpenVrBatteries(
  vr: OpenVR.IVRSystem,
  controllers: { left: number | null | undefined; right: number | null | undefined },
): BatteryReadings {
  const out: BatteryReadings = {};
  const hmd = readOpenVrBattery(vr, OpenVR.k_unTrackedDeviceIndex_Hmd);
  const left = readOpenVrBattery(vr, controllers.left);
  const right = readOpenVrBattery(vr, controllers.right);
  if (hmd) out.hmd = hmd;
  if (left) out.left = left;
  if (right) out.right = right;
  return out;
}

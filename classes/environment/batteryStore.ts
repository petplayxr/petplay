/**
 * Controller and headset battery levels for the wrist readout.
 *
 * The webxr actor polls OpenVR (`readOpenVrBatteries` in `classes/openVrBattery.ts`) and publishes
 * here; the wrist menu reads it with {@link useBatteryReadings}. A controller crossing below
 * {@link LOW_BATTERY_PERCENT} while not charging raises one toast, re-armed once it is charging or
 * back above the threshold, so a level wobbling at 14/15% does not repeat it.
 */
import { useSyncExternalStore } from "react";
import { pushToast, type ToastInput } from "./toastStore.ts";

export type BatteryDevice = "left" | "right" | "hmd";
export type BatteryReading = { percent: number; charging: boolean };
export type BatteryReadings = Partial<Record<BatteryDevice, BatteryReading>>;

export const LOW_BATTERY_PERCENT = 15;
/** Hysteresis for re-arming the low-battery toast. */
const REARM_PERCENT = LOW_BATTERY_PERCENT + 5;

const DEVICE_LABEL: Record<BatteryDevice, string> = {
  left: "Left controller",
  right: "Right controller",
  hmd: "Headset",
};

export function createBatteryStore(notify: (toast: ToastInput) => unknown = pushToast) {
  let readings: BatteryReadings = {};
  const warned = new Set<BatteryDevice>();
  const listeners = new Set<() => void>();

  return {
    get: () => readings,
    publish(next: BatteryReadings) {
      for (const device of Object.keys(DEVICE_LABEL) as BatteryDevice[]) {
        const reading = next[device];
        if (reading == null || reading.charging || reading.percent >= REARM_PERCENT) {
          warned.delete(device);
          continue;
        }
        if (reading.percent < LOW_BATTERY_PERCENT && !warned.has(device)) {
          warned.add(device);
          notify({
            title: `${DEVICE_LABEL[device]} battery low`,
            content: `${Math.round(reading.percent)}%`,
            tone: "warning",
            timeoutMs: 6000,
          });
        }
      }
      const same = JSON.stringify(next) === JSON.stringify(readings);
      readings = next;
      if (!same) { for (const listener of listeners) listener(); }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const batteryStore = createBatteryStore();

export function useBatteryReadings(): BatteryReadings {
  return useSyncExternalStore(batteryStore.subscribe, batteryStore.get, batteryStore.get);
}

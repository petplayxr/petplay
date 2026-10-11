import { getSetting, setSetting, subscribeSettings, useSetting } from "../settings.ts";

export function setControllerLaserEnabled(enabled: boolean): void {
  setSetting("controllerLaser", enabled);
}

export function getControllerLaserEnabled(): boolean {
  return getSetting("controllerLaser");
}

/** Fires on any settings change; callers re-read `getControllerLaserEnabled`. */
export function subscribeControllerLaserEnabled(listener: () => void): () => void {
  return subscribeSettings(listener);
}

export function useControllerLaserEnabled(): boolean {
  return useSetting("controllerLaser");
}

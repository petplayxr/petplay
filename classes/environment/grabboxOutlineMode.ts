import { getSetting, setSetting, useSetting } from "../settings.ts";

/** Whether grab-box chrome draws. The interaction hull stays active either way. */
export function getGrabboxOutlineVisible(): boolean {
  return getSetting("grabboxOutline");
}

export function setGrabboxOutlineVisible(visible: boolean): void {
  setSetting("grabboxOutline", visible);
}

export function toggleGrabboxOutlineVisible(): boolean {
  setGrabboxOutlineVisible(!getGrabboxOutlineVisible());
  return getGrabboxOutlineVisible();
}

export function useGrabboxOutlineVisible(): boolean {
  return useSetting("grabboxOutline");
}

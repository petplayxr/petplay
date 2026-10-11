import { useSyncExternalStore } from "react";

type GrabboxOutlineListener = () => void;

let grabboxOutlineVisible = true;
const listeners = new Set<GrabboxOutlineListener>();

function emitGrabboxOutlineChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Whether grab-box chrome draws. The interaction hull stays active either way. */
export function getGrabboxOutlineVisible(): boolean {
  return grabboxOutlineVisible;
}

export function setGrabboxOutlineVisible(visible: boolean): void {
  if (grabboxOutlineVisible === visible) return;
  grabboxOutlineVisible = visible;
  emitGrabboxOutlineChange();
}

export function toggleGrabboxOutlineVisible(): boolean {
  setGrabboxOutlineVisible(!grabboxOutlineVisible);
  return grabboxOutlineVisible;
}

function subscribe(listener: GrabboxOutlineListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useGrabboxOutlineVisible(): boolean {
  return useSyncExternalStore(subscribe, getGrabboxOutlineVisible, getGrabboxOutlineVisible);
}

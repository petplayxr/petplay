import { useSyncExternalStore } from "react";

let visible = Deno.args.includes("--dev-start-desktop-overlay");
const listeners = new Set<() => void>();

export function setWindowLayerVisible(nextVisible: boolean): void {
  if (visible === nextVisible) return;
  visible = nextVisible;
  for (const listener of listeners) listener();
}

export function getWindowLayerVisible(): boolean {
  return visible;
}

export function useWindowLayerVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getWindowLayerVisible,
    getWindowLayerVisible,
  );
}

const recenterListeners = new Set<() => void>();

/** Ask the spatial layer to move the layout in front of the head (wrist Recenter tile, REPL). */
export function requestLayoutRecenter(): void {
  for (const listener of recenterListeners) listener();
}

export function subscribeLayoutRecenter(listener: () => void): () => void {
  recenterListeners.add(listener);
  return () => recenterListeners.delete(listener);
}

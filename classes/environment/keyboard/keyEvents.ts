/**
 * Every key the in-VR keyboard emits, for whoever wants to watch: a playtest checking that a press
 * landed, without reading the desktop it was typed into. The sink still does the typing.
 */
import type { KeyboardLogicEvent } from "./types.ts";

const listeners = new Set<(event: KeyboardLogicEvent) => void>();

export function onKeyboardEvent(listener: (event: KeyboardLogicEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitKeyboardEvent(event: KeyboardLogicEvent): void {
  for (const listener of listeners) listener(event);
}

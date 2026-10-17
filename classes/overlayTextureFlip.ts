/**
 * `PETPLAY_FLIP_OVERLAY_Y=1` inverts the vertical texture bounds of every overlay. A Steam Frame
 * tester saw the whole image upside down (SteamVR 2.18.2, zink on Turnip) where DroidFrame's
 * SteamVR 2.17.10 with the same GL stack shows it upright; this lets a tester confirm a texture
 * orientation difference before PetPlay detects it itself.
 */
export const FLIP_OVERLAY_Y = Deno.env.get("PETPLAY_FLIP_OVERLAY_Y") === "1";

export function withOverlayFlipY<T extends { vMin: number; vMax: number }>(bounds: T): T {
  return FLIP_OVERLAY_Y ? { ...bounds, vMin: bounds.vMax, vMax: bounds.vMin } : bounds;
}

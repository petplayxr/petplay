# Pointer cursor renders as a grey square

Status: fixed 2026-10-11 (`HudPointerCursorModel` in `classes/environment/petplayXrController.tsx`)
Track: ui-ux-basics, stack-update

## What happens

The pmndrs pointer cursor (`cursorModel` on `PetplayDefaultXRInputSourceRayPointer`,
`classes/environment/petplayXrController.tsx`) draws as a large opaque grey quad, offset from the
hit point. See `capture.png` (2026-10-11, `--novr`, laser beam off, cursor forced on).

## Expected

A small dot at the hit point. It's the natural feedback once the laser beam is turned off in the
wrist settings page; today that setting hides the beam and shows no cursor at all, relying on the
hover highlight of the tile under the ray.

## Notes

- The cursor uses pmndrs' `PointerCursorMaterial` (a shader material). The raythree IR path probably
  can't translate it and falls back to a flat quad. Check how `buildPayload` treats non-standard
  materials before patching the cursor.
- Repro: set `cursorModel: true` on the ray pointer, then drive a hover with `utils/playtest.ts`
  (`hoverWristMenu`) and `client.ts capture`.

## Fix

The cursor is now `HudPointerCursorModel`: a `MeshBasicMaterial` circle placed along the ray just
short of the hit distance, with `raythreeHudOverUi` so it draws over the UI it sits on. Its radius
grows with distance (5 mm per metre, 3 mm minimum), so it looks about the same size near and far.
It's shown whenever the pointer has a cursor, laser on or off. `fixed.png` is a zoomed `--novr`
capture with the laser off: a small white dot on the hovered tile.

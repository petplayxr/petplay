# Pointer cursor renders as a grey square

Status: open
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

- The cursor uses pmndrs' `PointerCursorMaterial` (a shader material). The raythree IR path
  probably can't translate it and falls back to a flat quad. Check how `buildPayload` treats
  non-standard materials before patching the cursor.
- Repro: set `cursorModel: true` on the ray pointer, then drive a hover with `utils/playtest.ts`
  (`hoverWristMenu`) and `client.ts capture`.

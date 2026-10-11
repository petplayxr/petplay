# A stray floating circle is drawn in the base environment

Status: fixed 2026-10-11 (gated behind `PETPLAY_VRC_CAMERA_DEBUG=1`; confirm in VR with VRChat running)
Track: ui-ux-basics

## What happens

A ring floats in the scene with no meaning to the user.

## Likely source (unconfirmed, check with a capture)

`VrcCameraDebugVisuals` (`classes/environment/scene.tsx:205`) is mounted **unconditionally** in
the scene root (`scene.tsx:1540`). It draws debug markers whenever `vrcCameraDebugState` has
data:

- yellow torus r=0.18 → `lookAtTargetEstimate` (`scene.tsx:292`)
- magenta torus r=0.24 with RGB axes → `legacyOriginMatrix` (`scene.tsx:296`)
- cyan sphere + axes → `relativeCameraPose`

Those fields are fed by the VRC camera OSC receiver, so the markers appear once VRChat (or a
stale snapshot) sends camera data.

The desktop control surface also mounts `VREnvironmentPlaceholder` with two floor torus rings,
but only in `--control` mode (`petplay/desktopControlSurface.tsx:108`).

## Fix

Gate `VrcCameraDebugVisuals` behind a debug flag/setting (off by default) instead of deleting
it; it's useful when working on the VRC camera.

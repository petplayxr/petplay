# Dormant actors and unreachable code

Status: open
Track: stability-performance

No `PostMan.create` call site exists for `webxrOverlay`, `frameUpdater`, `webUpdater`,
`webUpdaterDirect`, `controllers`, `laser` or `OSC` (`frontend` was removed 2026-10-11).
`frameUpdater` and `webUpdater` share the actor name `updater`. They pull in
`CefCap`/`WebCapturer`/`IpcCapturer`.

Also unwired: `control` spatial nodes (deleted by `reconcileDisplayControls`, `addControl` has
no callers), `spatialHitbox.tsx` (no importers), `RoomWireBox`, the keyboard
`latestControllerData` intake, and likely `patchRendererToXrPoseOnly`.

Delete, or move to an `attic/` with a note, so the live surface is what's in the tree.

Source: `docs/ARCHITECTURE.md` §9.

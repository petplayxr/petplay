# Frame capture session and PipeWire buffers are not yet supported reliably

Status: in progress
Track: capture-in-repo

The ARM64 CI executable starts in DroidFrame, including bundled raylib. A real attempt with its
embedded screen-streamer fails before frames: no inherited session bus, then no ScreenCast portal
when DroidFrame's bus is supplied. This is an emulator/diagnostic-environment gap, not proof that
Frame lacks capture support.

The v0.0.10 helper changes use `OpenPipeWireRemote`, validate CPU buffers and pack supported
four-channel formats into BGRA rows. Helper-only environment overrides select the capture session
without changing PetPlay's OpenVR environment. The isolated Linux integration test has delivered
25 changing frames through a real KDE portal and PetPlay's TypeScript receiver.

Frame's nested Plasma uses a separate session bus; the app's KScreen output discovery does not enumerate Gamescope's
per-app VR panels. Capture and input permissions/targeting require separate checks.

See [the architecture assessment](../../../docs/STEAM_FRAME_CAPTURE.md) for evidence, source
revisions and a staged validation plan. No physical Frame pixel delivery has been verified.

Code: `submodules/screen-streamer/vendor/scap/src/capturer/engine/linux/{mod.rs,portal.rs}`,
`classes/ScreenCapturer/scclass.ts`, `classes/environment/workspaceDisplays.ts`.

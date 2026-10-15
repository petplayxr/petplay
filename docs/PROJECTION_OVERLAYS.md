# Projection overlays: a reprojected, frame-paced OpenVR overlay

PetPlay renders its whole 3D scene (windows' shells, toolbars, keyboard, wrist menu, lasers) itself
and shows it inside other people's VR apps (VRChat) as an OpenVR **overlay**. This document is what
we learned making that overlay *reprojected* and *paced* correctly with
`IVROverlay::SetOverlayTransformProjection`. Valve documents the geometry of that call in one line
and its timing not at all, and we found no public implementation that paces one, so everything below
was measured. Measurements are from 2026-10-13: SteamVR on Linux, a 75 Hz headset, a Radeon GPU (RADV),
VRChat running as the scene app.

Code: `classes/openVrProjectionOverlays.ts` (the overlays), `petplay/webxr.ts`
(`uploadRaylibShadowFrame`, `awaitProjectionPresentWindow`, `presentRaylibProjectionOverlays`),
`classes/webxrOverlayRaylib.ts` (eye targets), `classes/openVrOverlayFramePacing.ts` (pacing, poses,
`GetFrameTiming`). Enabled with `--webxr-projection-overlay` (live: `state.raylibProjectionOverlayEnabled`
in the `webxr` actor).

## Why: the panorama could never be stable

PetPlay inherited its presentation from Aardvark (`../aardvark`, written by a Valve OpenVR engineer):
render both eyes, resample them into a **head-locked stereo panorama** overlay ("varggles"). The world
is baked into the image with a head pose predicted to the next vsync, and the compositor shows the
image glued to the head. Every prediction error and every frame that reaches the compositor late moves
the whole world with your head. That is the slight constant judder head-locked content always has, and
desktop-window overlays (world-locked quads) never have.

A **projection overlay** instead says "this texture was rendered from this eye pose with this frustum".
The compositor then reprojects it to the pose it actually displays, the way it treats a scene app's eye
buffers.

## The API, as it actually behaves

- **One overlay per eye**, each with `SetOverlayTransformProjection(handle, TrackingUniverseStanding,
  transform, projection, eye)` and `SetOverlayTexture`.
- **The transform is the world-to-eye view matrix**, as a row-major 3x4 (the transpose of the top three
  rows of a column-major GL view matrix). The parameter is named `pmatTrackingOriginToOverlayTransform`
  and reads like an overlay pose, but handing it the eye pose (eye-to-world, what every other overlay
  transform takes) makes the scene swim *against* head motion. Found by inverting it live.
- **`VROverlayProjection_t`** is the tangents of the four half-angles: from a GL projection,
  `left = (m[8] - 1) / m[0]`, `right = (m[8] + 1) / m[0]`, `bottom = (m[9] - 1) / m[5]`,
  `top = (m[9] + 1) / m[5]`. Top/bottom follow `GetProjectionRaw`'s sign convention (up negative) in
  our code. That is unverified, because our frustum is symmetric, so the sign cannot show.
- **GL texture orientation:** default bounds (no V flip) are upright for our raylib render targets.
  The panorama overlay, by contrast, needed `vMin = 1, vMax = 0`.
- **Reprojection is real and strong.** Freeze the overlay (stop calling anything) and turn your head:
  the last image stays world-locked, with no judder, for as long as you like. So the compositor warps
  each frame from its tagged pose to the displayed pose, at least for rotation. What swim remains seems
  to be uncorrected head *translation* (it has no depth), and it grows with prediction length.
- **The image must match its tag.** We checked frame by frame: the view matrix we tag is exactly the
  one we rendered with, the head pose series is smooth, and world-anchored content has a constant world
  matrix while the head moves (81 of 100 UI panels over 1,900 frames). All judder below was timing.

## Timing: the undocumented part

### The compositor latches overlay state mid-frame, and pose and texture do not latch together

The judder that remained after the geometry was right came from **where in the frame we presented**.
Presents landed anywhere from 3 to 13 ms after vsync. Everything was consistent per frame, yet the scene
jumped between two poses on head motion. Experiments that ruled things out:

| experiment | result |
| --- | --- |
| freeze the overlay | perfectly stable, so reprojection works |
| tag each texture with the *previous* frame's pose | worse, so the pose is not lagging the texture |
| double-buffer the eye textures (never draw into the one shown) | no change |
| `glFinish` before presenting | waits only ~0.4 ms (p90 0.9), no change |
| all textures first, then both transforms (or the reverse) | no change. `SetOverlayTexture` takes ~0.7 ms (p95 1.6), a transform ~0.03 ms |
| **hold every present until just after the next vsync** | **judder gone**, at one more frame of latency |

So the compositor takes in overlay updates at a point in its frame, and a present that lands around
that point can be displayed with its texture and pose from different frames. Presents must land at a
**consistent** point, clear of that latch.

Binary analysis and indexed live traces now show the mechanism: the compositor copies the
projection pose into its scene graph under one shared lock, then reads the current texture ring
under another lock when building render records. The measured gap was 0.24–0.26 ms at the median,
up to 2.13 ms, and producer updates crossed it. The `0x201` notification is an overlay event,
not a texture-switch command. Also, pooled GL source textures do **not** establish distinct
SteamVR shared images: the trace saw one constant shared-image handle per eye. Image reuse and
GPU synchronization remain open. See
[`markdown/projection-overlay-re/compositor-snapshot.md`](../markdown/projection-overlay-re/compositor-snapshot.md).

### Where the latch is

`IVRCompositor::GetFrameTiming` reports the compositor's own phases, measured from its frame start.
`Compositor_FrameTiming` is plain C layout (it is not inside a `#pragma pack(4)` block): 192 bytes,
floats from byte 32, `m_flCompositorUpdateStartMs` at 84, `m_flCompositorUpdateEndMs` at 88,
`m_flCompositorRenderStartMs` at 92. Set `m_nSize = 192`. Read with `framesAgo = 1` (the last complete
frame), once per frame. About 5% of frames come back with zeros, so filter those out.

`IVROverlay::WaitFrameSync` (OpenVR v1.23.7; "will block until the top of each frame") returns at the
overlay "top of frame". Timing its return against `IVRSystem::GetTimeSinceLastVsync`:

| ms after vsync, in `GetTimeSinceLastVsync`'s clock | p5 | p50 | p95 | max |
| --- | --- | --- | --- | --- |
| compositor update starts (`m_flCompositorUpdateStartMs`) | 4.2 | 6.0 | 7.3 | 7.6 |
| `WaitFrameSync` returns | 6.9 | 8.4 | 9.3 | 10.8 |

`WaitFrameSync` returns ~2.4 ms after the update starts, after the latch. A present between this
frame's sync and the next frame's earliest update start is displayed at the vsync after next: **11 ms
to 17 ms after vsync** at 75 Hz. Confirmed in the headset, edge by edge: presents at 8–8.5 ms (on the
sync) and up to 18.5 ms (past the next latch) both juddered, and 11–15 ms was rock solid. The
compositor's numbers alone were not enough to set the edges. The "8.5 ms is after the latch" we first
derived from them was wrong, so trust the `WaitFrameSync` phase.

### Prediction: to the vsync the frame is actually shown on

A frame presented in that window is displayed two vsyncs after the vsync it was paced on, so its poses
must be predicted to then (`frameDuration * 2 - secondsSinceLastVsync + vsyncToPhotons`, ~26 ms).
Predicting to the next vsync (~15 ms) swims visibly, which is how we found that a present at 11 ms
misses this frame. Valve's Unity XR plugin landed on the same thing (1.2.3, 2024-07-18: "Using
WaitFrameSync in main loop for overlay apps", "Poses predict one frame ahead in overlay apps").

### Late frames are dropped, not presented

A frame that finishes after the window closes is **not presented at all**. The compositor keeps
reprojecting the last frame, so static content stays perfectly world-locked and only moving content
(hands, lasers) holds still for one frame. Presenting it late would land on the latch, which is the
judder. A dropped frame keeps its eye targets: they are not the ones on screen, so the next frame
draws into them.

The present gate checks the deadline both before and after waiting for the window to open.
Without the second check, a scheduler stall admitted starts at 20.9–23.9 ms even though the
window closed at 17 ms. This bounds submission start; the texture and transform calls still
need time to finish before the next pose snapshot.

### Eye targets: a pool of three pairs

The compositor reads a texture some time after `SetOverlayTexture`. So the pair on screen is never
drawn into, and in pipelined mode (below) neither is the pair waiting to be presented. Pairs are
created on first use, up to three (each pair is two 3560² RGBA textures, ~100 MB).

## The loop today (pipelined)

```text
pace to vsync N (spin on GetTimeSinceLastVsync's frame index), sample poses predicted to N+3
sim: IWER frame, r3f advance, scene extraction            (~6 ms)
present frame j-1 inside N's window (11-17 ms), or drop it if the window has closed
render frame j into a free eye pair                        (~5 ms; it waits for the next iteration)
```

Presenting the *previous* frame after the sim takes rendering off the critical path: only the sim
must finish by 17 ms. Frames show three vsyncs after pacing (~40 ms of prediction), which looks the
same as ~26 ms in the headset because every frame is reprojected. `state.raylibPresentPipelined =
false` presents each frame in its own iteration instead (two vsyncs, ~26 ms, but the whole
sim-plus-render has to beat 17 ms).

Dropped frames under VRChat load:

| loop | dropped |
| --- | --- |
| present when done (no window) | none counted, but every late frame juddered |
| present in the window, same iteration | 13–26% |
| pipelined | 0% when the GPU is quiet, ~11% when VRChat contends for it |

## What is left: one thread

A present can only happen between JavaScript tasks, and the loop is busy ~12 of every 13.3 ms. In
pipelined mode the render after the present runs past the next vsync whenever the GPU is contended
(render tail 10–13 ms). The next frame then starts late (we measured p90 starts 10 ms after vsync) and
its sim misses the window. However the work is ordered, some present gets pushed past the latch.

The way out is the one Aardvark took. Its renderer process does almost nothing per frame (walk the
latest scene graph, draw it in Vulkan, `SetOverlayTexture`), while all app logic runs in other
processes that send it scene graphs. So it presented ~2–3 ms after vsync, before the latch, every
frame, and the plain "predict to the next vsync" formula was always right. For PetPlay that means a
render-and-present thread or process consuming the scene IR, presenting on its own schedule
regardless of the sim. `petplay/desktopView.ts` is already a separate-process IR renderer, and the
dormant `webxrOverlay` actor was a second-process IR presenter. A render-only loop that finishes
within ~4 ms of vsync could also present *before* the latch and show frames one vsync sooner (~13 ms
of prediction). That needs a ~3 ms render, so it is a goal, not a given.

The follow-up RE separates that throughput improvement from correctness. SteamVR queues a
Vulkan copy after the source GL work; its final-image completion semaphores were absent from
the observed compositor's Vulkan wait list. Public `AcquireOverlayView` can pin the current
ring image, but re-acquisition moves that process's pin and can allow an older view to change.
Mirror access lock/unlock are no-ops in this build, and the current `GetFrameTiming` record
advances before GPU completion. A follow-up transparent-bank experiment confirms independent
image pins across overlay handles, but interrupted Show/Hide sequences publish both banks,
neither bank, or different banks for the two eyes. None of these facts establishes safe
retirement or coherent stereo publication by itself.
The intended public-API solution needs completed immutable generations, coherent stereo
publication, and verified retirement. A fixed window or another thread alone cannot guarantee
those under arbitrary load. Details and reproducible probes are in
[`ownership-and-publication.md`](../markdown/projection-overlay-re/ownership-and-publication.md).

## `WaitFrameSync` as the pacer

It is the documented primitive, and WayVR (`wlx-overlay-s`) paces its whole loop on it. For us it is
worse: it starts the ~10 ms frame at ~8.4 ms, so most frames finish past the next latch, and 57% were
dropped in a test. It suits a renderer that finishes well inside one frame. It remains in the pacer
(`state.raylibOverlayFrameSyncLive`, or `--webxr-overlay-frame-sync`), and its return phase is the best
measure of the latch.

## Measuring it yourself

All live in the `webxr` actor through the agent REPL's `/eval` (state only, no FFI from eval):

| state | what |
| --- | --- |
| `raylibPresentWindow` `{ minMs, maxMs }` | the present window, ms after the paced vsync |
| `raylibPresentDisplayFrames` | vsyncs after pacing a frame is shown (pipelined adds one); poses are predicted to it |
| `raylibPresentPipelined` | present one iteration behind rendering |
| `raylibPresentDropped` | frames not presented because the window had closed |
| `raylibPresentPhase` | per present: `[ms since vsync, vsyncs since the paced one]` |
| `raylibFrameStartPhase` | per frame: `[ms after its vsync the pace returned, ms after it the window check ran]` |
| `compositorTimingProbe` / `compositorTimings` | `GetFrameTiming` once per frame |
| `raylibOverlayFrameSyncLive`, `nativeRaylibPacer.frameSyncPhases` | pace on `WaitFrameSync`, and the phase it returns at |
| `raylibProjectionOverlays.lastTimings` | wall ms of the last present's OpenVR calls |
| `raylibProjectionOverlays.conventions` | `yDownTangents`, `flipV` |

Two tests settle most questions in the headset: **freeze** (stop presenting; if the frozen image
judders, the tags or geometry are wrong) and **shift** (move the window or the prediction and see
whether judder or swim follows).

## Pitfalls we hit

- PetPlay at idle priority (it inherits it from the shell or ananicy's deno rule) drops frames under
  VRChat load regardless of pacing. See `markdown/issues/steamvr-inherits-idle-priority-and-starves-under-load`.
- A hot reload that runs half-edited code can make the watchdog tear down render targets SteamVR still
  holds. One such teardown hung the worker forever inside `vrclient.so` → RADV
  `drmSyncobjTimelineWait`. Save related files together.

## References

- OpenVR `openvr.h`: `SetOverlayTransformProjection` ("Sets the overlay as a projection overlay",
  v1.16.8), `WaitFrameSync` (v1.23.7), `GetFrameTiming`.
- Valve's Unity XR plugin changelog, 1.2.3 (2024-07-18):
  https://github.com/ValveSoftware/unity-xr-plugin/releases
- Aardvark: `../aardvark/src/avrenderer/vrmanager.cpp` (`updateOpenVrPoses`, the varggles overlay),
  `aardvark_renderer.cpp` (`render`, `setOverlayTexture`), `javascript_renderer.cpp` (`runFrame`).
- WayVR: `wayvr/src/backend/openvr/mod.rs` (`wait_frame_sync` once per loop).

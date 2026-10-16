# Panorama controller jitter: audit and next controls

16 October 2026. Investigation, not a confirmed diagnosis.

The restored panorama shares the independent renderer, IR inbox, fresh tracking/anchors,
and text-cache fixes with projection. Head movement is reported stable, but controller/wrist
movement jitters in panorama and not projection. Commit `19a5f9f` tested panorama through the
same native GPU-finish → WaitFrameSync → texture-publication sequence; jitter remained.

Existing per-space anchor counts and eye calibration diagnostics are preserved.
SteamVR and PetPlay were not running during this audit; no headset comparison has yet been
performed for the new control below.

## What is shared, and what is not

Both branches in `petplay/overlayRenderOwner.ts` build eye cameras from one fresh head sample,
resolve controller tips through the same helper, apply the same grip calibration, and call
`resolveRenderAnchors` before rendering. Panorama's vsync/frame-sync pacing choices differ from
projection, but its `presenter` pacing explicitly selects the fast pacer and matching native
publication sequence. The combine uses the render head rotation after `39ae3de`, rather than
the older scene pose. That already corrected an independently identified head-motion mismatch.

However, the last A/B still changes several variables:

| Property | Projection | Panorama |
| --- | --- | --- |
| Submitted source | Alternating per-eye target pairs | One reused combined output target |
| GPU work after eye rasterization | No combine | Spherical resampling into output |
| Pixels submitted at 3560 px eye size | 2 × 3560² = 25,347,200 | 7120² = 50,694,400 |
| Overlay geometry and compositor path | Two projection overlays | One stereo-panorama overlay |

The panorama pixel count is twice projection's total, before considering the extra resampling
pass. Matching CPU API sequence does not match GPU workload, copy duration, image ownership,
or which generations actually reach display. The earlier conclusion that the remaining issue
cannot be presentation timing is stronger than the control supports.

Smooth head rotation is not sufficient evidence of even image delivery. Static world imagery
in a spherical representation and moving controller imagery can expose image age differently.
Head rotation, head translation, and controller-only movement should be tested separately.

## New opt-in source-rotation control

`WebXROverlayRaylib.useOutputTargetOtherThan` adds lazy panorama output-target rotation, analogous
to the existing eye-target rotation. `SETRENDERERDEBUG` accepts:

```json
{
  "panoramaPacing": "presenter",
  "panoramaTextureRotation": true
}
```

The default remains `false`, preserving the existing panorama implementation. Enable the
control on the renderer's full actor ID through `/message`; it neither changes controller poses
nor moves eye images through IPC. `lastRenderImages` in renderer health reports left, right,
and output GL names; use repeated samples to confirm that output names alternate. Keep pacing,
eye resolution, prediction, and scene-freeze state fixed across baseline/control/baseline.

Targets are allocated lazily and unloaded with the other render targets. At the normal eye
size, an additional output contains about 193 MiB of RGBA pixels, plus its depth attachment;
check GPU memory and use a smaller fixed resolution for an initial control if needed.

This is a source-reuse experiment, **not** an immutable-image or retirement guarantee. Previous
RE established that ordinary OpenGL submission can reuse compositor-side Vulkan backing and
perform a later copy. A source pool and producer `glFinish` do not prove that copy or compositor
sampling has finished. Improvement would implicate ownership/copy/frame-delivery behavior, not
establish a portable safety bound. No improvement would leave combine sampling, GPU delivery,
and controller prediction as open candidates.

Also corrected: native panorama frame-sync timeouts previously incremented `publishedFrames`
and entered the publication-phase log despite publishing no texture. They now increment only
the timeout count; a failed wait does not advance the protected output texture name.

## Remaining controls, in order

1. Freeze incoming IR while keeping render tracking live; separate panel and text behavior.
   Confirm per-space anchors exist, and compare the exact `presenter` pacing mode in both paths.
2. Run the source-rotation A/B/A at fixed resolution. Record rendered/published/received deltas,
   GPU-finish and publication durations, output names, and phase distributions. Headset feedback
   alone cannot identify which image generation was displayed.
3. Repeat at lower output resolution. A workload-dependent change points to delivery/GPU cost,
   rather than proving a coordinate-space error.
4. Feed a deterministic moving marker or replayed controller transforms into both paths while
   holding the head sample fixed. If CPU transforms are smooth but panorama output is not,
   investigate rendering/copy/display cadence before changing tracking prediction.
5. If needed, encode generation IDs into panorama output and capture compositor GPU consumption.
   Distinguish repeated/skipped images from irregular controller matrices within consecutive images.

Do not tune another millisecond window or change controller smoothing before these controls
identify what is irregular.

## Checks performed

- Existing focused tests: 15 passed (scene credits/inbox/wire, render tracking, and text cache).
- `git diff --check`: passed.
- Renderer type check still reports 188 diagnostics elsewhere in the imported dependency graph;
  none point to the changed renderer files.
- Output-target allocation/rotation and the headset effect remain untested on a live GPU.

## Deterministic controller experiment (remote, 16 October)

Implemented an opt-in renderer-side synthetic scene in `classes/overlayMotionProbe.ts`.
It does not need a moving physical controller or an OpenVR driver. `SETMOTIONPROBE` accepts
`{ "enabled": true, "durationMs": 30000 }` (maximum 60 seconds); it captures one head pose,
holds that head fixed, and replaces the IR scene with a green controller marker moving
±25 cm horizontally, 80 cm forward, on a two-second sinusoid. Its target time is monotonic
sample time plus the actual pacer's prediction horizon, not a frame-count increment.
Sixteen head-fixed tiles encode the low 16 bits of the render generation: red=0, blue=1,
least significant bit at the left. Both eye images carry the same generation.
The native renderer and publication paths are otherwise retained. No scene producer is
required. It restores the ordinary scene after its time limit or explicit disable.
GPU asset caches reset between synthetic and ordinary scenes; the IR inbox replays its
retained baseline so a frozen ordinary scene can recover without receiving another update.

`GETMOTIONPROBE` returns a bounded CPU log: generation, target/sample times, prediction,
marker position, render boundaries, publication completion/result, source texture IDs,
vsync indices/phases, and HMD activity. A successful setter is **not** a measurement of
compositor consumption. The log must eventually be joined with a compositor image capture.

### Producer geometry control

```sh
deno run -A --no-check utils/overlay-motion-probe.ts /tmp/petplay-motion-probe
python3 utils/overlay-motion-analyze.py /tmp/petplay-motion-probe/producer.json
```

Requires a working desktop GL display, but neither SteamVR nor a headset. The runner uses
virtual sample times, blocking GPU readback, and the production eye renderer and panorama
combine. **These frame times are intentionally not usable for pacing measurements.**

At 512×512 per eye, 120 generations were measured in each eye and each forward panorama
hemisphere (480 measurements). Every generation decoded correctly and every marker was present.
The marker centroid differed from the analytic pinhole/spherical projection by at most
0.299 pixels in the eye images and 0.468 pixels in panorama (RMS 0.158 and 0.250 pixels).
Thus the fixed-head, planar moving-marker control does not exhibit unexplained spatial jumps
inside successive producer images. This does not cover live hand prediction, UI/text lowering,
head motion, nonzero camera rotation, compositor image reuse, or displayed cadence.
The panorama also contains rear/seam copies: the analyzer deliberately measures the forward
hemisphere of each eye separately rather than taking a centroid across the entire panorama.

### Live CPU publication controls

```sh
# Full sequence; unattended real HMD may enter standby during later phases.
deno run -A --no-check utils/overlay-motion-live.ts /tmp/motion 3560 3000
# A single short phase in a fresh renderer process:
deno run -A --no-check utils/overlay-motion-live.ts /tmp/motion-one 3560 2000 panorama-presenter
# Other phase names: projection-before, panorama-presenter-rotated,
# panorama-vsync, projection-after.
python3 utils/overlay-motion-analyze.py /tmp/motion-one
```

The runner starts the **actual** `overlayRenderOwner.ts` as an isolated process and removes
its diagnostic overlays on completion. It does not launch the full scene/simulation or VRChat.
The real runtime reported 75 Hz and 2 ms vsync-to-photons. The installed null-driver defaults
are 90 Hz, 11.11111 ms vsync-to-photons, and 1512×1680 recommended render dimensions;
`utils/null-driver-toggle.ts` also changes forced-driver/debug/direct-mode settings on Linux.
Null-driver results must be labelled separately, with queried effective properties.

An unattended real HMD entered standby approximately five seconds after connection; the
server log confirms this transition. Subsequent `WaitFrameSync(100)` calls timed out, including
the later **projection** control, while ordinary vsync-paced publication continued. This is
not evidence against panorama or source rotation. The analyzer rejects standby-containing
runs as awake workload A/B comparisons. Do not hide these timeouts by widening a frame timeout.

Short fresh-process runs at both 512 and 3560 pixels avoided standby. An initial 3560 run
showed worse panorama CPU publication tails and improvement with source rotation, but that
pattern **did not reproduce** in the subsequent alternating controls. After discarding the
first 250 ms, three unrotated panorama runs had p95 publication intervals of
13.766/13.837/14.019 ms; two rotated runs had 13.753/13.753 ms; projection had 13.751 ms.
These are roughly two-second, minimal-scene runs, not representative workload benchmarks.
They establish working programmable publication controls, not even delivery to the display,
a diagnosis, or a reason to enable rotation by default.

Raw producer images and JSON logs are retained locally in ignored
`logs/overlay-motion-20261016/`. Focused tests pass (17 tests). The renderer type check still
reports the same 188 dependency diagnostics, with none in the new/changed renderer or probe files.

Next useful evidence: capture decoded image generations consumed by the compositor while
these controls run, then repeat under a representative scene and VRChat home workload.
A driver-injected controller can subsequently include SteamVR's controller prediction path;
the current injection intentionally bypasses that path to isolate renderer/publication behavior.

### Real-HMD standby control

A temporary **public IVRSettings** override of `power.pauseCompositorOnStandby=false` allowed
a 12-second 3560-pixel panorama-presenter test without changing drivers or HMD timing properties.
All 897 frames published successfully, with zero frame-sync timeouts; HMD activity was idle for
344 samples and standby for 553. After the first 250 ms, CPU publication intervals had
p50/p95/max 13.334/13.725/16.665 ms. This is a deliberately unpaused standby control, not a
measurement of awake scanout or an assertion that standby is otherwise equivalent to wearing
the HMD. The analyzer still labels its standby-containing record accordingly.

The override was removed through IVRSettings on completion, restoring its previous absence
(and therefore the installed default `true`); restoration returned no API error, and the
settings file was checked afterward. The null driver was inspected but **not enabled**.
For longer remote tests, preserve this distinction: either use a scoped standby override
with the real HMD, or run a separately labelled null-driver experiment. Record effective
frequency, prediction offset, optics, compositor configuration, and workload in either case.

## Synthetic driver and combined workload follow-up

The pure Zig driver now injects analytic controller motion, and the optional Vulkan diagnostic
captures compositor overlay images with redundant frame IDs. The important workload clarification
is **VRChat home + normal wrist menu + visible desktop overlay**. That combination has now run
in a synthetic session; the normal UI and desktop were verified in composed overlay captures.
A second diagnostic panorama presenter delivered 420 consecutive stereo generations without
repeats under that load, while sample-to-copy timing varied more than at idle.

This does not reproduce or solve the wrist bug: the IDs belonged to the additional marker
presenter, not the normal wrist renderer, and driver-direct mode changes async reprojection.
VRChat's synthetic eye resolution was also only 512². With a scene application SteamVR sends
separate scene and overlay layers; the current 960² captures show the overlay layer, not the
final combination of both. See the complete evidence, exclusions and next probe in
[FRAME-IDENTITY.md](../../submodules/petplay_ovrdriver/FRAME-IDENTITY.md).

### Full wrist sweep and paired paths

The next probe now tags the ordinary full-scene renderer and measures a magenta mesh inside
its actual wrist mount, preserving grip offsets, scene delivery and ordinary UI rendering.
It compares constant-speed sweep legs in both directions and accounts for the tilted marker's
perspective area centroid using captured-eye optics. A same-session VRChat home comparison of
panorama/projection with desktop hidden/visible produced subpixel motion residuals in all four
accepted conditions. It did not reproduce the real-HMD shake. A fixture with fresh IDs and
alternating ±3 ms pose-time error is detected, so duplicated IDs are not required for detection.

See [WRIST-SWEEP.md](../../submodules/petplay_ovrdriver/WRIST-SWEEP.md) for exact values, rejected
runs, native/capture changes and remaining scope. The marker measures the wrist mount via the
mesh renderer; it does not independently validate UI text-cache motion. Fixed synthetic head,
analytic controller derivatives, reduced VRChat scene resolution and disabled Linux async
reprojection remain substantial differences from the reported headset workload.

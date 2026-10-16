# Panorama controller jitter: audit and next controls

## Outcome (16 October 2026, later)

Panorama on the decoupled renderer is now smooth in the headset at nice 0 under heavy load
(load average ~27 on 16 cores, VRChat + FaceTrackVR). The causes found, in order:

1. **Latch alternation.** With vsync pacing the panorama presented 2–16 ms after vsync, while
   SteamVR latches overlays about 8–9 ms after it, so frames alternated between on time and
   late. Holding the present to 11 ms after vsync (`panoramaPresentMinMs: 11`) removed it.
   `native/waitFrameSyncProbe` showed `WaitFrameSync`'s phase jitters natively too (p5–p95
   2.9–6.4 ms), so it is not Deno. A hold derived from successive vsync timing (percentiles over
   a sliding window, not a running mean; see Valve's Compositor_FrameTiming notes) is still to
   do, so it doesn't depend on hardware or scene.
2. **Render-thread cost.** Slow renders were scheduler preemption (the slowest 2%: 5.5 ms on
   CPU + 6.1 ms in the run queue). Cheaper frames left more slack: renderRaythreeFrame
   4.16 → 2.27 ms (per-run panel slots, one panel data texture, cached struct bytes), and the
   worker now skips unchanged scenes (`classes/overlaySceneFingerprint.ts`), which took decode
   from 1.78 to 0.04 ms/frame while idle.
3. **Worker cadence.** The webxr worker's rAF was a free-running 13.3 ms timer that overshot
   to ~68 Hz, so worker-driven motion beat against the display. It is now locked to vsync
   (`vsyncLockedScheduler` in `classes/webxrPolyfills.ts`).
4. **Carried windows.** Grabbed windows moved at the worker's rate and from its older pose.
   They now follow the controller's fresh pose in the renderer (`renderTrackingFollow`; a
   two-hand frame for two hands), their OpenVR screens attach to the controller
   (`SetOverlayTransformTrackedDeviceRelative`), and a release handshake (FOLLOWRELEASE) lands
   them where they were last shown.

The misses left (~0.3% of latch windows) all line up with SteamVR compositor drops
(`native/compositorTimingProbe`: 7 of 7 next to a drop, against 2.7% by chance), and the
compositor render thread already runs SCHED_RR 99. Tried and dropped: an async frame-sync wait,
projection vsync pacing, deferred decode. Tools: `utils/petplay-frame-timeline.py`,
`utils/petplay-cpuprofile-analyze.py`. Open follow-ups:
[worker saturation](../issues/webxr-worker-saturates-when-the-scene-changes-every-frame/README.md),
[long-running degradation](../issues/long-running-dev-server-degrades-frame-pacing/README.md).

The audit below is the record from before these fixes.

---

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

## Real-HMD / synthetic-controller control (16 October)

The synthetic driver can now register controllers independently of its synthetic
HMD. `utils/petplay-ovrdriver-lab.py run --real-hmd` adds a scoped controller-only
manifest alongside the existing physical drivers and preserves the normal headset
display, async reprojection and power settings. The native ABI test verifies that
this mode adds only two controllers, publishes no HMD poses or display vsync, does
not block standby, and stops its sampling thread on cleanup.

The Beyond ran at its normal 75 Hz with synthetic hands owning both controller
roles. `utils/petplay-ovrdriver-hybrid-probe.ts --sweep` placed the rig once using
the real headset's raw pose, then ran the same 0.35 Hz, ±12 cm analytic sweep with
no yaw animation. The fixed `worldTranslationM` / `worldYawRad` placement matters:
the synthetic lab's default coordinates placed hands above and behind the user in
the real Lighthouse universe. The calibrated rig remains independent of subsequent
head movement.

With VRChat's home world and PetPlay's **full layout visibility** enabled (keyboard
and the normal desktop displays), the user reported **rapid wrist shaking in
panorama while holding the head still**. Native controller health and renderer
health were valid; both synthetic hands were selected, the right-hand scene anchors
were resolved, and the renderer reported no error. This reproduces the symptom
without physical controller tracking noise. It does not identify the exact compositor
phase or exclude controller prediction differences between real and synthetic drivers.
The same-condition projection comparison also shook about as much, according to
the user. This hybrid run therefore does **not** reproduce a panorama-only difference;
it isolates shaking under the real headset/full workload with synthetic motion.

These observations are headset feedback, not real-headset GPU image measurements.
The existing fixed-head 960×960 synthetic capture/analyzer is not valid unchanged
for the physical headset's image targets or a moving camera. Local setup and runtime
snapshots are in ignored `logs/ovrdriver-lab/hybrid-*.json` files.

An initial setup accidentally enabled desktop capture directly rather than the
wrist menu's layout visibility. Those temporary test displays were removed; the
reported reproduction was obtained after enabling the real scene visibility state,
with its normal keyboard and displays. PetPlay also needed a restart after starting
before SteamVR triggered a text-layout error; the accepted run has a populated scene
and fresh right-hand anchors.

Further in-person controls narrowed this result:

- With synthetic hands stationary, head movement produced very little jitter.
- Increasing the sweep from 0.35 Hz / ±12 cm to 1 Hz / ±20 cm made the movement
  jitter more obvious. Plateau speed increases from about 0.19 to 0.89 m/s.
- With VRChat and projection unchanged, disabling the **full UI visibility**
  (keyboard/displays; the wrist remains visible) produced **almost no jitter even
  at the faster speed**, according to the user.

Thus the current reproduction is strongly dependent on full-UI visibility and
moving hand imagery; it is not exclusive to panorama in this hybrid setup.
Changing UI visibility changes scene drawing and desktop capture together, so this
control alone does not identify GPU cost, CPU work, image reuse, or scene-delivery
alignment as the cause. A full-UI-on control with scene adoption frozen, fresh
tracking still enabled and the same fast sweep is the next separation.

The full-UI-on frozen-scene control was almost smooth, and unfreezing restored the
shaking; the user explicitly confirmed that keyboard/displays were visible for
that reverse check. The native desktop host listed zero virtual display handles
at that point despite its visibility/capture flags being true, so the exact native
quad workload is not established for that part of the comparison. Keep this
qualification: headset feedback establishes the visible full-UI condition, while
native quad activity should be separately verified before attributing cost to it.

This is evidence for scene adoption, scene-to-render transform consistency, or the
work adoption triggers. It does not yet distinguish these possibilities: freezing
scene adoption also avoids some decode/asset-update/rebuild work. A subsequent CPU
probe compares wrist local matrices, world trajectories, and render/publication
timing across live and frozen intervals. Its projected 960×960 fields must not be
interpreted as real-headset image measurements.

### CPU live/frozen capture on the real headset

A continuous wrist probe captured 464 live-scene rows followed by 527 frozen-scene
rows in approximately seven seconds per condition, with fresh tracking and the
fast sweep throughout. Discarding 30 transition/warmup rows per condition:

| CPU measure | Live scenes | Frozen scene |
| --- | ---: | ---: |
| Pose-sample interval p50 | 13.65 ms | 13.36 ms |
| Pose-sample interval p95 | 24.51 ms | 15.49 ms |
| Render-call wall time p95 | 8.32 ms | 6.24 ms |
| Sample-to-publication-return p95 | 20.69 ms | 12.67 ms |
| Wrist marker local-matrix variation | exactly zero | exactly zero |

The marker's CPU world position also followed the native analytic trajectory in
both conditions: after subtracting a fixed mount/room offset and excluding sweep
reversals, p95 error along the sweep axis was approximately 0.057 mm live and
0.066 mm frozen (maximum 1.39 / 1.06 mm). This uses each row's sample time plus
prediction and the native controller epoch; it is a CPU sanity check, not an image
or scanout latency measurement. It does not establish the stability of every text
or UI instance.

The stronger current lead is work triggered by live scene delivery/adoption
causing irregular rendering/publication, rather than the wrist marker's local
transform changing between scenes. The native direct-mode lab did not expose this
real-headset timing behavior. Profile decoding/adoption, geometry/text/asset
updates and publication waits in the real-HMD reproduction next; distinguish
CPU stalls, GPU waits and compositor delivery before selecting a fix.

The diagnostic adds a small frame-ID strip and therefore slightly changes draw
workload; the subjective live/frozen comparison was reproduced before enabling it.
The probe and freeze were disabled after capture; the fast synthetic sweep and
full UI remain active for further testing. Raw CPU rows and setup snapshots remain
local in ignored `logs/ovrdriver-lab/`.

### Redundant text work confirmed and reduced

Two text caches depended on object identity even though process scene decoding
creates fresh objects. In live scenes, CPU glyph conversion rebuilt about 78.9
geometries per rendered stereo frame (p95 101); the frozen scene rebuilt zero.
Regular raythree geometry/material asset updates were already zero in this capture.

`UiTextGeometryInterner` now retains unchanged decoded text geometry using exact
buffer-content and revision checks, bounded to the latest scene. Text batches
compare render content rather than snapshot object identity. Their existing owned
world-matrix check remains, so fresh tracked-hand movement still rebuilds world-baked
vertices. Opacity, glyph-buffer, revision and slot-order changes invalidate correctly.

| Measured live-scene work | Before | After |
| --- | ---: | ---: |
| CPU text geometries built per stereo frame, mean | 78.87 | 0.002 |
| Text batches rebuilt per stereo frame, mean | 3.57 | 2.10 |
| Left-eye text CPU time, p95 | 2.34 ms | 0.57 ms |
| Total render-call wall time, p95 | 6.08 ms | 4.71 ms |

The user reported **some improvement, but still noticeable shaking**. Thus this
removes demonstrated redundant work without resolving the full pacing problem.
Decoding full snapshots still costs time; frames spanning two scene receipts had
longer sample intervals, though that correlation alone does not establish causality.

The four cache/transform tests pass with type checking. All twelve focused
cache/scene-delivery/wire tests pass at runtime with `--no-check`; the imported
application type graph still has its known unrelated errors (188 in the presenter
check, none reported in the changed presenter/cache files).

The presenter exposes bounded opt-in work counters through `SETRENDERWORKPROBE`
and `GETRENDERWORKPROBE`, plus `PROFILECPU` for a 100..30000 ms in-process V8 CPU
capture. `utils/petplay-overlay-cpu-profile.py` saves matched live/frozen profiles
and frame counters locally and restores the previous freeze state. It opens no
remote inspector endpoint. Profile samples around FFI need interpretation: native
CPU execution, GPU waits and runtime waits cannot be separated by JS stacks alone.

At the user's request, SteamVR's live `power.pauseCompositorOnStandby` was set false
and `turnOffScreensTimeout` to 3600 seconds for this lab session, with successful
API readback. The scoped launcher's original-settings backup restores these on exit.

### V8 CPU profiles after the text-cache fix

Matched 10-second presenter profiles were captured through Deno's working
`node:inspector` / `Profiler` implementation, sampled at 1 ms. These remain local:
`logs/ovrdriver-lab/cpu-profile/live.cpuprofile` and `frozen.cpuprofile`, with matching
`*-work.json` counters. Live recording received 660 scenes and rendered 722 frames;
frozen recording received zero scenes and rendered 743 frames. This verifies that
profiling did not itself serialize away scene delivery. Recording restores live
adoption afterwards, and no remote debugging listener is opened.

Weighted stack samples showed approximately:

| V8 sampled stack time | Live updates | Frozen scene |
| --- | ---: | ---: |
| `decodeOverlayScene`, inclusive | 1.20 s | absent |
| Garbage collector | 226 ms | 51 ms |
| `renderRaythreeFrame`, inclusive | 2.09 s | 1.87 s |
| Native presenter call, inclusive | 5.62 s | 6.15 s |

Inclusive rows overlap their descendant functions and are not additive. Native
presenter samples include blocking GPU/runtime waits, not just CPU execution.
Profiler start/stop also appeared in the sample stacks (about 0.52 / 0.33 s);
those are instrumentation overhead, not an application optimization target.
The profile is evidence for a substantial decoder/allocation cost; exact unprofiled
frame timing still comes from the separate work/phase probes.

`decodeOverlayScene` deserializes every complete V8/base64 scene packet. UI text
geometry lives directly in `payload.ui.texts[].geometry`, outside the revisioned
raythree `AssetBatch`. Even unchanged glyphs therefore cross the process boundary
and allocate decoded buffers on each new snapshot. Renderer-side interning saves
conversion and mesh work **after** that cost has already occurred.

The next transport optimization should give UI glyph geometry a stable revisioned
asset identity, retain it at the consumer, and send only actual geometry changes
plus current transforms/UI state. It must preserve the current skipped-frame asset
dependency and restart/baseline guarantees; switching serializers alone would not
remove redundant unchanged data. Consider render-owned adoption/backpressure too,
but do not infer causality solely from longer frames containing more receipts.

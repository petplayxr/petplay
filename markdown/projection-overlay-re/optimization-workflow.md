# Overlay performance investigation and optimization workflow

This is a repeatable workflow for agents working on PetPlay's independent raylib
presenter. It records the real-headset controller-jitter investigation, including
controls that prevented misleading conclusions. Read `AGENTS.md` and
`docs/ARCHITECTURE.md` first. Observations and raw captures belong in local `logs/`;
settled findings and reproducible procedures belong in documentation. Do not commit,
push, change global tracking policy, or publish headset captures without authorization.

## Objective and success criteria

The practical target is smooth moving overlay content under a representative scene
workload, with fresh render-time tracking. Optimize recurring work and timing tails,
not a guessed millisecond phase offset or average FPS alone. At 75 Hz a frame is
13.33 ms; other refresh rates and workloads change the available budget. A low mean
can conceal missed delivery deadlines.

Keep these measurements distinct:

- Scene update/extraction rate and IR transport latency.
- Presenter pose-sample intervals and render-call wall time.
- Time from pose sampling to publication API return.
- Actual compositor image delivery, stereo pairing, and displayed motion.
- The user's headset observation.

CPU publication return is not scanout. V8 samples around FFI do not distinguish
native CPU execution from blocking GPU/runtime waits. A smooth CPU trajectory does
not prove even image delivery.

## Establish a reproduction before optimizing

Record git revisions, uncommitted changes, headset/display frequency, SteamVR build,
GPU/driver, presentation mode, pacing options, scene visibility, and foreground VR
application. Keep raw logs private: VRChat logs contain account and room identifiers.

The useful physical reproduction was:

1. Real Bigscreen Beyond at normal 75 Hz with Linux async reprojection enabled.
2. Synthetic controllers, with physical controllers powered off and both hand roles
   verified to belong to the synthetic devices.
3. The ordinary independent presenter and ordinary wrist menu.
4. VRChat's home world loaded and settled.
5. PetPlay's **full layout visibility** enabled: keyboard and normal displays.
6. A constant-rate controller sweep while the user holds the head still.

Do not silently substitute desktop capture for full layout visibility. Sending
`WRIST_MENU_ACTION` directly to `displayOverlayHost` affects that host, but does not
necessarily update the scene's visibility store or the wrist button's React state.
Confirm what the user actually sees. Check `wristMenu.GETWRISTMENUSTATE`, the scene's
`windowLayerMode.getWindowLayerVisible()`, and `displayOverlayHost.__HEALTH__`.
Native display handles, texture readiness, and visibility are separate facts.

### Scoped driver setup

Build the driver before starting SteamVR. Read the driver's `CONTROLLER-LAB.md` and
`LIVE-LAB.md` before using the launcher. With SteamVR stopped:

```sh
/home/ellie/.zvm/bin/zig build --build-file submodules/petplay_ovrdriver/build.zig -Doptimize=ReleaseSafe
python3 utils/petplay-ovrdriver-lab.py run --real-hmd --seconds 3600
```

Run the launcher in an owned foreground tool session, not a detached child that
will be cleaned up when its parent exits. `--real-hmd` preserves the physical
headset/display/power configuration and adds a controller-only driver manifest.
Never use the synthetic-only driver-direct profile as a substitute: it changes
reprojection, optics and timing, and failed to reproduce this physical behavior.

Once the real headset is tracking and the user looks forward:

```sh
deno run -A --no-check utils/petplay-ovrdriver-hybrid-probe.ts --sweep
# Change speed while preserving the rig's world-space placement:
deno run -A --no-check utils/petplay-ovrdriver-hybrid-probe.ts --resume --fast
# Stop motion without moving the rig:
deno run -A --no-check utils/petplay-ovrdriver-hybrid-probe.ts --hold
```

`--sweep` places the rig once relative to the raw head pose. Default motion is
0.35 Hz / ±12 cm; `--fast` is 1 Hz / ±20 cm, roughly five times the plateau speed.
The rig stays world-fixed afterwards. Re-running `--sweep` repositions it; use
`--resume` for speed comparisons that must preserve placement. Check API acceptance
**and** applied command ID before treating a control as active.

If the user asks to suppress headset standby during testing:

```sh
deno run -A --no-check utils/petplay-ovrdriver-hybrid-probe.ts --keep-awake
```

This requires an active scoped recovery backup, disables compositor pause on standby,
and sets the display timeout to one hour. It does not disable computer sleep. Confirm
which the user means. The lab launcher restores original settings on exit.

### Application startup and health

An existing SteamVR auto-launch may start PetPlay without the independent renderer.
Check `webxr.__HEALTH__.independentRenderer.enabled`; do not infer mode from a visible
headset image. Stop a conflicting watcher/server by its verified PID before running
another server. Preserve the user's desktop environment using the launcher's
`desktop_env()` helper when running remotely; do not dump arbitrary process environment.

The test server command is:

```sh
deno run -A --unstable-webgpu --env-file --no-check petplay/petplay.ts dev --agent-repl --openvr-attach-only --webxr-decoupled-renderer --wrist-motion-probe
```

Wait for a populated scene and resolved right-hand anchors, no renderer error, and
increasing publication counters. Invalid tracking can leave a working headset image
but no new overlay frames. An early start before SteamVR triggered a text-layout
error in this session; restarting PetPlay with the runtime already available restored
the scene. Do not measure an empty or broken scene as a performance improvement.

## Controls that isolate the problem

Change one factor at a time, state the condition before asking for feedback, and
record the answer verbatim. Allow time for the user to see it.

| Control | What it helps separate |
| --- | --- |
| Fixed hands, moving head | Head-dependent behavior versus moving overlay content |
| Faster hand sweep, fixed placement | Motion-dependent error; fixed timing error produces larger displacement at higher speed |
| Panorama versus projection | Presentation branch dependence under the same workload |
| Full UI on versus off | Work associated with the visible keyboard/displays |
| Full UI visible, `freezeScene: true` | Work/consistency associated with scene updates versus drawing a held snapshot |
| Unfreeze again | Reverse check; avoids attributing unrelated recovery to the control |

Use `SETRENDERERDEBUG {freezeScene:true}` on the **renderer actor**, discovered via
`webxr.__HEALTH__.independentRenderer.actor`. This preserves fresh render tracking.
`freezeRendering` is a different control and does not test the same hypothesis.
Freezing also stops packet decoding and reduces asset/rebuild work; it is not a
pure pose-consistency test. Confirm visible UI after each toggle and restore the
original freeze state in `finally`.

In this investigation both projection and panorama shook with full UI; UI off was
almost smooth; freezing scene adoption with visible UI was almost smooth; unfreezing
restored shaking. The wrist marker's local matrix was exactly constant. This narrowed
the next work to scene-related cost/consistency, without proving a particular cause.

## Low-overhead work counters first

The presenter accepts:

```json
{"target":"RENDERER_ACTOR_ID","type":"SETRENDERWORKPROBE","payload":true,"reply":true}
```

After a bounded capture, request `GETRENDERWORKPROBE`, save the result locally, then
send `SETRENDERWORKPROBE false`. The ring caps at 2000 rows and enabling/disabling
clears it. It includes render phases, decode time, received-scene counts, geometry/
material batch counts, CPU text geometry builds, text batch hits/rebuilds, and
uploaded text vertex counts. Counters apply to the stereo render; per-eye timing
fields remain explicitly named.

Use warmup/transition exclusions (the captures here discarded 30 rows per condition).
Report p50/p95/max and counts. Do not treat the last decode-time value repeated in
frozen rows as active decoding: compare the received-scene counter.

`SETWRISTMOTIONPROBE true` is a separate diagnostic that adds a small frame-ID strip
and logs marker local/world matrices, tracking prediction, and publication phases.
It needs the actual wrist marker from `--wrist-motion-probe`. Disable it afterwards.
The synthetic probe's projected **960×960 pixel fields are not real-headset image
measurements**. Use local/world transforms and timestamps for CPU checks, or adapt
the capture geometry/optics before analyzing physical images.

## Frame timing

`utils/petplay-frame-timeline.py` works against a live `--agent-repl` server:

```bash
python3 utils/petplay-frame-timeline.py debug '{"panoramaPacing":"vsync","panoramaPresentMinMs":11}'
python3 utils/petplay-frame-timeline.py capture --seconds 30 --output _scratch/tl.json
python3 utils/petplay-frame-timeline.py latch _scratch/tl.json --misses
python3 utils/petplay-frame-timeline.py worker-fps
```

For compositor correlation, run `native/compositorTimingProbe` (build command in its header)
for the same period as `capture`, then `compositor <probe.csv> <timeline.json>`.

## Deno/V8 CPU profiling

`utils/petplay-cpuprofile-analyze.py <file> --frames N` summarises any `.cpuprofile`;
`--under <function>` breaks a subtree down; `--between <frame tick function>` shows what runs
outside the ticks and during long gaps (used for the webxr worker with `onDeviceFrame`).

First verify the local Deno implementation supports `node:inspector` and
`Profiler.enable/start/stop`; no browser or external debugger is required.
`classes/cpuProfile.ts` implements a bounded 100..30000 ms capture with 1 ms sampling.
The presenter's `PROFILECPU` message calls it inside the presenter process, not the
scene worker or host. Profiling the wrong actor produces the wrong optimization target.

For matched live/frozen profiles:

```sh
python3 utils/petplay-overlay-cpu-profile.py --seconds 10 --output logs/ovrdriver-lab/cpu-profile
```

The collector discovers the current renderer actor, records `.cpuprofile` files and
matching work/health snapshots, and restores the previous freeze state in `finally`.
No remote inspector port is opened. Live `receivedScenes` must increase; frozen
`receivedScenes` should stay flat. This verifies that the profiling handler did not
accidentally serialize away the workload being profiled.

A `.cpuprofile` contains `nodes`, `samples`, `timeDeltas`, `startTime`, and `endTime`.
To analyze it programmatically:

1. Map node IDs to call frames and child IDs to parent IDs.
2. For each sampled ID, weight it by the matching `timeDeltas` entry (microseconds).
3. Add that weight to the sampled node for self time; walk its parents for inclusive time.
4. Group matching function/URL locations when comparing captures. Avoid double-counting
   recursion when aggregating the same location from multiple nodes.
5. Separate idle, GC, inspector start/stop, project JS, decoding, and native-call stacks.
6. Compare equal-duration conditions and their actual frame/scene counts. Keep profiler
   overhead separate from unprofiled frame timing.

Inclusive rows overlap and cannot be added as independent costs. In this session
native `present()` occupied much of the stack samples because it waits. Inspector
start/stop itself also appeared prominently. Neither automatically means a CPU hotspot.
V8 line numbers can refer to transpiled source; verify function names against the
current code rather than editing a source line solely by profile line number.

## Optimization loop and correctness checks

1. Capture a baseline with a reproducible workload and user feedback.
2. Identify the specific repeated operation, including its cache key and lifetime.
3. Measure its count/cost before changing behavior.
4. Make one reviewable change. Keep fresh tracking independent of scene age.
5. Test the failure modes the optimization could introduce: stale glyphs, opacity,
   changed buffers at equal lengths/revision, swapped slots/fonts, controller movement,
   skipped scenes, lost/out-of-order receipts, renderer restart and complete baselines.
6. Repeat the same counters/profile/subjective control. Reproduce a reverse control
   where practical. Record residual jitter rather than declaring success from lower ms.
7. Leave capture/freeze controls disabled, retain local artifacts, document code and
   workload revisions, and state what remains uncertain.

The first confirmed waste was object-identity text caching across independently
decoded packets. Exact geometry interning and semantic batch comparison reduced
~79 CPU glyph rebuilds/frame to essentially zero, and left-eye text p95 from 2.34 to
0.57 ms. Moving wrist matrices still invalidate world-baked batches. The user reported
partial improvement, not elimination.

The next profiles showed ~1.20 s of inclusive scene decoding and 226 ms of GC in a
10-second live capture, versus no decoding and 51 ms GC frozen. UI glyph buffers
were still included in every snapshot outside revisioned assets. Optimize that
transport redundancy next while retaining dependency and restart guarantees.

Focused checks used here:

```sh
deno test -A classes/uiTextSnapshotCache.test.ts classes/uiTextBatchTransforms.test.ts
deno test -A --no-check classes/overlaySceneDelivery.test.ts classes/overlaySceneWire.test.ts classes/uiTextSnapshotCache.test.ts classes/uiTextBatchTransforms.test.ts
git diff --check
```

The wider imported application type graph had known unrelated errors; report that
limitation honestly and check whether diagnostics point at changed files. A passing
runtime suite with `--no-check` is not a clean application type check.

## Recovery and handoff

Keep the lab launcher's `logs/ovrdriver-lab/restore.json` until SteamVR has stopped and
restoration succeeds. Its backup contains exact settings/driver-registration bytes.
Stop the owned lab session normally to trigger cleanup, or, with SteamVR stopped:

```sh
python3 utils/petplay-ovrdriver-lab.py recover
```

Do not restore physical-driver settings while SteamVR is live. Do not delete a pending
backup or stack another lab profile on top of it. Record whether the runtime/test
sweep is intentionally still running, the selected presentation mode, standby override,
and any active debug controls. A handoff should link this workflow, the latest
findings, local artifact paths, code changes/tests, and the precise next experiment.

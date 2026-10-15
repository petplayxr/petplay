# Independent renderer: first implementation

15 October 2026. Experimental, opt-in, not the default presenter.
See the [design and acceptance plan](decoupled-render-present-plan.md) and
[research limitations](deep-dive.md).

## What is implemented

`petplay/overlayRenderOwner.ts` is a child-process actor with its own OpenVR interfaces,
raylib context, eye targets, tracking sample, cameras, and continuous render loop. It renders
the latest received Raythree IR repeatedly; neither a scene message nor its acknowledgement
advances simulation. No eye image crosses the actor boundary. The WebXR worker uses its own
simulation clock and remains the authority for input, hit tests, UI, and application state.

The renderer computes both eye views from one head sample and the actual OpenVR eye-to-head
transforms. It preserves the existing scene projection calibration by default, while always
overriding the IR-time eye views with independently sampled render poses. Projection metadata
is optical calibration, not a dependency on the scene's pose or tick: a frozen scene still
renders with fresh views. Direct device projections remain a diagnostic comparison mode.

Tracked head/hand window roots, controller models, and aim beams carry tracking-local transforms.
The renderer resolves them against its own tracking, including the IWER target-ray-to-grip
calibration sent with the scene. Hit cursors retain the simulation's hit placement. This does
not make hit tests, grab constraints, or beam lengths newer than the simulation that computed
them. Controller alignment and interaction behavior still need live headset validation.

`classes/overlaySceneDelivery.ts` retains owned copies of the latest asset revisions, including
changes introduced in skipped scenes. Consumers acknowledge an epoch, stream, sequence, and asset
watermark. The projection renderer negotiates two transport credits; the legacy desktop consumer
retains one. Late or foreign acknowledgements cannot release current credit. A restarted renderer
registers a new stream and receives the full asset baseline.
The current 256 MiB estimated cache budget fails visibly instead of growing indefinitely; asset
removal, eviction, and recovery after overflow are unfinished.

The projection stream uses `classes/overlaySceneWire.ts`: a same-runtime V8 binary serialization
inside a base64 string carried by the existing JSON actor envelope. This retains typed buffers
and shared stereo extraction identity, avoiding expanded JSON numeric objects and duplicate eye
graphs. It is a versioned internal transport, not a portable persisted IR format. The child
retains received asset revisions in `OverlaySceneInbox` before returning receipt credit; scene
snapshots may then coalesce before GPU adoption without losing dependencies. Rendering consumes
all not-yet-adopted asset deltas with the newest scene. Receipt acknowledgements can overlap the
native frame wait and never advance simulation. A returned credit publishes a newer available
scene immediately instead of waiting for another simulation tick.

`native/overlayPresenter/presenter.cpp` calls only public `IVROverlay_027` functions. On the
context-owning thread it finishes the producer's GL work, waits for `WaitFrameSync`, then issues
both textures and both projection transforms consecutively. Preparation and GPU completion
precede the wait; no JS callback occurs between the wait and those setters. A timeout publishes
nothing. Setter failure stops the pair and reports completed calls; cleanup destroys the child
overlays. This uses no empirical 11–17 or 12–17 ms publication window.

## Build and run

Linux with a C++ compiler and OpenGL development headers:

```sh
deno task overlay:presenter:build
deno task server --webxr-decoupled-renderer --webxr-raylib-eye-size=512
```

Use the normal display/session environment and run a single full PetPlay server for actual
headset testing. The second line selects a small diagnostic eye size; remove that size option
to use the normal 3560 px default. The native library is a generated, ignored resource;
`PETPLAY_OVERLAY_PRESENTER_LIBRARY` can override its location. Missing library or ABI mismatch
fails startup. The experimental path currently requires raylib-only overlay mode.

`GET /health/actor?actor=webxr` on the agent REPL exposes `independentRenderer` and `viewDelivery`.
The renderer's full actor ID can be queried through the same endpoint. Counters distinguish
scene version, rendered frames, published frames, wait timeouts, and invalid tracking. The last
publication reports GPU completion, wait duration, setter duration, and partial failure.
`REPAIRWEBXR` restarts this child without restarting the scene worker. Automatic child recovery
is not implemented; the legacy presentation watchdog is disabled in this mode.

With an experimental instance already running, this diagnostic briefly freezes delivery and
rendering in turn and restores both:

```sh
deno run -A utils/check-overlay-render-independence.ts --port=3988
```

## Validation so far

- Fourteen focused Deno tests pass: skipped asset deltas, owned buffers/revisions, acknowledgement
  identity, full baselines/cache budget, measured stereo cameras, repeated tracked transforms,
  target-ray/grip calibration, world hit cursor opt-out, UI clipping planes, and tracked
  transforms after the actual process wire codec, compact packet ownership/typed arrays/stereo
  aliasing, receiver-side coalescing before GPU adoption, two-credit/out-of-order receipts,
  and invalidation of world-baked text batches after in-place tracking changes.
- Native CPU contract tests pass for timeout/no publication, partial setter failure, successful
  call order, and missing GL context. Build/run with
  `c++ -std=c++17 -O2 native/overlayPresenter/presenter_test.cpp -o /tmp/petplay-presenter-native-test`,
  then `/tmp/petplay-presenter-native-test`. These mock GL/OpenVR, not GPU ownership.
- A live diagnostic server on port 3988 used 512 px eye targets. At one sampled point it had
  published 14,626 frames without a reported wait timeout or setter error.
- Over 1.2 seconds with scene delivery frozen, the same scene rendered/published 93 further
  frames while simulation advanced 87 frames. With rendering frozen for another 1.2 seconds,
  render count stayed fixed while simulation advanced 87 frames. Both resumed afterward.
- Restarting the renderer changed its actor/process, adopted the asset baseline, and published
  108 frames by the next sample; simulation advanced 229 frames across that check.
- `deno check --allow-import petplay/overlayRenderOwner.ts petplay/webxr.ts` remains blocked by
  188 diagnostics elsewhere in the imported dependency graph. The reported diagnostics do not
  point to the files changed for this renderer.

The diagnostic instance ran alongside the existing server, which caused the duplicate HMD
pose WebSocket listener to fail. Its scene was minimal (two cached assets and no resolved
tracked anchors), so these results establish execution and publication mechanics, not a full
PetPlay scene, controller alignment, headset appearance, or representative GPU workload.
No VRChat workload result from the earlier RE experiments should be attributed to this renderer.

The first single-server run at normal resolution exposed a tracked-object crash:
`worldMatrix.set is not a function`. The process transport JSON-encodes typed arrays into
numeric-keyed objects. The tracked resolver now writes matrix elements by index, matching both
representations; the new regression test includes geometry, normals, panel clipping, and repeated
resolution after the actual wire codec. The renderer was restarted in place and resumed
publication. Headset/controller behavior is still awaiting validation.

The user then reported displaced world/UI position or depth. Switching only the projection
matrices from direct OpenVR device projections back to the existing symmetric scene calibration
restored normal placement, with independent tracking/rendering/native publication left active.
`scene-compatible` is therefore the default projection mode; `SETRENDERERDEBUG` can select
`projectionMode: "headset"` for further controlled investigation. This isolates the problem to
the projection path, but does not yet establish which conversion is wrong. The existing
`docs/PROJECTION_OVERLAYS.md` explicitly marks asymmetric vertical tangent signs as unverified.
The installed runtime's left-eye device projection has offsets `m[8]=-0.22284633` and
`m[9]=-0.16368149`; the original scene projection has zero offsets. Also, the device matrix uses
a zero-to-one depth range, whereas raylib uses GL depth conventions. Audit both independently
before enabling the device-projection path by default; do not infer that depth range alone
explains the spatial displacement. Controller/grab validation and VRChat load tests remain.

After spatial calibration was restored, the user reported smooth head motion but roughly 10 fps
hands and animations. A four-second sample measured simulation at 70.4 fps, rendering at 68.6 fps,
and only 18.9 delivered scenes/sec. Compact packets plus earlier credit initially raised delivery
to 29.1/sec; receiver-owned asset retention/receipt credit and immediate publication on returned
credit raised it to 44.6/sec. With two bounded transport credits, a further five-second sample
measured simulation at 62.3 fps, rendering at 65.7 fps, and scene delivery at 57.1/sec. These are
sequential live samples, not identical-workload benchmarks or a guaranteed rate.

The wrist menu's direct grip-space attachment also lacked a render anchor. It and both ray
roots now use explicit child groups carrying the marker; imperative markers on `XRSpace` itself
could be replaced when React reapplied that component's `userData`. Live extraction now resolves
38–40 tracked UI/beam elements per rendered frame. The user reports much smoother behavior and
smooth keyboard animation, but remaining hand jitter. During a frozen-scene/live-render-tracking
control the user reported a smooth panel with odd text behavior, then clarified the remaining
jitter might be text only. A source reload interrupted the end of that control, so it is
directional headset feedback rather than a clean quantitative capture.

This exposed a concrete text-cache bug: batched MSDF vertices are baked into world space, but
the cache reused them based solely on text object identity. Fresh render tracking changes those
objects' world matrices in place. Panels updated while cached text remained at the previous baked
position until a new scene arrived. Batch reuse now also compares an owned snapshot of the world
matrices. Changed tracking rebuilds the batch; the second eye may reuse it with the same transforms.
A regression test covers in-place mutation, independent cached ownership, and second-eye reuse.
The renderer has restarted with this fix; headset confirmation remains pending.

After subsequent live reloads the user reported laser occlusion and occasional off-target
keyboard activation (including Caps/Enter). A full PetPlay process restart cleared the keyboard
symptom according to the user; it did not clear laser occlusion. The old process took longer than
the reboot helper's 20-second launcher deadline to finish shutdown, so lifecycle teardown remains
an open gate. No keyboard input-routing change was made without a reproducible failing case.
The aim beam and hit cursor materials still enabled depth testing despite the HUD draw pass;
they now disable it so screen geometry cannot depth-occlude aim feedback within the projection.
Live scene inspection confirms those material flags. Headset confirmation of that visibility fix
is pending; this does not establish compositor ordering between separate overlay layers.

## Remaining gates

1. Run the full application as the only server, verify head/world/hand alignment and grab/hit
   behavior, then repeat under VRChat's home-world workload. Measure long simulation frames
   without confusing them with render stalls or publication mismatches.
2. Test non-identity world/standing mappings, recenter/origin changes, IPD/projection changes,
   tracking loss, asset deletion/overflow, process death, and runtime restart. The prototype
   assumes a stable standing-space mapping and reads eye calibration at startup.
3. Measure rendering and publication at normal resolution, including GPU saturation. Reduce
   allocation and serialization costs from evidence; no CPU/GPU time is reserved by this split.
4. Integrate and validate stronger image ownership before claiming immutable generations.

The current transport is ordinary OpenGL. `glFinish` completes producer rendering, but does
not wait for vrclient's later internal Vulkan copy. Cycling local targets does not establish
immutable compositor backing images. The DMA-BUF reference-handoff work remains a separate
integration gate. Public setters also provide no atomic pose/texture/stereo transaction and
no proven late-publication rejection. A small native call reduces scheduling opportunities;
it does not create those guarantees.

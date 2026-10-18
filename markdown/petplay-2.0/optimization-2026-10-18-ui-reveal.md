# First display reveal: evidence and property-order experiment

Status: property-order cache rejected (inconclusive); static UI texture preload accepted.
First reveal remains a ~125 ms release hitch: still an open defect.

## Reproduction and attribution

The native OpenVR route opens Settings and its four subpages, reveals the display layer,
then drags and scales a display. Three reveal cycles distinguish first use from warm repeats.
Scene queries locate targets and assert outcomes; controller actions go through the synthetic
driver. Presented pixels/freshness have not yet been verified by this route.

A phase-triggered two-second scheduler/GPU trace is allocated before input and starts at
`show-display`. This avoids allocating trace buffers during the event. The observer records
the scene worker's native TID, raw metric samples and optional isolate CPU profile. V8 profiling
itself creates startup/stop stalls; those must be identified separately from the reveal phase.
The comparison runs below omit CPU profiling and GPU tracing.

Diagnostic reproduction:

| Variant/workload | First reveal frame wall time | Traced worker on CPU | Runnable but off CPU | Sleeping |
| --- | ---: | ---: | ---: | ---: |
| Compiled debug, isolated from VRChat | 166.234 ms | 165.363 ms | 0.555 ms | 0.316 ms |
| Compiled production, VRChat home world | 163.388 ms | 159.972 ms | 3.261 ms | 0.155 ms |

The production profile attributes approximately 55.5 ms inclusively to UIKit `resetProperties`,
34.4 ms to the host frame advance and 26.3 ms to first-use image decode/upload. These categories
overlap in the call tree and must not be summed as independent costs. The trace establishes
that the worker is mostly executing during this wall-time event; it does not establish GPU
completion or presented-pixel freshness. Both trigger traces reported zero lost events and
restored the original top-level tracing controls.

Artifacts: `_scratch/perf/debug-reveal-isolated*`, `_scratch/perf/release-reveal*` and their
`*-analysis.json` files. The isolated run had the monitor's room-setup app present; it is not
a VRChat acceptance workload. The production run explicitly verified VRChat's synthetic VR mode.

## Candidate: reuse property-layer precedence order

UIKit's property implementation repeatedly creates and numerically sorts the same layer-key
array while resolving individual properties and reactive fallbacks. Cache the order per
property object, invalidating it at every layer-key insertion/removal. Property values,
precedence, reactive signals, enabled behavior and timing of property application stay under
the existing algorithms. This targets one part of the measured reset path; it does not claim
that sorting alone accounts for the full 55.5 ms.

The change is in the nested UIKit submodule's `packages/pub-sub/src/index.ts`.
`classes/uikitPropertyLayers.test.ts` exercises insertion, replacement, removal, peeks,
reactive fallback, overrides and disable/re-enable behavior. The assertions pass against both
the saved original and candidate implementations.

An isolated 32-property layer-reset screening experiment reduced sort calls for ten cycles
from 672 to 21. All five alternating timing pairs were faster, with equal checksums. That is
code-level screening only. A first fully instrumented live candidate run was worse overall
(181.364 ms first reveal versus 163.388 ms in the diagnostic baseline); it is not an improvement
claim. This result triggered the controlled paired experiment rather than acceptance.

Candidate production executable SHA-256:
`c3d420d2b46bc26b342d9751f1ff73da89712b14dae822f2b8cd9e091032f54b`.
Original production executable SHA-256:
`3fff98b7a33f0402ddce4e0f960ac8d655fab2889d3f202ddae8c3f3b2f1bc6f`.
Build, test, source-state snapshots and raw results are under `_scratch/perf/uikit-layer-cache/`.

## Paired screening and remaining gates

The paired runner alternates order over five pairs, starting a fresh compiled application for
each run while keeping the same live SteamVR runtime and VRChat PID. Each run performs three
reveals and the asserted native route, raw frame-cost observation and compositor-history sampling.
CPU profiling/GPU tracing are absent. Runtime/game identity changes and incomplete compositor
observations fail the run. Failed attempts remain in the record. Per-run evidence lives under
`_scratch/perf/uikit-layer-cache/paired/`; `runs.json` records completed runs and failures.

This remains a light home-world screening workload. Acceptance still requires reproducible
release tail improvement beyond variation, debug candidate validation, broader keyboard/settings/
layout/camera interactions, presented-output/freshness checks, heavy-load and resource checks,
matched WayVR comparison where applicable and lifecycle/soak evidence. Any unresolved regression
blocks publication. No commit or push is authorized merely by a faster isolated lookup test.

## Steam UI launch hold encountered during testing

Claude's historical launch command and the current lab both use `steam.sh -applaunch 438100`.
One launch stalled at Steam's `ShowInterstitials` phase, but no visible user dialog was found.
Steam's helper log repeatedly reported an invalid browser and its JS launch callbacks stopped.
Restarting only the existing Steam UI browser process with SIGTERM allowed Steam to respawn it;
the main Steam PID was retained. The pending ordinary launch then completed and VRChat entered
the synthetic VR session. This was a Steam UI recovery, not a different VRChat launch method.
Evidence is under `_scratch/perf/steam-ui-launch-hold/`. The original timed-out attempt remains
a failed startup attempt; later success does not erase it.

## Property-order cache: rejected as inconclusive

The five completed pairs (`_scratch/perf/uikit-layer-cache/paired/`, analyzed by
`_scratch/perf/analyze-paired.py`) gave first-reveal worst-frame differences of
-13.7, -9.0, +18.7, -7.7 and -4.6 ms on a ~155 ms event. Warm reveals did not improve
(third reveal +4.2 ms median). That is within run-to-run variation, so the UIKit change was
reverted; its patch remains at `source-submodules_threewebxrwebgpudeno_submodules_uikit.patch`.
Sorting is not a meaningful share of the reveal.

## Accepted: preload static UI textures

Inclusive time in the production first-reveal profile (`release-reveal.cpuprofile`, ~163 ms,
overlapping categories): React passive-effect commit 71 ms (UIKit `resetProperties` 55.5 ms),
r3f frame advance 34 ms (first UIKit/yoga layout 31 ms), backplate image decode/upload 27 ms
and GC 13 ms. The image is `resources/PetPlay.png`, the display's rear-face logo: 2084×2084,
decoded and uploaded synchronously inside the frame the first time any display is drawn.

Hypothesis: decoding the static `UI_TEXTURE_PATHS` registry in the renderer constructor moves
that work to compositor initialization without changing any drawn output. Both textures now
load before `raylib compositor ready`. The wallpaper was already loaded on the first frame
(the wrist clock), so startup gains only the logo's decode/upload.

Release, beyond75, VRChat in VR (home world), fresh compiled PetPlay per run, five alternating
pairs, same vrserver/vrcompositor/VRChat PIDs throughout, no profiling or tracing:

| Metric | Baseline median | Candidate median | Pair differences (ms) |
| --- | ---: | ---: | --- |
| First reveal worst `frameMetric` | 144.68 | 126.26 | -23.3, -39.1, -18.4, -9.4, -38.7 |
| Longest host rAF interval | 113.05 | 83.06 | -36.3, -30.5, -35.1, -16.5, -35.4 |
| Second/third reveal worst frame | 25.37 / 24.30 | 23.61 / 20.19 | within noise |
| Menus, drag, two-hand scale, run p99 | | | within noise |

The compositor reported zero dropped, mispresented or reprojected frames in all runs (as in
the baseline, so these counters do not clear the hitch). Executables:
release baseline `f90353c9…`, candidate `2f372c5d…`; full hashes, builds, patch and raw runs
under `_scratch/perf/ui-texture-preload/`. Reproduce with
`deno run -A --no-check _scratch/perf/paired-screen.ts --out=<dir> --baseline=<exe>
--candidate=<exe> --pairs=5` against a running `vrlab up --display-profile=beyond75` session,
then `python3 _scratch/perf/analyze-paired.py <dir>`. Those scripts and the vrlab route are
local, uncommitted harness work.

Gates run: `deno task check`; `deno test -A --no-check classes utils` (234 passed); compiled
smoke in development and production modes; the native route (Settings and four subpages,
three reveals, laser drag, two-hand scale) passed in every release run and in the debug
pairs below. Not covered: presented-pixel verification, keyboard/layout/camera interactions,
heavy-world load, WayVR comparison and soak. Startup time was not measured; the added
startup work is one PNG decode/upload during compositor initialization.

Debug (development) builds, three alternating pairs in the same session: first reveal worst
frame -38.9, -37.9, -42.5 ms (median 179.06 → 141.12), longest rAF interval -15.8, -13.9,
-18.2 ms. Second reveal read +6.6, +0.3, +6.3 ms; both variants take the identical cached
texture path after the first draw and release showed -0.3 to -4.1 ms, so this is recorded as
unexplained debug variation, not dismissed. Debug executables `89290c64…` / `35656279…`.

The remaining ~125 ms first reveal is still a blocking defect. Next candidate: construct UIKit
components with their first render's props so the hidden `Activity` pre-render applies them,
instead of every component restyling in the reveal commit.

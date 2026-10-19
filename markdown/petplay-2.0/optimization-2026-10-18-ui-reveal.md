# First display reveal: evidence and property-order experiment

Status: property-order cache rejected (inconclusive); static UI texture preload and
construct-with-props, render-time text measurement, hidden layout prewarm, the keycap
restyle skip, keycap border width and hidden panel mesh prewarm and memoized window content accepted.
First reveal is now a ~25 ms release frame (~12 ms over budget). Work moves to general use.

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

## Accepted: build hidden window UI with its props at construction

The window layer is a hidden `React.Activity`; its UIKit components are constructed during the
hidden pre-render, but `uikit-r3f` applied props only from a passive effect, which a hidden
Activity does not run. The first reveal therefore ran `resetProperties` on every component in
one commit (55.5 ms in the profile). The constructor already applies `inputProperties`, so the
wrapper now passes the first render's props there and treats them as applied, under
`ConstructWithPropsContext`, which `WindowLayer` sets while hidden.

Two rejected variants are kept as evidence (`_scratch/perf/uikit-construct-props/`):

- v1, unconditional (every component constructed with props): first reveal 119.8 → 71.9 ms,
  but `menu-wrist` worst frame +0.3 to +1.3 ms in all five pairs and 20–21 ms frames in 3/5
  runs (0/5 baseline). Visible mounts moved that work from the passive effect into the commit.
- v2, context value `!visible`: warm reveals +4 to +13 ms in all five pairs, because changing
  the context value re-rendered every UIKit component on each show and hide.

Accepted v3 holds a stable ref in the context, read once at construction. Baseline is the
texture-preload release (`2f372c5d…`); candidate `a1327df6…`. Release, five alternating pairs:

| Metric | Baseline median | Candidate median | Pair differences (ms) |
| --- | ---: | ---: | --- |
| First reveal worst `frameMetric` | 128.04 | 72.61 | -61.1, -53.0, -54.6, -44.7, -58.7 |
| Longest host rAF interval | 81.11 | 66.94 | -17.1, -10.3, -16.5, -10.7, -21.8 |
| Second reveal worst frame | 24.07 | 27.15 | +1.5, +1.4, -1.8, +4.8, +6.3 |
| Third reveal worst frame | 22.68 | 23.77 | +0.6, -3.9, -2.3, -0.1, +2.6 |

Summed rAF time beyond 13.33 ms over the five runs: first reveal 819 → 509 ms, second and
third reveals together 104 → 106 ms. Menus, drag and scale were within noise. One 20+ ms
frame each in `menu-wrist` and `menu-screens` (0 in baseline) is unattributed: that UI is
outside the context and runs the baseline path apart from a `useContext` read.

Debug, three pairs (a first attempt was cut short when the lab's 3600 s window ended; its
completed pair agreed): first reveal 140.95 → 78.28 ms (-57.6, -70.2, -61.3), rAF maximum
-22.1, -30.2, -21.0 ms, other phases within noise.

**Explicit tradeoff: startup.** The restyle work now happens during the hidden pre-render at
launch. A 20-second window from worker start, three pairs: time to ready unchanged
(~2.61 s), but rAF time beyond 13.33 ms +49, +34, +4 ms and the worst startup frame
+48, +14, +25 ms on top of a pre-existing ~180–200 ms startup stall present in both builds.
That cost moves from the first window interaction to launch; the launch stall itself is the
next target.

Visual check: headset readbacks of wrist home, revealed display backplates and Settings
showed no layout differences (overlay crop RMSE 0.8–1.9%, consistent with the animated world
and clock). Gates: `deno task check`; unit suite 234 passed; compiled smoke both modes; the
native route in every release and debug run; `--novr` playtests smoke, showhide, layouts,
hovertoolbar, window-settings, wrist and keyboard passed. Same limits as above: no heavy
world, WayVR comparison, camera interaction or soak.

The remaining ~73 ms first reveal is the first-layout cost (UIKit/yoga `calculateLayout`,
31 ms in the original profile) plus GC; it is still a blocking defect.

## Noise floor: A/A run

Four pairs of the identical v3 executable in both slots (`_scratch/perf/aa-noise/`):
first-reveal excess rAF time 484 vs 432 ms, `menu-wrist` 41 vs 29 ms with 3 vs 0 frames over
20 ms, `menu-layouts` 1 vs 0. Single-frame differences of one or two events per five runs in
the menu phases are inside this floor; the per-pair first-reveal differences claimed here are not.
Excess = summed rAF interval beyond 13.33 ms within a route phase (`_scratch/perf/excess.py`).

## Accepted: measure hidden window text during render

After construct-with-props, a cold-reveal profile showed `Text` and `MsdfText` (threewebxr
`webgpu-uikit.tsx`, `msdf-text.tsx`) loading fonts and measuring in effects. Inside the hidden
Activity that never ran, so hidden windows were laid out with an estimated label size; the reveal
then loaded, measured, re-rendered, built every text geometry and laid out again. Now loaded fonts
are kept in a synchronous cache, `Text`/`MsdfText` built under `ConstructWithPropsContext` measure
and build during render, and `WindowLayer` builds its windows once the fonts have loaded
(milliseconds after launch). Visible mounts keep the effect path: an unscoped first version
moved wrist-page text work into the mount frame (`menu-layouts` 0 → 5 frames over 20 ms).

Release, five pairs against v3 (`_scratch/perf/msdf-sync/scoped/`): first-reveal excess
503 → 295 ms, every pair better (100→53, 95→63, 101→55, 106→57, 101→67); longest rAF interval
-20.7, -7.9, -17.8, -20.9, -13.0 ms. Worst single first-reveal frame was unchanged within noise:
the gain is fewer and shorter follow-up frames. Menus, drag and scale within the A/A floor.
Debug, three pairs (`final/paired-debug`): first-reveal excess 598 → 400 ms (196→120, 194→151,
207→130), rAF maximum -45.7, -33.5, -36.5 ms. Executables: release `94664b47…`, debug
`604a7d61…`. Unit suite 234 passed; `--novr` smoke, showhide, layouts, hovertoolbar,
window-settings, wrist, keyboard (including legends-fit) and toasts passed.

Two debug attempts are retained as failed runs: one ended when the Steam client shut down at
22:19:23 (`Steam SHUTDOWN.` in vrserver.txt, followed by VRChat exit and the known compositor
SIGSEGV; no PetPlay event preceded it), and one where the v3 *baseline* reported `No wrist menu`
3 s after scene-ready. The latter is unexplained and unresolved.

## Accepted: lay out hidden UIKit roots before the first show

A hidden Activity runs no frame jobs, so the first visible frame laid out every window: 31 ms of
`calculateLayout` remained, mostly the default layout's keyboard (593 of the window layer's
650 UIKit components). `WindowLayer` now calls `update(0)` on hidden roots that have never been
laid out, one per frame, shortly after launch. Roots that already have a size are never touched,
so after the first show the visible frame jobs own layout exactly as before.

First attempt (v1, `_scratch/perf/layout-prewarm/`) was a no-op: its ref sat on a group inside
the hidden Activity, and React detaches refs there, so it never ran before the first reveal. Its
screening (no gain) therefore measured nothing. One of its five runs froze for **2,966 ms**
~0.36 s after `hide-display-3`. A plausible path exists (a frame where the hook saw "hidden"
before React detached the ref could queue roots at one hide and lay one out at the next), but a
hunt of 24 extra hide/show cycles on each of the v1 and text-sync builds
(`_scratch/perf/freeze-hunt/`, worst interval 49 ms) did not reproduce it. **Unresolved and
unattributed.** v2 keeps the ref on the wrapper outside the Activity and cannot take that path.

v2 against text-sync (`_scratch/perf/layout-prewarm/v2/`), release, five pairs:

| Metric | Baseline median | Candidate median | Pair differences |
| --- | ---: | ---: | --- |
| First reveal worst `frameMetric` (ms) | 74.15 | 54.37 | -13.0, -16.1, -21.0, -20.0, -21.6 |
| First reveal excess (ms) | | | 66→54, 64→36, 64→40, 62→34, 51→34 |
| Longest host rAF interval (ms) | 55.71 | 34.04 | -12.6, -23.3, -21.7, -20.7, -22.5 |

Other phases within the A/A floor; `laser-drag` worst frame read +0.4 to +2.8 ms in release but
-0.5, +0.6, -0.1 in debug and the hook returns immediately while windows are visible. Debug,
three pairs: first reveal worst frame -16.6, -4.3, -20.9 ms; excess 129→119, 127→132, 110→84,
a weaker gain. Executables: release `946401a2…`, debug in `artifacts.sha256`. Unit suite 234
passed; `--novr` smoke, showhide, layouts, hovertoolbar, window-settings, wrist, keyboard and
toasts passed. Startup gains one layout per root in the first second (accepted tradeoff: the user
prefers launch cost to interaction stalls).

## Accepted: skip keycap restyles that change nothing on show

Showing the window layer re-runs every keycap's visual effect (React re-runs effects when an
Activity becomes visible), and each of the 74 caps called `setProperties` with the colours it
already held. `setProperties` merges into `inputProperties` and resets the whole property stack even
when nothing changed. `applyCurrentVisual` now compares against `inputProperties` and skips the call
when every value is identical. Presses still go through `setProperties` directly.

Release, four pairs of eight hide/show cycles each (`_scratch/perf/keycap-skip/hunt/`):

| Metric                                            | Baseline | Candidate | Pair differences          |
| ------------------------------------------------- | -------: | --------: | ------------------------- |
| `show-display-2` worst `frameMetric` (median, ms) |    18.50 |     15.89 | -3.5, -2.3, -4.1, -0.6    |
| `show-display-3` worst `frameMetric` (median, ms) |    19.65 |     16.88 | -1.9, -2.2, -1.4, -4.2    |
| Warm reveals 2–8, summed excess (ms)              |      162 |        81 | lower in all seven phases |

First reveal, menus, drag and scale were within the A/A floor. Debug, two pairs (`hunt-debug/`):
`show-display-2` -10.7, -5.2 ms; `show-display-3` -6.3, -7.3 ms; menus within noise. Debug warm
reveals still have about six frames over 20 ms each. Executables: release `946401a2…` → `5acdf072…`;
debug `be1888c4…` → `44d5369b…`. Unit suite 234 passed; compiled smoke (both modes), showhide,
layouts, hovertoolbar, window-settings, wrist, keyboard and toasts passed. hovertoolbar and wrist
first failed on HEAD and on the candidate alike, because `kscreen-doctor` aborts without
`WAYLAND_DISPLAY`. They passed once it was set.

## Accepted: build keycaps with the border width they keep

A probe that hooks `resetProperties` and `calculateLayout` during a fresh first reveal
(`_scratch/perf/reset-probe.ts`) found 82 restyles. 79 were keycaps: the chrome built them with
border width 0 or 3, and the interaction layer's first effect, which only runs on reveal, set 1, 2
or 5. Border width is a flex property, so this also re-laid out the keyboard (8.7 ms in one
`calculateLayout`). The interactive cap now passes its base border width to the chrome. The other
three were the wrist menu shells, whose pointer filter was a new function on every render. The
menu re-renders every second for its clock, so those three also restyled once a second while idle.
The filter is now memoized. After both changes the probe counts no restyles and no layouts on the
first reveal or in five seconds of visible idle.

Release, five pairs (`_scratch/perf/keycap-border/paired/`):

| Metric | Baseline | Candidate | Pair differences |
| --- | ---: | ---: | --- |
| First reveal worst `frameMetric` (median, ms) | 47.71 | 30.00 | -17.3, -15.6, -21.5, -17.7, -13.0 |
| First reveal excess (ms) | | | 26→12, 29→19, 37→16, 33→16, 22→16 |
| First reveal frames over 20 ms (total) | 10 | 4 | |

Other phases were within the A/A floor. Debug, three pairs (`paired-debug/`): first reveal -25.1,
-17.0, -12.6 ms. `show-display-2` read +1.8, +5.3, +15.7 ms, so two more pairs of eight
reveals were run (`hunt-debug/`). There, warm reveals came out equal or better (summed excess
796 → 777 ms; `show-display-2` -9.0, -1.0 ms) and the first reveal -11.5, -14.7 ms.
Executables: release `5acdf072…` → `67bcf92c…`, debug `44d5369b…` → `351dcdd5…`. Unit suite
234 passed; compiled smoke (both modes), showhide, layouts, hovertoolbar, window-settings, wrist,
keyboard and toasts passed.

## Accepted: build hidden windows' panel meshes before the first show

After the border fix, a first-reveal profile still spent ~7 ms in `InstancedPanelGroup.update`:
instance buffer allocation, mesh and material creation and element activation. Laying out a
hidden root makes its panels visible to UIKit, which only depends on layout and `visibility`,
not on the three.js `visible` flag. The panels insert themselves and ask their group to update
on the root's next frame. A hidden root has no frame jobs, and the layout prewarm updated each
root once, so that next frame was the first show. The prewarm now gives each root one more
`update(0)` a frame after its layout. The probe counted 7 panel-group resizes on the first
reveal before and 0 after.

Release, five pairs (`_scratch/perf/panel-flush/paired/`): first reveal worst `frameMetric`
median 30.36 → 26.80 ms (-9.1, -0.8, -6.0, -8.8, +0.1). First-reveal excess fell in every pair
(17→6, 17→14, 14→8, 21→10, 13→6), and frames over 20 ms fell from 6 to 1. Open-settings read
3 → 5 frames over 20 ms. It runs while the layer is still hidden, but debug showed 3 vs 3 there.
Debug, three pairs (`paired-debug/`): first reveal -11.5, -5.2, -3.9 ms. Other phases were
within the A/A floor and the debug warm-reveal noise. An earlier debug attempt
(`paired-debug-expired/`) ended when the lab's one-hour limit expired mid-run.
Executables (release baseline, candidate, debug baseline, candidate): 67bcf92c 69187bbf 351dcdd5 e8bbec56 . Unit suite 234
passed; compiled smoke (both modes), showhide, layouts, hovertoolbar, window-settings, wrist,
keyboard and toasts passed.

## Accepted: stop re-rendering every window on show

Every show and hide re-rendered `WindowLayer`, which rebuilt the element tree inside its
Activity, so all ~650 UIKit components rendered again on top of the effect re-run that revealing
requires. Each show also reloaded the KDE workspace outputs and stored a new, equal array. That
cloned the graph through `reconcileWorkspaceOutputs` and re-rendered everything again, and it
synchronously saved the layout ~0.1 s after the show. The Activity's contents are now a memoized
`WindowLayerContent`, and an equal outputs list keeps its identity. React work across three
profiled reveal phases fell from 108 to 70 ms (`_scratch/perf/memo-content/profile/`).

Release, five pairs (`paired/`): first reveal worst frame -5.6, -2.5, -1.4, -3.7, -3.3 ms
(median 27.6 → 24.8). First-reveal excess fell from 82 to 28 ms, lower in every pair.
`show-display-2` -1.4, -3.7, -1.0, -5.1, -6.8 ms (median 21.7 → 16.6). `show-display-3` was
mixed (-8.1 to +7.2). Menus, drag and scale were within the A/A floor. Debug, two pairs
(`paired-debug/`): first-reveal excess 89 → 18 and 84 → 14 ms; every reveal better by 1.8 to
14.9 ms. Executables (release baseline, candidate, debug baseline, candidate): 69187bbf 5d32247d e8bbec56 94006d8d . Unit suite
234 passed; compiled smoke (both modes), showhide, layouts, hovertoolbar, window-settings, wrist,
keyboard, toasts and lifecycle passed.

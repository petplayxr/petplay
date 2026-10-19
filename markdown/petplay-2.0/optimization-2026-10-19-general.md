# General use under the synthetic workload: survey and allocation work

Status: survey done; allocation fixes and UI snapshot reuse accepted. Idle GC pauses, now about
every 17 s instead of every 11 s, remain the main source of PetPlay frame-time tails in general
use. Follows the reveal work in `optimization-2026-10-18-ui-reveal.md`.

## Survey

`_scratch/perf/general-route.ts` drives the beyond75 lab with VRChat in its home world: 60 s of
visible idle with both rays parked, two hover sweeps across the keyboard's letter keys, ray
circles over the primary display, three wrist settings cycles, four layer hide/show cycles and
15 s more idle. It never presses trigger on the keyboard or a display, because their sinks drive
the real desktop. Hovering does move the real cursor.

Run 1 (`_scratch/perf/general/run1/`, release `686a115`, no profiler), 230 s:

| Phase | avg frame (ms) | p99 | max | > 20 ms |
| --- | ---: | ---: | ---: | ---: |
| visible idle (60 s) | 11.27 | 14.77 | 17.71 | 0 |
| display hover motion | 11.26 | 14.78 | 16.65 | 0 |
| wrist menu cycles | 10.93 | 14.77 | 16.53 | 0 |
| layer hide/show cycles | 11.29 | 14.60 | 18.07 | 0 |
| visible idle after | 11.28 | 14.55 | 15.31 | 0 |

The one frame over 20 ms (24 ms) came 6 s in, when the route closed the SteamVR dashboard.
VRChat resumes submitting at that moment: its client frame interval shows a 10 s gap there.
Over the whole run VRChat ran at 74.94 fps with 0 dropped and 0 reprojected frames, at 5.0 ms GPU
on average (7.8 ms p99).

Run 2 (`run2/`) repeated it with the CPU profiler and the keyboard sweep working. No step had a
frame over 20 ms. One 36 ms frame came during idle a minute after the route ended: 17 ms of it
was V8 garbage collection.

## Idle garbage collection

The webxr worker's old space climbs steadily from ~101 to ~113 MB, at ~1.1 MB/s, and a major GC
returns it to ~101 MB about every 11 s (`_scratch/perf/old-timeline.ts`). Each major arrives as
several 4–10 ms pause chunks over neighbouring frames, which is why idle p99 sits near 15 ms
against a 13.3 ms period. With windows visible the worker allocated ~53 MB/s
(`alloc-sample.ts`). The garbage is spread across per-frame snapshot code: UI panel, text and
anchor snapshots, the renderer's per-eye draw lists, pointer intersection and the vsync spin.
Promotion follows allocation rather than one leak (`promo-sample.ts`). External memory is flat
at ~11 MB, so it doesn't trigger the majors.

## Accepted: remove three per-frame allocation sources

- `drawUiSnapshot` computed view depth inside its sort comparators, boxing a number per
  comparison, twice per frame. Depths are now computed once per element into reused buffers and
  reused for root ordering. The comparator and the stable sort are unchanged, so draw order is
  identical.
- raythree's extraction allocated a `find` closure per visible object per frame. It's now a
  loop (raythree submodule).
- The vsync spin read its frame index from a `BigUint64Array` on every poll, allocating a BigInt
  each time. It now compares the index's two 32-bit words.

Two alternating rounds, 10 s of visible idle each (`_scratch/perf/alloc1/`): allocation
53.1/53.3 → 43.2/44.1 MB/s, scavenges 62/61 → 51/52 per 30 s. Major GCs stayed at about one per
11 s, so this change saves CPU but doesn't move the idle frame tail. Executables in
`artifacts.sha256`. Unit suite 234 passed; compiled smoke, showhide, layouts, hovertoolbar,
window-settings, wrist, keyboard, toasts and smoke passed.

## Accepted: reuse unchanged UI snapshots between frames

Every frame rebuilt each UI panel's snapshot: three `Float32Array(16)` copies, an object, a render
anchor with its own `Float64Array`, and a subarray view. Text did the same. Most UI is static
between frames. Panels are now cached per (mesh, instance) together with the inputs they were
built from (object and instance matrices, data, clipping and the scalar fields), and text is
cached per object. An unchanged item pushes last frame's snapshot. Anchors are still resolved
every frame, because tracking can change under an unchanged world matrix (attach to a hand, a
grab starting). They're computed into scratch memory, and the previous anchor object is reused
when space, flags and matrix all match. Snapshots stay immutable after they're pushed: a changed
item gets a new object, so the same object still means the same content to every consumer. In
the worker, the renderer only reads snapshots, and views receive copies (structured clone or
the compact wire encoder; PostMan uses no transfer lists). The render child resolves anchors on
its own copy.

`_scratch/perf/snapshot-reuse/`, two alternating rounds against `7dbc216`:

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Allocation at visible idle (MB/s) | 44.2, 43.9 | 33.5, 34.2 |
| Old-space growth (MB/s, approx.) | ~1.1 | ~0.65 |
| Interval between major GCs (s) | ~11–12 | ~17 |
| 90 s idle: frames over 15 ms | 62, 150 | 29, 60 |
| 90 s idle: p99 frame (ms) | 14.93, 15.58 | 14.30, 14.87 |
| 90 s idle: frames over 20 ms | 0, 1 | 1, 0 |

Promotion in sampler terms fell from 2.88 to 1.33 MB/s. What's left is spread thinly across
React renders, timers and pose math. Headset captures of the wrist menu, the shown display and
Settings (`visual/`) show the same UI. In the first capture the baseline's VRChat background
had not rendered yet. Unit suite 234 passed; overlay/UI tests 51 passed; compiled smoke,
showhide, layouts, hovertoolbar, window-settings, wrist, keyboard, toasts, smoke, lifecycle,
grablatency, grabdrops and camera passed.

## Open

- Major GCs remain about every 17 s, each still several 4–10 ms chunks. Shorter pauses need a
  smaller live heap (~100 MB), which isn't attributed yet. The remaining promotion has no single
  large source.

## Rejected: V8 heap flags

The webxr worker runs inside PetPlay's main child process (the `dev` process) with the other
in-process workers, so V8 flags apply to all of them. `DENO_V8_FLAGS` reaches that process
(confirmed from the webxr REPL), which allowed flag-only A/B runs of the same binary through
wrapper scripts (`_scratch/perf/semi-space/`). Old-space timelines over 100–150 s:

| Flag | Result |
| --- | --- |
| `--max-semi-space-size=128` | new space grew to 64 MB, then V8 shrank it back to 52.5 MB; majors unchanged |
| `--no-memory-reducer` | majors unchanged |
| `--heap-growing-percent=50` | majors unchanged |
| `--external-memory-max-growing-factor=4` | majors unchanged; external memory stays ~10.5–11 MB |
| `--no-scavenger-updates-allocation-limit` | majors unchanged |

Every run shows the same shape: one first cycle up to ~175 MB about 75 s after launch, then
majors after only 6–15 MB of growth above the ~101 MB live heap. `--min-semi-space-size` would
pin a larger young generation, but it applies to every isolate in the process. The GC reason
couldn't be read: `--trace-gc` output from the child doesn't reach any log, and Deno emits no
`gc` performance entries. No flag is shipped.

Not pursued: the keyboard holds 608 of the 687 UIKit components. About 200 of those are gap
spacers between keys and rows, and each UIKit component carries ~180 reactive-graph objects
(signals, links, effects, layer entries, abort listeners), which dominate the heap's object
count. The spacers deliberately own the gaps, so a ray between keys types the next key or the
key below (`row-gap-types-key-below`). Folding them into the keys' hit targets would change that
behavior, for an estimated ~8% shorter marking.

## Accepted: quits no longer end in an uncaught error

Evidence in `_scratch/perf/shutdown/`. Every quit of the release build (SIGTERM, 5 of 5 runs
against `63a00cb`, lab without VRChat) logged `InvalidStateError: Worker has been terminated` and
exited with code 1 about 0.2 s after the signal. Shutdown terminates the display overlay host's
process worker before it shuts down webxr. A relay still in flight to that host reached
stageforge's `WebSocketWorker.postMessage`, which throws after `terminate()` where a real
`Worker` drops the message. The throw escaped `PostalService.OnMessage`, so webxr's native
cleanup, `wrist_menu` and `main` never ran, and the process left through libc `exit()` with
webxr's loops still live.

That is the shape of most of the PetPlay core dumps from 2026-10-18 and 2026-10-19
(`coredumpctl`): the main thread in `op_exit` → `exit()`, running `vrclient.so`'s exit
handlers, while `worker-7` faults inside an FFI call into `vrclient.so` (+0x1f8a23, +0x1f896a,
+0x3f2e22). One extra baseline quit during this work did the same (pid 278352).

stageforge `037eabf` drops messages to a terminated `WebSocketWorker`, with a test that fails
without it. Candidate: 5 of 5 release quits and 4 of 4 debug quits completed every actor's
shutdown and exited with code 0, 3.3–4.4 s after the signal (the existing 3 s
`EXIT_STABILIZE_MS` included). Baseline child processes (overlay host, screen streamer,
playerctl, busctl) were still alive 3 s after the parent exited, and gone 15 s later.

Ten quits per arm can't measure the segfault rate: there was 1 core in 6 baseline quits and none
in 9 candidate quits. Two exit-time crash shapes remain possible and are not addressed: the
overlay host child calls `Deno.exit` right after terminating its actor worker
(`WebSocketWorkerHost.ts`), and its cores show a thread jumping into unmapped code or aborting
under libXext's exit handler while `exit()` runs.

Unit suite 234 passed; stageforge tests 11 passed; compiled smoke passed in both modes; lifecycle,
smoke, showhide, layouts, window-settings, wrist, keyboard, toasts, grablatency, grabdrops and
camera passed. hovertoolbar could not run: it needs two host outputs and only one was enabled.

## Soak, 2026-10-19

`_scratch/perf/soak/run1/`: release `63a00cb` with VRChat at beyond75, the general route
(30 s idle) repeated every 2.5 min under frame and compositor observation. Eight full cycles
(20 min) before the lab's 3600 s window closed: every route step passed, VRChat had 0 dropped and
0 reprojected frames, PetPlay p99 15.4–16.0 ms, steady-state max 19.3–42.2 ms. The 135.7 ms
frame in cycle 0 came 0.3 s into observation, right after launch and VRChat world entry. The old
space floor stayed at ~106–117 MB. Too short to speak to the long-session degradation issue.

## Accepted: stop reading stdin once it has ended

`startPetplayServer`'s stdin loop ran while `options.interactive`, and `asyncPrompt` returned
`""` both for an empty line and at end of input. With stdin closed (the lab, or a launch without
a terminal) it posted an empty `STDIN` message to `main` every 10 ms for the life of the process:
123,788 `[ACTOR] stdin:` log lines in 22 min of the soak. `asyncPrompt` now returns null at end
of input and the loop stops there.

`_scratch/perf/stdin-eof/`, release, two alternating pairs, 60 s each, no VRChat: stdin log
lines 90.1/s → 0, server main-thread CPU 0.58/0.65 % → 0.08/0.10 %, `main`'s worker 0.8 % → below
0.3 %, context switches 1156/1179 → 952/962 per second. A piped line still reaches `main` once,
the server keeps running after its stdin ends, and quits with code 0. Unit suite 234 passed;
compiled smoke passed in both modes; lifecycle, smoke, showhide, layouts, window-settings, wrist,
keyboard, toasts, grablatency, grabdrops and camera passed.

## Accepted: remove the hmd actor's unused 100 Hz pose loop

After the shutdown fix, quits of `174f92e` completed teardown but 2 of 20 still segfaulted in
`exit()` (`_scratch/perf/shutdown/head-quits/`). Both cores, like the earlier ones, fault on
`worker-7` inside `vrclient.so` from an FFI call. `worker-7` was the busiest worker after webxr's
render threads: 106 voluntary wakeups/s. `petplay/hmd.ts` started a `Deno.serve` on port 8887
and a loop that called `GetDeviceToAbsoluteTrackingPose` for all 64 devices every 10 ms, sending
the HMD pose only if a websocket client was connected. Nothing connects to it
(`docs/ARCHITECTURE.md` said so), and the actor has no `__SHUTDOWN__`, so the loop kept calling
into `vrclient.so` while `exit()` ran its handlers. The server and loop are removed; the actor
still answers `GETHMDPOSITION` (VRCOrigin) and `GETHMDDISPLAYFREQUENCY`.

`_scratch/perf/hmd-loop/`, release, alternating quits after 15 s of shown windows, lab without
VRChat: baseline 1 SIGSEGV in 15 quits (`worker-7`, `vrclient.so` again), `worker-7` 105–107
wakeups/s in every launch; candidate 0 in 25 quits, `worker-7` no longer among the busiest
workers. Across today's runs `174f92e` crashed in 3 of 35 quits. That split alone is not
significant (Fisher p ≈ 0.19); the evidence that this is the cause is that every core's faulting
thread is the loop's thread. It also frees the fixed port 8887. Unit suite 234 passed; compiled
smoke passed in both modes; lifecycle, smoke, showhide, layouts, window-settings, wrist,
keyboard, toasts, grablatency, grabdrops and camera passed. The opt-in `--vrc-origin` loop has
the same no-stop shape; it was not changed.

## Fixed: text that opens with glyphs the font lacks crashed the scene

A layouts playtest run never brought its scene up: webxr died on `TypeError: Cannot read
properties of undefined (reading 'id')` in the vendored `three-msdf-text-utils` `TextLayout`
(line 171), measuring toast text and laying out a text node. It was 1 of 414 playtest runs. The
word counter read `lastGlyph.id` when a space was the first glyph placed on a line. Word wrap
trims leading spaces, so that only happens when the characters before the space have no glyph in
the font: `"😀 hello"`, `"♪ Song"`, `"日本 語"` and `"Title\n🎉 Artist"` all threw. The wrist's
now-playing line, relayed desktop notifications and window titles reach the UI verbatim, and
webxr is not a recoverable worker, so such a string could end the session. threewebxrwebgpudeno
`d26ebd2` guards the read; `classes/environment/ui/msdfText.test.ts` fails without it. Unit suite
235 passed; compiled smoke passed in both modes; smoke, wrist, keyboard, toasts, window-settings,
showhide, camera and layouts (twice) passed.

## Accepted: keep wrist pages built after their first visit

Frame observation with per-frame heap sampling (`_scratch/perf/gc-misses/`) put every missed
refresh of two general-route rounds (release `e3aa83b`, VRChat, beyond75) inside the
wrist-menu-cycles step. `WristMenuUi` returned one page per view, so each switch unmounted the
old page's UIKit tree (listener aborts, `removeChild`) and built the new one (signals, property
layers, yoga). Pages now sit in their own `React.Activity`, built on first visit and hidden
afterwards, with `intersectChildren` off while hidden. Subpage elements are memoized and a hidden
page keeps the opacity and pointer type it was last shown with, so the clock's tick and an
opacity step don't restyle hidden pages. The playtest and vrlab text lookups now skip hidden text.

`_scratch/perf/wrist-pages/ab1/`, release, four alternating pairs with VRChat, the general route
each: refresh intervals of 20 ms or more during wrist-menu-cycles 3, 7, 3, 3 → 0, 0, 0, 0; worst
interval in that step 23.6–25.5 → 14.1–15.8 ms; whole-route misses 17 → 2. Every route step
passed in all eight runs, and once on the debug build with VRChat.

Tradeoff, accepted: switching the menu to the other hand remounts it in the other controller,
which now tears down every visited page. Four hand switches after a route, release with VRChat
(`hand/`): worst interval 33.9–39.3 → 62.2–67.4 ms, misses 4 → 5 per four switches. A hand switch
is a one-off setting that already dropped frames; page switches are the everyday path. Moving the
menu between controllers without a remount would remove it.

Unit suite 235 passed; compiled smoke passed in both modes; lifecycle, smoke, showhide, layouts,
window-settings, wrist, keyboard, toasts, grablatency, grabdrops and camera passed. hovertoolbar
still needs a second host output.

## Shelved: VRChat camera OSC while PetPlay's camera is unused

The always-mounted wrist home subscribes to the whole camera snapshot, so it re-renders at 4 Hz
whenever VRChat streams `/usercamera/Pose`. A patch that selects only the derived status string
cut that stream's cost from +2.2 to +0.6 MB/s allocation and from +5.5 to +0.4 % of a core
(five alternating pairs, `_scratch/perf/camera-unused/`). Not committed, at the user's direction
to stay on the basic scenario; the patch is `_scratch/perf/camera-unused/shelved-candidate.patch`.

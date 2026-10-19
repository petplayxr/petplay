# General use under the synthetic workload: survey and allocation work

Status: survey done; allocation fixes and UI snapshot reuse accepted. Idle GC pauses, now about
every 17 s instead of every 11 s, remain the main source of PetPlay frame-time tails in general use. Follows the reveal work in
`optimization-2026-10-18-ui-reveal.md`.

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

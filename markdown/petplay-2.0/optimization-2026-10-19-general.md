# General use under the synthetic workload: survey and allocation work

Status: survey done; small allocation fixes accepted; idle GC pauses remain the main source of
PetPlay frame-time tails in general use. Follows the reveal work in
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

## Open

- Fewer major GCs needs much less promotion. The bulk of it is UI snapshots rebuilt every frame,
  even though most UI is static between frames. Reusing unchanged panel and text snapshots would
  cut it, but snapshots can cross to the render child and outlive the frame, so it's a lifetime
  change in the renderer's data path.
- Shorter pauses would need a smaller live heap (~100 MB): not yet attributed.

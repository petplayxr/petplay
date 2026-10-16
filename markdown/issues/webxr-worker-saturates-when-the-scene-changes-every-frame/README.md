# webxr worker saturates when the scene changes every frame

Status: open
Track: decoupled renderer / worker

## What happens

When something changes every frame (a laser on a panel, a non-carried animation, a two-hand
grab), nothing can be skipped. The webxr worker then spends ~10 ms of each 13.3 ms frame, and at
nice 0 under load it misses vsyncs (71 Hz instead of 75 measured 2026-10-16). Content the worker
drives updates at that irregular rate. The renderer and carried windows are unaffected.

An 8 s worker CPU profile, per frame while the scene changes:

| Cost | ms |
|---|---|
| App tick (react-three-fiber advance) | ~4.1 |
| Scene build: UI extraction (`extractWebXRRaythreeUi`) | 1.76 |
| Scene build: scene extraction | 1.37 |
| Scene build: `updateMatrixWorld` | 0.8 |
| Scene encode (v8 serialize) | 1.15 |
| Unchanged-scene fingerprint (`fingerprintScene`) | 0.65 |
| GC pauses (most of the worker's 20–30 ms gaps) | ~8.5 each |

`traverseVisible` alone is ~1.45 ms/frame: it walks the whole graph to find uikit text and
images.

## Expected

The worker keeps 75 Hz with headroom at nice 0 under heavy load.

## Plan

1. Keep a registry of uikit text and image objects (added and removed with their components)
   instead of walking the scene each frame. Saves ~1.4 ms.
2. Cheaper fingerprint: skip it after several consecutive changed frames and re-check
   periodically, or hash only revision counters. Saves up to 0.65 ms.
3. Check whether the build's `updateMatrixWorld` repeats work the app tick already did. Saves up
   to 0.8 ms.
4. Cut what the scene build allocates (snapshots, encode buffers) to shorten and space out GC.
   See the worker GC notes in the `webxr-worker-gc-diagnosis` memory and
   [long-running-dev-server-degrades-frame-pacing](../long-running-dev-server-degrades-frame-pacing/README.md).

## Repro

Live session with `--webxr-decoupled-renderer`, point the laser at a panel so the scene changes
every frame, then CPU-profile the worker over `/eval` (`node:inspector` `Profiler.start` with a
250 µs interval) and attribute time between frame ticks.

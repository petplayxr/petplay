# Long-running dev server degrades frame pacing until restarted

Status: open
Track: decoupled renderer / panorama

## What happens

A dev server that has run for hours gets gradually less smooth in the headset: more dropped
frames, plus stretches of about a second where the panorama latch keeps failing and the whole
view jitters constantly. Restarting the server makes it clearly smoother again, with the same
SteamVR session, scene, load and settings.

Seen 2026-10-16. The degraded process (`petplay.ts dev --agent-repl --watch-webxr
--openvr-attach-only --webxr-decoupled-renderer`) had run 2 h 15 min, and in that time the
webxr worker had hot-reloaded 41 times (each reload also restarts the decoupled renderer).
After a restart, at load average ~27 on 16 cores with VRChat and FaceTrackVR running, the
remaining drops were ~0.3% of latch windows, all lining up with SteamVR compositor drops.

## Expected

Pacing stays the same however long the server runs and however often the worker reloads.

## Repro

Not reduced yet. The process was gone before it could be inspected. To tell time from reloads:

1. Run two sessions of similar length: one with frequent `--watch-webxr` reloads, one with none.
2. Every ~10 min, record the measurements below and compare them with a fresh process.

## What to measure

- **Processes:** process tree and RSS per process. Check that old decoupled-renderer or
  overlay-host processes and worker threads exit on reload, not just get replaced.
- **V8 heaps:** in the webxr worker and the renderer (`node:v8` `getHeapStatistics` /
  `getHeapSpaceStatistics` over `/eval`). A growing old space means longer and more frequent
  full GCs.
- **SteamVR overlay count:** whether reloads leak overlay handles (panorama, projection,
  presenter). Each leaked overlay adds compositor work, and compositor hitches already cause
  the residual drops.
- **Latch misses:** a timeline capture (`overlayRenderOwner` SETFRAMETIMELINE) analysed per
  latch window, against `IVRCompositor::GetFrameTimings` from
  `native/compositorTimingProbe/probe.cpp`.
- **Worker rate:** worker frame rate and interval distribution (the vsync-locked rAF should
  hold ~75 Hz).

## Notes / evidence

- Shortly after one reload in the old process, the renderer heap was 226–238 MB, and a single
  75 ms full GC freed 129 MB. That frame missed the latch. A later 30 s capture in the same
  process stayed at 59–92 MB with no full GC, so a one-off can't be told apart from growth.
- Earlier worker GC work (2026-10-15) measured ~12 MB/s old-space growth and ~577 MB external
  memory in the webxr worker. Mark-compact pauses there freeze the simulation for 0.3–1 s.
- Suspects, none confirmed:
  - resources left over across hot reloads: worker isolates, renderer processes, GL objects,
    OpenVR overlays, timers or PostMan listeners;
  - V8 heap growth making GCs longer;
  - a slow leak in the screen capturer path.

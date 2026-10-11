# CPU-side frame cost is far over budget

Status: open
Track: stability-performance, stack-update

## What happens

The GPU/graphics path is fine. The CPU side is technically usable (most users wouldn't notice),
but it's far from the target, and it's the main reason PetPlay feels laggy next to WayVR/XSO.

## Expected

The most optimized r3f app there is: minimal per-frame CPU while interacting, near zero when idle.

## Next step

Record a baseline first (`deno task overlay:perf`, CPU profile per worker) and attach the run
folder here. Then do the stack update, re-baseline, and work the list in
[stability-performance.md](../../petplay-2.0/stability-performance.md#performance).

## Baseline 2026-10-11 (`--novr`, no SteamVR, commit c211c0c)

Linux, CachyOS, desktop session. `deno task overlay:perf --profile` (synthetic input, webxr
worker only):

| phase   | fps  | r3f avg | r3f max |
| ------- | ---- | ------- | ------- |
| idle    | 53.0 | 0.49 ms | 0.87 ms |
| hover   | 57.5 | 0.49 ms | 0.59 ms |
| trigger | 57.3 | 0.48 ms | 0.73 ms |
| drag    | 59.0 | 0.54 ms | 1.27 ms |
| sweep   | 59.0 | 0.47 ms | 0.53 ms |
| scroll  | 59.3 | 0.46 ms | 0.55 ms |

The CPU profile shows the webxr worker 4% busy over 12 s; GC and timer bookkeeping are at the top.

Process CPU (`top -H`, 10 s windows, `dev --novr`):

- No views: server is about 3% of one core total (worker-3, the webxr actor, at about 2.3%).
- With `client desktop` attached: server about 7% (main 3.5%, webxr 3.5%). The view
  process uses about 15% (its worker-1 at 11%), redrawing a static scene at 120 fps. webxr
  publishes IR about 50 times a second while nothing moves.

So in `--novr` the r3f/scene side is cheap. The cost the user feels in VR has to sit in the
OpenVR path: `uploadRaylibShadowFrame` (raylib rasterization of both eyes and texture upload)
and capture ingest in `displayOverlayHost`. Neither runs without SteamVR, so the next baseline
needs a SteamVR session (`deno task overlay:perf -- --attach` during real use, or the null
driver).

Idle targets that are visible already:

- The desktop view redraws at 120 fps with no new IR and no camera movement.
- webxr re-extracts and re-publishes IR every host frame even when the scene is unchanged.

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

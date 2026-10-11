# Track 3: Stability & performance

## Stability

What exists: self-healing presentation (overlay re-show/rebuild, in-actor stack restart up to
5×), the `dev-runner` log keeper, `nativeCrashTrace`, `deno task status` repair counters, and
per-process overlay key claims.

Work:

- **Soak test.** Run 4 h with SteamVR + capture + a desktop view, sampling `status` every minute.
  Pass criteria: no process exit, `repairs` stays flat, RSS growth under X MB/h, no fd/handle
  growth. The agent harness ([track 5](./agentic-playtesting.md)) runs it overnight.
  First run (2026-10-11, `--novr`, no SteamVR or capture): 4 h, a wrist-menu and toast cycle
  every 5 min (48/48 ok). Between cycles, RSS went 342 → 385 MB in the first 15 min, then stayed
  flat (~355–390 MB); heap ~90–120 MB; scene nodes back to 73 after every cycle. No leak in the
  scene/UI path. The SteamVR + capture soak is still to do.
- **Native crash surface.** A segfault in any worker kills the process. Inventory the FFI
  entrypoints that run outside the render loop, and add a supervisor parent that restarts the
  server on native death (the dev-runner already half does this) and records the last
  `nativeCrashTrace` into an issue folder.
- **Known gaps** from `docs/ARCHITECTURE.md` §9, each now an issue:
  [capture reconnect](../issues/FIXED-capture-receiver-has-no-reconnect/README.md),
  [fixed ports](../issues/fixed-ports-collide-across-instances/README.md),
  [process-group SIGTERM](../issues/process-group-sigterm-kills-children-mid-flight/README.md),
  [snapshots only on RELOAD](../issues/snapshots-only-cover-reload/README.md),
  [two desktop surfaces](../issues/two-desktop-surfaces-diverge-layout/README.md).
- **SteamVR lifecycle edge cases:** SteamVR restart mid-session, headset sleep/wake, compositor
  crash, Steam Link/Frame transport drops. Each one gets a scripted repro (null driver where
  possible: `deno task nulldriver:true`).
- **Dead code** makes bugs harder to find: [dormant actors](../issues/dormant-actors-are-dead-weight/README.md).

## Performance

**This is M1 work.** The graphics path is fine. The **CPU side** is the problem: it's usable
enough that most people wouldn't notice, but it's far from the standard PetPlay should hold.
The target is the most optimized r3f app there is. That mostly takes tokens, not new
ideas: profile, find the hot path, fix it, measure, repeat.

Do this **after** the [stack update](./stack-update.md), so the tuning targets the r3f/three
internals that will stay.

CPU work, roughly in order:

1. **Baseline.** Per-frame CPU ms per actor/worker (`webxr`, `displayOverlayHost`, main), main
   thread and worker, idle and while interacting. `overlay:perf` already captures CPU profiles;
   make it produce a stable number that goes into the repo.
2. **Per-frame work audit.** Every `useFrame` callback, React re-renders per frame, allocations
   per frame (GC pauses show up as judder), and `updateMatrixWorld` coverage.
3. **Scene extraction.** raythree IR is built and shipped every frame for each consumer. Diff or
   skip it when nothing changed, and stop re-serializing static geometry.
4. **Message traffic.** Per-frame actor messages, structured-clone cost of payloads, and
   SharedArrayBuffer where it already pays off (`controllerStateSab.ts`).
5. **Idle.** With nothing moving, CPU should be near zero.

See [cpu-frame-cost-far-over-budget](../issues/cpu-frame-cost-far-over-budget/README.md).

Also:

- **Budget.** PetPlay is an overlay: its cost is whatever the user's game loses. Target: < 1 ms of
  compositor GPU time at idle with one display, and no missed frames attributable to us in
  `openvr:probe`.
- `deno task overlay:perf` already captures frame metrics and CPU profiles. Turn it into a
  tracked baseline (`markdown/perf/<date>.md` or JSON under `logs/perf/`) so regressions show up.
- Candidate wins to measure before doing: capture FPS caps per display (the helper restarts to
  re-rate today, `displayOverlayHost.ts:453`), and the 3560² eye targets vs a quality setting.
- Startup time: measure cold start to first presented frame, then trim it.

## Done when

The 4 h soak passes three nights in a row, and the perf baseline sits in the repo with a
regression check the harness runs.

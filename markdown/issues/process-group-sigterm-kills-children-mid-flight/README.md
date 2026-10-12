# Process-group SIGTERM kills children mid-flight

Status: open
Track: stability-performance

A single-process SIGTERM shuts down cleanly. A process-group SIGTERM (what a terminal Ctrl-C,
systemd and some launchers send) kills the capture helper and overlay children before the
parent can tear them down in order. This matters for SteamVR auto-launch and systemd, which
both signal the whole group.

Fix direction: put children in their own process group/session and have the parent own their
shutdown.

Source: `docs/ARCHITECTURE.md` §9.

## 2026-10-12: checked in `--novr`

`kill -TERM -<pgid>` on a `dev --novr` server with the decoupled desktop view attached (a
`{ worker: "process" }` child in the same group). The shutdown was clean: every actor was shut down
in order, webxr ran its native cleanup, and the log ends `CLEAN` / `exit! WOOF~`. No child-exit
error, no respawn. Afterwards the scheduler logs ~140 harmless "Root "root_0" not found" lines.

That leaves the case this issue is about: the display overlay host and the capture helper, which
only run with SteamVR. If the fix turns out to be needed, it's cheap and safe. Spawn them
`detached: true` (their own session), so a group signal only reaches the parent:

- the IPCWorker child exits once its WebSocket closes (`WebSocketWorkerHost.ts`);
- the capture helper stops when its stdin closes;

so neither is orphaned if the parent dies.


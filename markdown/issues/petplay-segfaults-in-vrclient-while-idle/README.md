# PetPlay segfaults inside vrclient.so while idle

Status: open
Track: stability-performance

## What happens

On 2026-10-18 at 16:01:27 EEST, PetPlay died with SIGSEGV (`SEGV_MAPERR`) while nothing was
driving it. It was the synthetic lab stack from `deno task vrlab up` (driver-direct lab SteamVR,
scratch layout/settings, VRChat idle in a world), started at 15:56. The faulting thread was inside
SteamVR's `vrclient.so`, called from deno (`crash-stack.txt`; top frame `vrclient.so + 0x6237e2`).
The core is in `coredumpctl` as pid 451746.

The log (`petplay-log-tail.txt`) shows the render loop stopping first: the `[raylib-pacer]` 75 Hz
lines end while the desktop capturer keeps reporting for about ten more seconds. Then
`[WebSocketWorkerHost] WebSocket transport failed`, and the process is gone. SteamVR's logs have
nothing before the disconnect: vrserver and vrcompositor only record deno (451746) and its
display-overlay host (452103) disconnecting at 16:01:27.904. The compositor kept running.

## Notes

- Different from `steam-frame-exit-segfault`: that one is at exit after actor cleanup (ARM64,
  DroidFrame, `vrclient.so + 0x2584b8`); this is x86-64, mid-run, with no shutdown in progress.
- Same lab session, but unrelated in time: a vrcompositor SIGSEGV at 15:53:33 when VRChat was
  restarted (the stack was then restarted, so this PetPlay never saw that compositor).
- The lab uses the new driver-direct `CAPTUREDIRECTFRAME` reader, but no capture ran between
  15:56 and the crash.
- Seen once so far. `vrlab:camera-check` now calls `up()` first, so a dead PetPlay is restarted
  rather than failing the run.

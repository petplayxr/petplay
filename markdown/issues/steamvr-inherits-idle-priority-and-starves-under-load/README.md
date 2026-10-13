# SteamVR inherits idle CPU priority and starves under load

Status: open (needs SteamVR configuration; temporary workaround below)
Track: stability-performance

## What happens

With VRChat running, PetPlay drops frames every few seconds: 40-140 ms gaps, 1-10 display frames
skipped at a time, starting as soon as VRChat loads, with no interaction. Grabbing and hovering
felt laggy and stuttery. VRChat itself stutters with a similar cadence.

`vrserver`, `vrcompositor` and `vrdashboard` run as `SCHED_IDLE`, so they only get CPU when
nothing else wants it. They inherit it from the `steamvr-watch` deno process that launches
SteamVR, which ananicy puts in the background class through its deno rule
(`/etc/ananicy.d/00-default/Development & Programming/deno.rules`). VRChat takes about two cores,
the compositor and vrserver lose out, and the OpenVR vsync counter PetPlay paces on stalls for
19-34 ms, then jumps 2-3 frames.

Check with `chrt -p $(pgrep -x vrcompositor)`.

## Evidence 2026-10-13

VRChat loaded, PetPlay live on OpenVR at 75 Hz (per-second stability lines, `petplay/webxr.ts`):

| SteamVR priority | PetPlay pacer | seconds with a skip | gaps > 30 ms | worst gap |
| ---------------- | ------------- | ------------------- | ------------ | --------- |
| `SCHED_IDLE` | vsync spin | 15% (of 2867 s) | 12% | 140 ms |
| `SCHED_IDLE` | `WaitFrameSync` | 39% (of 75 s) | 8% | 42 ms |
| `SCHED_OTHER` | `WaitFrameSync` | 5 of 91 s | 0 | 22.5 ms |
| `SCHED_OTHER` | vsync spin | 0 of 90 s | 0 | 15.1 ms |

PetPlay's own priority barely matters: the last run had PetPlay itself at `SCHED_IDLE`. With
SteamVR boosted, a synthetic grab sweep and hover cycles on the live headset path dropped no
frames (see `tests/playtest/grabdrops.ts` if it was kept).

## Workaround

`sudo ./steamvr-unidle.sh` (in this folder) moves the running SteamVR processes to `SCHED_OTHER`,
with the compositor at nice -10 and vrserver at nice -5. It lasts until SteamVR restarts.

## Fix

Launch SteamVR outside the background class: have `steamvr-watch` start it with normal
scheduling (`chrt -o 0` plus a nice boost for the compositor), or exclude that process from
ananicy's deno rule. The `vrcompositor-launcher` binary has `cap_sys_nice`, so it may also be
able to raise its own priority once it doesn't start from `SCHED_IDLE`.

## Notes

- WayVR hides this better because its overlays are quads the compositor positions with fresh
  controller poses; a late WayVR texture still tracks. PetPlay renders from the head pose, so
  late frames swim. Reprojection (the projection overlay experiment) is the robust fix for
  PetPlay's own late frames, but it can't hide a compositor that misses scanout.
- Pacing on `IVROverlay::WaitFrameSync` the way WayVR does was tried and is not the lever.

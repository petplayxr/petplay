# SteamVR inherits idle CPU priority and starves under load

Status: machine repair installed (2026-10-13); fresh-launch/headset validation pending
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

## Persistent machine repair (2026-10-13)

Installed and enabled `steamvr-scheduling.service`. Every 0.5 s it checks UID
1000 plus exact installed SteamVR executable paths for `vrcompositor`,
`vrserver`, and `vrdashboard`, corrects idle threads to normal scheduling, and
maintains nice ceilings -10/-5/0. It preserves stronger existing nice boosts
and realtime/batch threads. It works independently of launch route and does
not modify Steam-owned executables or broaden the generic Deno rule.

Live-verified: the corrected service is active with zero restarts in the initial
window; compositor has 27 normal/-10 threads, server has 31 normal/-12 threads
and two preserved RR threads, dashboard has two normal/0 threads. A disposable
two-thread executable proved actual idle-to-normal correction, nice boost, and
wrong UID/path rejection. SteamVR was not restarted. Fresh-launch/reboot and
headset performance verification remain pending. The watcher source now uses
attach-only behavior; the original inheritance attribution above is historical
incident evidence rather than a newly reproduced launch chain.

Source, exact scope, installation and rollback:
[SteamVR scheduling guard](../../../../steamvr-tools/steamvr-tools/scheduling/README.md).


## PetPlay startup repair (2026-10-13)

PetPlay now owns its Linux identity/scheduling setup: host and child processes
name themselves `petplay`, and the watcher `petplay-watch`. Both source child
launches and compiled dispatch run it. It restores inherited idle threads to
normal and attempts to restore positive niceness to 0 without affecting
intentional batch/realtime policies or stronger boosts. The original comm-only setup proved insufficient on hot reload; the
correction below also changes the argv[0] identity used by ananicy. Permission denials produce a
warning; an optional scoped ananicy rule is shipped for machines needing admin
policy, but no automatic elevation or global Deno modification is performed.

Live-verified on Ellie’s machine: the same function applied through the actor
REPL repaired host and display child in place. Host: 31 normal/nice-0 threads;
child: 14 normal/nice-0 plus eight preserved batch/nice-16 threads. State stayed
correct beyond ananicy’s 15-second scan interval. No root change was needed.
Six focused tests and a compiled scheduling/dispatch smoke pass; targeted type
checks/lint pass. Full repo check reports 17 unrelated unfiltered errors. Full
fresh app/headset performance remains unverified.

Hot-reload follow-up: Ellie reported another demotion, and clarified that Claude
had manually corrected the priority before the healthy snapshot. The matching
ananicy source prefers argv[0], not comm. Startup now sets argv[0] to `ppvr`
without changing the remaining arguments, and WebXR runs the routine on every
worker load. Three bounded delayed rechecks catch the late priority write seen
in a repeated-worker regression test. Seven tests and a compiled smoke pass;
two actual WebXR reloads succeeded, with the first remaining free of idle
threads for 30 seconds. Server discovery still works. This follow-up needs no
root change, PetPlay process restart, or SteamVR restart.

See [Linux scheduling](../../../resources/linux/README.md).

## Notes

- WayVR hides this better because its overlays are quads the compositor positions with fresh
  controller poses; a late WayVR texture still tracks. PetPlay renders from the head pose, so
  late frames swim. Reprojection (the projection overlay experiment) is the robust fix for
  PetPlay's own late frames, but it can't hide a compositor that misses scanout.
- Pacing on `IVROverlay::WaitFrameSync` the way WayVR does was tried and is not the lever.

Final follow-up verification: after the second WebXR reload, sixteen samples
over 30 seconds retained argv[0]=ppvr, no idle threads, and twenty normal
nice-0 host threads in the final sample. No manual priority reset was used
after either reload.

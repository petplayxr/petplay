# `--novr` desktop views receive no frames, so `client capture` times out

Status: open
Track: agentic-playtesting

## What happens

Reproduced 2026-10-11 on Linux with SteamVR not running:

```bash
deno run -A --unstable-webgpu --env-file --no-check petplay/petplay.ts dev --novr --agent-repl --agent-repl-port=3990
deno run -A petplay/client.ts capture --agent-repl-port=3990 --path=shot.png
# [client] desktop view wrote no capture within 30000ms
```

The XR frame loop itself is running: `/health/actors` reports `webxr` with `frameCount` 3549
and `xrFps` ≈ 60. The hidden view registers (`view registered: desktop_view@... (desktop)` in
`server.log`) but never gets a `WEBXRVIEWFRAME`. `status` shows `0 frames overlay`.

## Likely cause (from reading the code, not yet confirmed live)

Scene extraction is tied to the OpenVR overlay pump. `publishRaythreeFrameToViews` has a
single caller, inside `uploadRaylibShadowFrame` (`petplay/webxr.ts:1932`). That function
returns early when `state.raylibOverlayRaylib` is unset (`webxr.ts:1830`), and in `--novr`
there's no overlay. So nothing ever builds the raythree payload, and views starve.

## Fix direction

Decouple "extract the scene IR at some rate" from "present to the OpenVR overlay". With no
runtime, the extractor runs on its own pacer (the XR rAF already ticks at 60 Hz) and feeds the
views. The overlay becomes one consumer of the IR rather than the thing that drives it.

## Evidence

- `server.log`: the full server output of the repro run.

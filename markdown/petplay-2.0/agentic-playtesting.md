# Track 5: Better agentic playtesting

Goal: an agent can run a VR session end to end (launch, act, look, judge) and leave behind either
"pass" or an issue folder with evidence. That way most changes get verified without someone
putting the headset on.

## Priority: everything works without SteamVR

**All agentic work must be possible without SteamVR**, including visual playtesting. The
raythree render path makes this realistic: the scene is extracted to an IR and rasterized by
raylib, and the desktop view already renders the same IR the headset sees. Without a runtime,
an agent should still be able to launch, drive input, capture frames and judge them. A headset
is only needed for things that really are about the headset (compositor behaviour, tracking,
SteamVR lifecycle).

That gives two tiers:

1. **No SteamVR** (`--novr`, the default for agents): scene, interaction, UI, displays (fed by a
   fake capture source), captures, perf of everything above the OpenVR boundary.
2. **SteamVR with the null driver** (`deno task nulldriver:true`): the OpenVR overlay path and
   lifecycle, still without a headset.

**Fully headless** (no desktop session at all) is the end goal. Today the views are GLFW windows
that need an X11/Wayland display. The options are a virtual display (Xvfb, or a headless Wayland
compositor such as `cage`/`weston --backend=headless`; none of these is installed on the dev box
yet) or a surfaceless EGL raylib context. The virtual display is the cheaper first step.

### Current state (checked 2026-10-11)

- `--novr` boots cleanly: actors come up, the XR loop runs at ~60 fps, and the REPL answers.
- `client capture` works in `--novr` (fixed 2026-10-11, see
  [novr-desktop-view-receives-no-frames](../issues/FIXED-novr-desktop-view-receives-no-frames/README.md)):
  the PNG shows the scene, so UI layout can be checked by eye.
- Desktop capture/display presentation is disabled in `--novr` (it's backed by an OpenVR
  overlay), so displays can't be tested without SteamVR.

## What exists

- Agent REPL on `:3987`: `/registry`, `/health/actors`, `/message`, `/eval`, `/reload`, `/create`
  (load an actor at runtime).
- `petplay/client.ts`: `status`, `capture` (a PNG of exactly what the headset sees, via the
  preview renderer), `repair`, `reboot`, `detach-vr`.
- `utils/overlay-perf-harness.ts`: synthetic controller input (`installSyntheticInput`, `aimAt`)
  and scripted scenarios (hover, trigger, squeeze-grab drag, edge sweep, joystick), run inside the
  `webxr` worker.
- `utils/playtest.ts`: wrist-menu playtesting on top of that input. `faceWristMenu` holds the
  right wrist so the panel faces the head; `clickWristMenu`/`hoverWristMenu` take panel points
  (`WRIST_MAIN`, `WRIST_SETTINGS`). Load it via `/eval`, then `client.ts capture` to look.
- `--novr` / `dev:desktop` for runs without SteamVR, and the null driver toggle for runs with
  SteamVR but no headset.
- `utils/headsetCheck.ts`: for what only a person in the headset can judge. `runHeadsetCheck(host)`
  from `/eval` works through the unverified features one at a time (curve direction and pointer,
  opacity, anchoring to head and hand, wrist hand and size, haptics, battery). Each step changes
  the display in view, asks a yes/no question as a toast, and undoes the change once answered.
  Answers go on the left stick (up yes, down no, left skip) and land in
  `logs/headset-check-<time>.json`. In `--novr`, drive it with `leftBuffers.joystick` on the
  synthetic input. If the process dies mid-step, that step's change has already been saved to
  the layout.

## Gaps

- Scenarios live in the perf harness and are tied to it. They aren't a general playtest DSL.
- No assertions on scene state: "did the display move", "is the keyboard open", "is the toolbar
  under the pointer". Checks are eyeballed from captures.
- `/eval` is a footgun: native FFI or GL calls from it segfault the process (see the REPL notes).
  The fix isn't a separate agent API (no MCP: too rigid and too complex). It's the OS itself:
  reusable logic is written as an actor and loaded with `/create`, and the interface is that
  everything stays dynamic. Ad-hoc `/eval` is fine for one-off looks; anything an agent does
  twice becomes an actor.
- Desktop capture is disabled in `--novr` mode (it's backed by an OpenVR overlay), so the most
  important surface can't be tested headless.
- No run record: inputs, captures, status samples and logs aren't bundled anywhere.

## Plan

0. **Make `--novr` fully capable.** Decouple IR extraction from the overlay pump (the issue
   above), render display panels in-scene when there's no OpenVR overlay to put them in, and add
   a virtual-display launcher for headless runs. Every later step assumes no SteamVR.
1. **Playtest scripts** in `tests/playtest/<name>.ts`: a sequence of steps (`aim`, `trigger`,
   `grab`, `drag`, `type`, `wait`, `capture`, `expect`). They talk to the actors from step 2, and the scenario code moves out of `overlay-perf-harness.ts` into a shared
   module.
2. **Scene-query and input actors**, loaded on demand with `/create`: list spatial nodes with
   world transforms, find by role, report what's under each pointer and which panels are open,
   and drive synthetic input. They're ordinary actors, not a special agent interface, so a
   playtest script, a human at the REPL and a future module all use the same ones. Anything that
   touches GL runs inside the frame loop, never from `/eval`.
3. **`deno task playtest <name|all>`**: launches or attaches to a server, runs the scripts, and
   writes `logs/playtest/<date>-<name>/` with captures, status samples, the server log slice and
   pass/fail per `expect`.
4. **Failure → issue.** On a failed `expect` or a crash, the runner (or the agent driving it)
   creates `markdown/issues/<slug>/` with the run folder's captures and a repro pointing at the
   script.
5. **Headless capture:** a fake capture source (test pattern or video file; `tests/videotest`
   exists) so display tests run in `--novr` and CI-like contexts.
6. **Visual judgement.** Captures are what the agent looks at. Add fixed camera presets
   (front, over-shoulder, wrist) and a larger default capture size so UI text is legible.
7. **Soak mode:** a long loop of random-but-valid interactions with periodic status sampling.
   This feeds [track 3](./stability-performance.md).

## Done when

`deno task playtest smoke` runs **without SteamVR** (and, once the virtual display lands, with
no desktop session). It covers launch, grab+move a display, resize, open the keyboard, type,
open settings and change a value. It runs unattended in under 2 minutes and files an issue folder
on failure.

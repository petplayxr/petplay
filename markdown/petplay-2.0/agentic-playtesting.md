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
  (`WRIST_MAIN`, `WRIST_SETTINGS`, `WRIST_WRIST`). Load it via `/eval`, then `client.ts capture`
  to look.
- `deno task playtest <name|all>` (`utils/playtest-run.ts`): launches a `--novr` server on its own
  port with scratch layout and settings, runs `tests/playtest/<name>.ts` one step at a time inside
  the `webxr` actor (`runPlaytestStep` in `utils/playtest.ts`), captures the view after each step,
  and writes `logs/playtest/<time>-<name>/` (`result.json`, a PNG per step, `server.log`). Exit code
  is the verdict; `--file-issue` writes `markdown/issues/playtest-<name>-<step>-fails/` on failure,
  and `--keep` leaves the server up to poke at. Steps assert on scene state (`expect`, `waitFor`).
  Key presses are watched through `keyboard/keyEvents.ts`; in `--novr` the keyboard sink types
  nowhere, which is why the runner never attaches to a running session.
- `tests/playtest/smoke.ts`: show windows from the wrist, laser-grab a window and move it,
  two-handed resize, type two keys, open the window's settings from its toolbar, toggle a setting
  on the wrist Settings page. Passes in about 25 s (2026-10-12). Its first run found
  [keys behind a selected window's toolbar ignoring presses](../issues/FIXED-keys-behind-a-selected-windows-toolbar-ignore-presses/README.md).
- `tests/playtest/layouts.ts`: lock a window from its toolbar (a locked drag doesn't move it), unlock,
  save the layout to slot 1 and load it back after moving the window, and recenter from the wrist.
  Passes in about 35 s (2026-10-12). Shared step helpers (hands, laser drag and click, toolbar
  lookup, `showWindows`) live in `tests/playtest/lib/`, which the runner skips.
- `tests/playtest/window-settings.ts`: opens a window's settings from its toolbar and presses each
  control: opacity, curve, laser drives mouse, hide when looking away (turns the IWER head away
  and back and watches the fade), reset pose, and anchoring to the head (the window follows a head
  turn). Passes in about 30 s (2026-10-12).
- `tests/playtest/keyboard.ts`: US legends, Shift is one-shot, Caps Lock latches, Backspace / Enter
  / Space send the right scan codes, no legend is drawn oversized, and the keyboard rides with its
  window. Passes in about 28 s (2026-10-12). Its first run found the special keys (⌫ ↵ arrows)
  drawing blank at a huge misplaced scale; they now come from the icon atlas
  (`resources/fonts/material-icons/add-glyphs.py` adds glyphs to it). The Finnish letters
  ([finnish-keycap-letters-render-blank](../issues/FIXED-finnish-keycap-letters-render-blank/README.md))
  draw from the same atlas, and a `finnish-legends` step checks them.
  The keyboard's own toolbar is covered too: reset pose, lock (a locked keyboard ignores a grab
  that swings an unlocked one), Typing sounds and Key legends from its settings, and detach (the
  keyboard stays put while the window moves). Now about 54 s. The reset step found
  [reset-pose-folds-a-hinged-keyboard-flat](../issues/FIXED-reset-pose-folds-a-hinged-keyboard-flat/README.md).
- `tests/playtest/toasts.ts`: a desktop notification (fed to the sink as a `busctl` line, so nothing
  goes on the real session bus) shows below the line of sight, an update replaces its toast, a
  burst queues past three, long text wraps inside the card, the stack follows the head, a laser
  grab passes through it to the window behind, and an XSO UDP datagram shows with its tone (sent
  only when the test server holds the XSO port). Passes in about 20 s (2026-10-12).
- `tests/playtest/lifecycle.ts`: add a display from a window's toolbar, detach it (it stays put and
  stops following the window), delete it, and anchor a window to the left hand (a hand slide moves
  it the same distance). Passes in about 25 s (2026-10-12). Scoping the toolbar lookup to the
  window for this script showed that a window's own toolbar was unreachable behind its keyboard;
  with a keyboard attached, the toolbar now sits above the window.
- `tests/playtest/wrist.ts`: the clock matches the host, battery readings (published into the
  store) show on the wrist and one low-battery toast fires below 15%, the Settings toggles write
  their settings, edit mode needs the windows shown and goes off with them, the Monitors page
  reassigns the window's output and back (and adds a display for a free output), the Wrist menu
  page steps size, opacity and hand, and dragging the panel moves it. Passes in about 60 s
  (2026-10-12). Its first run found
  [wrist button clicks nudging the menu](../issues/FIXED-wrist-button-clicks-nudge-the-menu/README.md).
  `deno task playtest all` runs all seven in about 4 minutes.
- `--novr` / `dev:desktop` for runs without SteamVR, and the null driver toggle for runs with
  SteamVR but no headset.
- `utils/headsetCheck.ts`: for what only a person in the headset can judge. `runHeadsetCheck(host)`
  from `/eval` works through the unverified features one at a time (curve direction and pointer,
  opacity, mouse block, auto-hide, anchoring to head and hand, wrist hand, size and grab-to-move, haptics,
  battery). Each step changes the display in view, asks a yes/no question as a toast, and undoes
  the change once answered.
  Answers go on the left stick (up yes, down no, left skip) and land in
  `logs/headset-check-<time>.json`. In `--novr`, drive it with `leftBuffers.joystick` on the
  synthetic input. If the process dies mid-step, that step's change has already been saved to
  the layout.

## Gaps

- The perf scenarios still live in the perf harness; playtest steps share its synthetic input
  but not its scenario code.
- `/eval` is a footgun: native FFI or GL calls from it segfault the process (see the REPL notes).
  The fix isn't a separate agent API (no MCP: too rigid and too complex). It's the OS itself:
  reusable logic is written as an actor and loaded with `/create`, and the interface is that
  everything stays dynamic. Ad-hoc `/eval` is fine for one-off looks; anything an agent does
  twice becomes an actor.
- Desktop capture is disabled in `--novr` mode (it's backed by an OpenVR overlay), so the most
  important surface can't be tested headless.
- Run records have captures, the server log and step results, but no status samples yet.

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

**Status (2026-10-12):** met with a desktop session: the smoke run covers all of the above in
about 25 s without SteamVR, and `--file-issue` files the issue folder (opt-in, so repeated runs
don't pile up duplicates). Still open: the virtual display for runs with no desktop session.

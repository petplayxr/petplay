# PetPlay 2.0

Started 2026-10-11. PetPlay works now: the scene, the overlay pipeline, display capture,
supervision and the agent REPL all hold up in daily use. This plan covers the **product work** on
top of that, across two releases.

**Focus:** there is no XSOverlay on Linux, and PetPlay needs to replace it for daily use sooner
rather than later. This plan is about the overlay app. The substrate underneath
([what PetPlay is](../what-petplay-is.md)) only gets work when the app needs it.

## Releases

- **2.0 = stable, and the developer can stop using WayVR.** That's milestone M1 below. No
  packaging or store requirement.
- **2.1 = ready to release on Steam, including Steam Frame support.** Milestones M2 and M3.

### 2.1 definition of done

Someone who isn't the developer can:

1. install PetPlay through Steam (desktop or Steam Frame) and have it start with SteamVR, with no
   terminal, `.env` or submodule build involved;
2. bring up their desktop, move it, resize it, type into it and change settings from inside VR,
   without reading docs;
3. leave it running for a multi-hour session without a crash, a black overlay or noticeable
   frame cost;
4. do the everyday things they currently do in XSOverlay.

## Not in 2.x

Out until the standard use case is stable. Don't build these, but don't build anything that rules
them out either:

- p2p sessions and shared apps (including the original shared text editor);
- a world or persistence model beyond layouts and settings;
- a third-party module/plugin API;
- primitives for placing overlays in an external coordinate space, e.g. a VRChat world (around
  3.0);
- in-VR agent presence (`agent-viz`: agent text in the scene and a 3D pointer at the element being
  discussed). It falls out of the playtest scene-query actors, so those should be written with
  it in mind;
- a separate agent API such as MCP. That one is out permanently, not just deferred: agents use
  actors and `/create` like everything else.

## Architecture rule for 2.0 work

PetPlay is an **always-on service, and the SteamVR overlay is one client**, alongside the desktop
view and the headless agent client ([what PetPlay is](../what-petplay-is.md#an-always-on-service-with-clients)).
New work must not make the service depend on SteamVR. Existing places that do are bugs:

- scene extraction only runs inside the OpenVR overlay pump
  ([novr-desktop-view-receives-no-frames](../issues/novr-desktop-view-receives-no-frames/README.md));
- desktop capture/display panels are presented only as OpenVR overlays;
- the service's lifetime is hard-wired to SteamVR in places. How long it stays up should be a
  **policy setting**, not something the structure forces:
  - **with VR** (default for users): SteamVR start brings the service up, and SteamVR exit
    stops it. `utils/steamvr-watch.ts` already does this.
  - **at login** (option, and what the dev machine uses): always up, and SteamVR
    attaching/detaching is only a client event (the supervisor already re-attaches).

  Under either policy, SteamVR's auto-launch attaches to a running service or starts it.

## Tracks

| # | Track | Doc | Gist |
|---|---|---|---|
| 1 | Capture in-repo | [capture-in-repo.md](./capture-in-repo.md) | `screen-streamer` is a submodule; CI builds and embeds native helpers |
| 2 | Steam app | [steam-app.md](./steam-app.md) | persistent vrmanifest, auto-launch, packaging, then a Steam store app |
| 3 | Stability & performance | [stability-performance.md](./stability-performance.md) | soak tests, crash surface, frame budget, the known-gaps list |
| 4 | Basic UI/UX | [ui-ux-basics.md](./ui-ux-basics.md) | settings, first run, clean base environment, feedback |
| 5 | Agentic playtesting | [agentic-playtesting.md](./agentic-playtesting.md) | scripted VR sessions an agent can run, judge, and file issues from |
| 6 | XSOverlay parity | [xso-parity.md](./xso-parity.md) | feature checklist against the XSO extract |
| 7 | Stack update | [stack-update.md](./stack-update.md) | r3f v10 latest prerelease, three 0.186, rebase the xr/IWER forks |

Bugs and small tasks go in [`../issues/`](../issues/README.md) with a `Track:` line.

## Platforms

Full support for Linux, Windows and the Steam Frame (Linux ARM64), with more likely later.
**Priority is Linux:** that's where VR gets played every day, WayVR is buggy, XSOverlay doesn't
exist there, and PetPlay is still too unfinished and laggy to replace either. Windows and the Frame
have to keep building and get fixed along the way, but they don't set the order.

## Order

The first goal is a Linux daily driver. Everything else follows that.

- **First: lag and the daily-use gaps.** The lag is CPU-side, and it blocks daily use as much as
  missing features do. The stack update (7) comes first, then CPU optimization (3) against the
  new versions. Next comes the settings store (start of 4, the first
  item of 6), which nearly every other item needs.
- **Alongside: the agentic playtest harness (5).** It verifies changes without someone in the
  headset each time, and its soak runs feed stability. **All agentic work runs without SteamVR**,
  visual playtesting included, on the raythree render path. Fixing `--novr` captures is the
  first step.
- **Then: self-contained builds.** Capture in-repo (1) and the local vrmanifest/auto-launch half
  of track 2, with Windows and Frame builds from the same tree.
- **Last: the Steam store** (end of 2).

## Milestones

- **M1, Daily driver (Linux), = 2.0:** PetPlay replaces XSO/WayVR for the developer's own sessions. The
  stack is updated (7), CPU frame cost is driven down against a measured baseline, and the base
  environment is clean. It has a settings store and surface, pin/lock and saved layouts, wrist clock and battery,
  haptics, and toasts plus the XSO-compatible notification API. Capture reconnects on its own, and
  a 4-hour soak passes. Agents can playtest visually with SteamVR off.
- **M2, Self-contained (2.1):** one repo builds everything, including the capture helper, for Linux
  x86-64, Windows and Frame ARM64. `deno task build` produces a directory that runs with nothing
  else installed, and a persistent vrmanifest starts it with SteamVR. The agent harness runs a
  smoke playtest on every change.
- **M3, Shippable (2.1):** Steam Frame verified on hardware, first-run flow, the rest of the everyday XSO parity checklist, a Steam depot
  build, a store page and updates through Steam.

## Open questions

- Steam: free store app (Steamworks fee, review) or "non-Steam game" plus vrmanifest only for now?
- `petplay-ui` (`~/git/petplay-ui`, the Vite design sandbox): keep it as a sandbox, or fold it
  into the repo like capture?
- Analytics/crash reporting: opt-in crash upload, local-only logs, or nothing?

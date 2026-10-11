# Track 2: A proper SteamVR / Steam app

Two separate goals that often get conflated:

- **A. A SteamVR app.** It shows up in SteamVR's settings under *Startup / Shutdown → Choose
  startup overlay apps*, auto-launches with SteamVR, and is identified correctly. This needs no
  Steam store presence.
- **B. A Steam app.** It's installed and updated through Steam, and launching it from the
  library starts it (and SteamVR if needed). This needs a Steamworks app ID.

## Today

- `openVrRuntime.ts` (`identifyApplication`) writes a **temp** `.vrmanifest` on every start,
  registers it as temporary (`AddApplicationManifest(path, true)`) and calls
  `IdentifyApplication`. That makes SteamVR know who we are while running, but it can't
  auto-launch something it only learns about after launch.
- Linux auto-start currently comes from `deno task install:dev`: a systemd user unit running
  `utils/steamvr-watch.ts`, which watches for `vrserver`. It works, but it's dev-only and
  Linux-only.
- `deno task build` produces a single compiled binary that still expects a `.env` next to it and
  an `resources/` layout.

## Plan

### A. SteamVR app (early, M1)

1. Ship a **persistent** `petplay.vrmanifest` next to the build output with `app_key`,
   `launch_type: binary`, `binary_path_linux`/`binary_path_windows`, `is_dashboard_overlay: true`,
   image and strings. Register it permanently (`temporary = false`) from an installer step or the
   first run.
2. Set `SetApplicationAutoLaunch(app_key, true)` from a settings toggle. What SteamVR launches is
   a thin **attach** entry point: it connects the SteamVR overlay client to the running PetPlay
   service, and starts the service first if it isn't running. Quitting SteamVR detaches that
   client. Whether the service then stays up depends on the lifetime setting (item 4).
3. Handle the auto-launch lifecycle: SteamVR starts us before the compositor is fully up, and
   `VREvent_Quit` must be acked promptly with an ordered **detach** (not a shutdown) so SteamVR
   doesn't kill us.
4. Service lifetime, a setting with two values:
   - **with VR** (default): the service stops when SteamVR exits.
   - **start at login**: a systemd user service (Linux) or login item (Windows) keeps it up all
     the time. That's the dev machine setup.

   Either way, SteamVR exiting only detaches the overlay client first; whether the service then
   exits depends on this setting.
5. Make the build self-contained: no `.env` required, settings in `$XDG_CONFIG_HOME/petplay`
   (Windows: `%APPDATA%`), and native libs and the capture helper resolved relative to the
   executable.

### B. Steam store app (M3)

1. Decide on free vs paid and pay the Steamworks fee.
2. Depot layout: Linux x86-64, Windows x64, later Linux ARM64 for the Frame.
3. Steam launch options: "Launch PetPlay (VR)" plus a desktop-only option. The vrmanifest from A
   gets the Steam app ID (`steam.app.<id>` app key convention).
4. Store assets, the review checklist, and a build upload script (`steamcmd` + `app_build.vdf`)
   under `utils/`.
5. Updates through Steam replace the dev `git pull` flow for users.

## Done when

- A: on a clean machine, extract the build, run it once, tick "start with SteamVR", and it comes
  up with SteamVR from then on.
- B: install from the Steam library, launch, and it works.

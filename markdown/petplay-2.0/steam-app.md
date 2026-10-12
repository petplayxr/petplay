# Track 2: A proper SteamVR / Steam app

Two separate goals that often get conflated:

- **A. A SteamVR app.** It shows up in SteamVR's settings under *Startup / Shutdown → Choose
  startup overlay apps*, auto-launches with SteamVR, and is identified correctly. This needs no
  Steam store presence.
- **B. A Steam app.** It's installed and updated through Steam, and launching it from the
  library starts it (and SteamVR if needed). This needs a Steamworks app ID.

## Today

- **Part A, step 1 is done for dev checkouts.** `deno task steamvr:register` writes
  `petplay.vrmanifest`, `launch-petplay.sh` and `petplay.png` into
  `$XDG_DATA_HOME/petplay/steamvr/`, registers the manifest permanently and turns auto-launch on.
  `steamvr:unregister` undoes it and `steamvr:status` reports it. Code: `classes/steamVrManifest.ts`
  (pure, unit-tested) and `utils/steamvr-app.ts`.
  - With SteamVR running it goes through `IVRApplications` as a background app, which never
    starts SteamVR. With SteamVR stopped it edits `appconfig.json` and
    `vrappconfig/petplay.overlay.vrappconfig` directly, the same files SteamVR writes.
  - The manifest is `is_dashboard_overlay`, so PetPlay is listed under *Startup / Shutdown →
    Choose startup overlay apps*. Its binary and image paths are relative to the manifest, so a
    packaged build can ship the same three files next to its executable.
  - The launcher leaves SteamVR's pressure-vessel container with `steam-runtime-launch-client
    --alongside-steam` (as WayVR's does), logs to `~/.local/state/petplay/steamvr-launch.log`
    and runs `utils/steamvr-watch.ts --once`. That reuses a running server or starts one with
    `--openvr-attach-only`, stops the server it started when SteamVR exits, then exits itself.
  - Not yet tried against a real SteamVR. That needs checking at home: the app shows up in the
    startup list, the launch log shows the container escape, the server comes up, and SteamVR's
    quit stops it.
- `openVrRuntime.ts` (`identifyApplication`) still writes a **temp** `.vrmanifest` for the
  display overlay host (`petplay.display-overlay-host`). The main overlay doesn't identify itself
  as `petplay.overlay` yet, so SteamVR doesn't tie the running overlay to the registered app.
- The systemd dev install (`deno task install:dev`, `utils/steamvr-watch.ts` without `--once`)
  still works. It and the registration can both be installed without starting two servers, but
  one is enough. It also stays the way to get the "start at login" lifetime later.
- `deno task build` produces a single compiled binary that still expects a `.env` next to it and
  an `resources/` layout.

## Plan

### A. SteamVR app (early, M1)

1. ~~Ship a **persistent** `petplay.vrmanifest`~~ Done for checkouts (see Today); a build ships
   the same files. Original note: ship a **persistent** `petplay.vrmanifest` next to the build output with `app_key`,
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

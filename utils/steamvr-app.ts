#!/usr/bin/env -S deno run -A
/**
 * Registers this checkout with SteamVR as a permanent overlay app, so PetPlay
 * shows up under *Startup / Shutdown → Choose startup overlay apps* and SteamVR
 * starts it by itself.
 *
 * ```sh
 * deno task steamvr:register                    # register + auto-launch on
 * deno task steamvr:register -- --desktop       # ... with server flags
 * deno task steamvr:register -- --no-autolaunch # listed, but off until ticked
 * deno task steamvr:unregister
 * deno task steamvr:status
 * ```
 *
 * `register` writes `petplay.vrmanifest`, its launcher and image into
 * `$XDG_DATA_HOME/petplay/steamvr/` (see `classes/steamVrManifest.ts`), then:
 *
 * - with SteamVR running, registers through the OpenVR API as a background app
 *   (which never starts SteamVR);
 * - with SteamVR stopped, edits SteamVR's `appconfig.json` and the app's
 *   `vrappconfig` directly. SteamVR owns those files while it runs and rewrites
 *   them on exit, so this path refuses to run then.
 *
 * What SteamVR launches is `utils/steamvr-watch.ts --once`: it reuses a server
 * that is already running, or starts one, and stops the server it started when
 * SteamVR exits. Server flags after `register` are baked into the launcher.
 *
 * This replaces the systemd dev install (`deno task install:dev`) for the "with
 * VR" lifetime. Both can be installed at once without starting two servers, but
 * one is enough.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import * as OpenVR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { P } from "../submodules/OpenVR_TS_Bindings_Deno/pointers.ts";
import { stringToPointer } from "../submodules/OpenVR_TS_Bindings_Deno/utils.ts";
import { getOpenVrLibraryPath } from "../classes/nativeLibraryPaths.ts";
import { DEFAULT_STEAMVR_PROCESS_NAMES, steamVrRunning } from "../classes/steamVrProcess.ts";
import {
  appConfigListsManifest,
  appConfigWithManifest,
  appConfigWithoutManifest,
  buildSteamVrLauncher,
  buildSteamVrManifest,
  STEAMVR_APP_KEY,
  STEAMVR_IMAGE_FILE,
  STEAMVR_LAUNCHER_FILE,
  STEAMVR_MANIFEST_FILE,
  vrAppConfigAutoLaunch,
  vrAppConfigWithAutoLaunch,
} from "../classes/steamVrManifest.ts";

const LOG_PREFIX = "[steamvr-app]";

type Command = "register" | "unregister" | "status";

function help(): string {
  return [
    "steamvr-app — register PetPlay with SteamVR as a startup overlay app (Linux)",
    "",
    "usage: deno run -A utils/steamvr-app.ts <register|unregister|status>",
    "       [--no-autolaunch] [<server args…>]",
    "",
    "  register        write the manifest and launcher, register them, turn auto-launch on",
    "                  (server args are baked into the launcher)",
    "  unregister      turn auto-launch off and remove the registration and files",
    "  status          where the files are and what SteamVR has on record",
    "",
    "  --no-autolaunch register without ticking SteamVR's auto-launch toggle",
  ].join("\n");
}

function home(): string {
  const value = Deno.env.get("HOME")?.trim();
  if (!value) throw new Error("HOME is not set");
  return value;
}

/** Where the generated manifest, launcher and image live. */
function appDir(): string {
  const dataHome = Deno.env.get("XDG_DATA_HOME")?.trim() || join(home(), ".local", "share");
  return join(dataHome, "petplay", "steamvr");
}

function checkoutRoot(): string {
  return dirname(dirname(fromFileUrl(import.meta.url)));
}

/** Steam's own directory: native, the `~/.steam` link, or the Flatpak's. */
function steamConfigDir(): string | null {
  const candidates = [
    join(home(), ".local", "share", "Steam"),
    join(home(), ".steam", "steam"),
    join(home(), ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];
  for (const root of candidates) {
    try {
      if (Deno.statSync(join(root, "config")).isDirectory) return join(root, "config");
    } catch {
      // Not this one.
    }
  }
  return null;
}

function readText(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** Writes beside the target and renames, so SteamVR never reads half a file. */
function writeAtomic(path: string, text: string): void {
  Deno.mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.petplay-tmp`;
  Deno.writeTextFileSync(temp, text);
  Deno.renameSync(temp, path);
}

function steamVrUp(): boolean {
  return steamVrRunning(DEFAULT_STEAMVR_PROCESS_NAMES);
}

/**
 * IVRApplications from a background-app client: `VRApplication_Background`
 * fails instead of starting SteamVR, and no overlay or scene is created.
 * The client is never shut down — the process exits right after, which
 * sidesteps vrclient's Linux shutdown race (see `OpenVrRuntime`).
 */
function openApplications(): OpenVR.IVRApplications {
  if (!OpenVR.isInitialized() && !OpenVR.initializeOpenVR(getOpenVrLibraryPath())) {
    throw new Error("could not load the OpenVR library");
  }
  const error = P.Int32P<OpenVR.InitError>();
  OpenVR.VR_InitInternal(error, OpenVR.ApplicationType.VRApplication_Background);
  const initError = new Deno.UnsafePointerView(error).getInt32();
  if (initError !== OpenVR.InitError.VRInitError_None) {
    throw new Error(`OpenVR init failed: ${OpenVR.InitError[initError]}`);
  }
  const pointer = OpenVR.VR_GetGenericInterface(
    stringToPointer(OpenVR.IVRApplications_Version),
    error,
  );
  if (pointer == null) throw new Error("SteamVR has no IVRApplications interface");
  return new OpenVR.IVRApplications(pointer);
}

function checkApplicationError(what: string, error: OpenVR.ApplicationError): void {
  if (error !== OpenVR.ApplicationError.VRApplicationError_None) {
    throw new Error(`${what}: ${OpenVR.ApplicationError[error]}`);
  }
}

function writeAppFiles(serverArgs: readonly string[]): string {
  const dir = appDir();
  const root = checkoutRoot();
  Deno.mkdirSync(dir, { recursive: true });
  writeAtomic(
    join(dir, STEAMVR_MANIFEST_FILE),
    buildSteamVrManifest({ binaryPath: STEAMVR_LAUNCHER_FILE, imagePath: STEAMVR_IMAGE_FILE }),
  );
  const launcher = join(dir, STEAMVR_LAUNCHER_FILE);
  writeAtomic(
    launcher,
    buildSteamVrLauncher({
      workingDirectory: root,
      command: [
        Deno.execPath(),
        "run",
        "-A",
        "--env-file",
        join(root, "utils", "steamvr-watch.ts"),
        "--once",
        ...serverArgs,
      ],
    }),
  );
  Deno.chmodSync(launcher, 0o755);
  Deno.copyFileSync(join(root, "resources", "PetPlay.png"), join(dir, STEAMVR_IMAGE_FILE));
  console.log(
    `${LOG_PREFIX} wrote ${dir}/{${STEAMVR_MANIFEST_FILE},${STEAMVR_LAUNCHER_FILE},${STEAMVR_IMAGE_FILE}}`,
  );
  return join(dir, STEAMVR_MANIFEST_FILE);
}

function vrAppConfigPath(config: string): string {
  return join(config, "vrappconfig", `${STEAMVR_APP_KEY}.vrappconfig`);
}

function register(serverArgs: readonly string[], autoLaunch: boolean): number {
  const manifest = writeAppFiles(serverArgs);
  if (steamVrUp()) {
    const applications = openApplications();
    const added = applications.AddApplicationManifest(manifest, false);
    if (added !== OpenVR.ApplicationError.VRApplicationError_AppKeyAlreadyExists) {
      checkApplicationError("AddApplicationManifest", added);
    }
    checkApplicationError(
      "SetApplicationAutoLaunch",
      applications.SetApplicationAutoLaunch(STEAMVR_APP_KEY, autoLaunch),
    );
    console.log(`${LOG_PREFIX} registered with the running SteamVR`);
  } else {
    const config = steamConfigDir();
    if (config == null) throw new Error("no Steam config directory found; is Steam installed?");
    const appConfig = join(config, "appconfig.json");
    writeAtomic(appConfig, appConfigWithManifest(readText(appConfig), manifest));
    const vrAppConfig = vrAppConfigPath(config);
    writeAtomic(vrAppConfig, vrAppConfigWithAutoLaunch(readText(vrAppConfig), autoLaunch));
    console.log(`${LOG_PREFIX} added to ${appConfig}; SteamVR picks it up on its next start`);
  }
  console.log(
    [
      `${LOG_PREFIX} PetPlay is a SteamVR startup overlay app (${STEAMVR_APP_KEY})`,
      `  auto-launch   ${autoLaunch ? "on" : "off"} (SteamVR → Settings → Startup / Shutdown)`,
      `  server args   ${serverArgs.length > 0 ? serverArgs.join(" ") : "(none)"}`,
      `  launch log    ~/.local/state/petplay/steamvr-launch.log (the server's own log is in ./logs)`,
      `  remove        deno task steamvr:unregister`,
    ].join("\n"),
  );
  return 0;
}

function unregister(): number {
  const manifest = join(appDir(), STEAMVR_MANIFEST_FILE);
  if (steamVrUp()) {
    const applications = openApplications();
    if (applications.IsApplicationInstalled(STEAMVR_APP_KEY)) {
      applications.SetApplicationAutoLaunch(STEAMVR_APP_KEY, false);
    }
    const removed = applications.RemoveApplicationManifest(manifest);
    if (removed !== OpenVR.ApplicationError.VRApplicationError_None) {
      console.warn(`${LOG_PREFIX} RemoveApplicationManifest: ${OpenVR.ApplicationError[removed]}`);
    }
    console.log(`${LOG_PREFIX} unregistered from the running SteamVR`);
  } else {
    const config = steamConfigDir();
    if (config != null) {
      const appConfig = join(config, "appconfig.json");
      const text = readText(appConfig);
      if (appConfigListsManifest(text, manifest)) {
        writeAtomic(appConfig, appConfigWithoutManifest(text, manifest));
        console.log(`${LOG_PREFIX} removed from ${appConfig}`);
      }
      const vrAppConfig = vrAppConfigPath(config);
      const vrText = readText(vrAppConfig);
      if (vrText != null) writeAtomic(vrAppConfig, vrAppConfigWithAutoLaunch(vrText, false));
    }
  }
  try {
    Deno.removeSync(appDir(), { recursive: true });
    console.log(`${LOG_PREFIX} removed ${appDir()}`);
  } catch {
    // Never registered from here.
  }
  return 0;
}

function status(): number {
  const dir = appDir();
  const manifest = join(dir, STEAMVR_MANIFEST_FILE);
  const launcher = readText(join(dir, STEAMVR_LAUNCHER_FILE));
  const config = steamConfigDir();
  const appConfig = config == null ? null : readText(join(config, "appconfig.json"));
  const vrAppConfig = config == null ? null : readText(vrAppConfigPath(config));
  console.log(`app key       ${STEAMVR_APP_KEY}`);
  console.log(`files         ${readText(manifest) == null ? "(not written)" : dir}`);
  console.log(`launches      ${launcher?.match(/^command=\((.*)\)$/m)?.[1] ?? "(nothing)"}`);
  console.log(`steam config  ${config ?? "(not found)"}`);
  console.log(`registered    ${appConfigListsManifest(appConfig, manifest) ? "yes" : "no"}`);
  console.log(`auto-launch   ${vrAppConfigAutoLaunch(vrAppConfig) ? "on" : "off"}`);
  console.log(
    `steamvr       ${steamVrUp() ? "running (its unsaved changes are not shown)" : "stopped"}`,
  );
  return 0;
}

function main(): number {
  const args = [...Deno.args];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help());
    return 0;
  }
  if (Deno.build.os !== "linux") {
    console.error(`${LOG_PREFIX} Linux only for now: the launcher is a bash script.`);
    return 2;
  }
  const command = (args.shift() ?? "status") as Command;
  const autoLaunch = !args.includes("--no-autolaunch");
  const serverArgs = args.filter((arg) => arg !== "--no-autolaunch" && arg !== "--");
  switch (command) {
    case "register":
      return register(serverArgs, autoLaunch);
    case "unregister":
      return unregister();
    case "status":
      return status();
    default:
      console.error(`${LOG_PREFIX} unknown command "${command}"\n`);
      console.error(help());
      return 2;
  }
}

try {
  Deno.exit(main());
} catch (error) {
  console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : error}`);
  Deno.exit(1);
}

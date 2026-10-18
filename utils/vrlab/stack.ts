/**
 * Brings the synthetic VR stack up and down in the order that works:
 *
 * 1. the scoped lab SteamVR (`petplay-ovrdriver-lab.py`, Touch-compatible synthetic hands);
 * 2. the guarded keepalive overlay client, **as soon as vrcompositor exists**: a direct-launched
 *    vrserver exits about 17 s after start with no client, and PetPlay never starts SteamVR itself;
 * 3. a PetPlay server (scratch copies of the layout/settings unless told otherwise), waited on
 *    until its supervisor attaches;
 * 4. VRChat through Steam, waited on until it enters a world.
 *
 * `down` reverses it; the lab restores the SteamVR settings it changed when it exits.
 */
import { dirname, fromFileUrl, join } from "@std/path";
import { health, supervisorPhase } from "./petplay.ts";
import * as vrchat from "./vrchat.ts";
import { desktopEnv, pidsMatching, pidsNamed, sleep, waitFor } from "./util.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..", "..");
const LOG_DIR = join(ROOT, "logs", "vrlab");
const STATE_PATH = join(LOG_DIR, "state.json");
const LAB_RESTORE = join(ROOT, "logs", "ovrdriver-lab", "restore.json");
const CONFIG = `${Deno.env.get("HOME")}/.config/petplay`;

type StackState = { petplayPid?: number; startedAt?: string };

function readState(): StackState {
  try {
    return JSON.parse(Deno.readTextFileSync(STATE_PATH));
  } catch {
    return {};
  }
}

function writeState(state: StackState): void {
  Deno.mkdirSync(LOG_DIR, { recursive: true });
  Deno.writeTextFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Starts a long-lived child in its own session with output in `logs/vrlab/<log>`. Output goes to
 * the file directly, not a pipe: the children outlive this process.
 */
function spawnLogged(
  command: string,
  args: string[],
  log: string,
  env: Record<string, string> = {},
): number {
  Deno.mkdirSync(LOG_DIR, { recursive: true });
  const child = new Deno.Command("setsid", {
    args: [
      "sh",
      "-c",
      'log="$1"; shift; exec "$@" > "$log" 2>&1 < /dev/null',
      "sh",
      join(LOG_DIR, log),
      command,
      ...args,
    ],
    cwd: ROOT,
    env: { ...desktopEnv(), ...env },
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();
  return child.pid;
}

export function steamVrRunning(): boolean {
  return pidsNamed("vrserver").length > 0;
}

export function labRunning(): boolean {
  return pidsMatching("petplay-ovrdriver-lab.py", "run").length > 0;
}

export type UpOptions = {
  seconds?: number;
  /** Use the real ~/.config/petplay layout and settings instead of scratch copies. */
  realConfig?: boolean;
  vrchat?: boolean;
  /** Driver-direct backend, for `vrlab eye` (default on). */
  eyeCapture?: boolean;
  log?: (line: string) => void;
};

export async function up(options: UpOptions = {}): Promise<void> {
  const log = options.log ?? console.log;
  const state = readState();
  if (!labRunning()) {
    if (steamVrRunning()) {
      throw new Error("SteamVR is already running outside a lab; quit it first");
    }
    if (restorePending()) {
      throw new Error(
        `a previous lab left ${LAB_RESTORE}: run \`python3 utils/petplay-ovrdriver-lab.py recover\``,
      );
    }
    log("starting lab SteamVR (synthetic headset, Touch-compatible hands)");
    spawnLogged("python3", [
      "utils/petplay-ovrdriver-lab.py",
      "run",
      "--direct-server",
      "--x11-compositor",
      "--touch-controllers",
      // Driver-direct: the driver owns every layer's images, so `vrlab eye` can read back what
      // the synthetic headset is shown, VRChat and overlays alike.
      ...(options.eyeCapture === false ? [] : ["--driver-direct"]),
      "--seconds",
      String(options.seconds ?? 3600),
    ], "lab.log");
    await waitFor("vrcompositor", () => pidsNamed("vrcompositor").length > 0, 40_000, 200);
  }
  if (pidsMatching("petplay-ovrdriver-lab-probe.ts").length === 0) {
    log("connecting the keepalive client");
    spawnLogged("deno", [
      "run",
      "-A",
      "utils/petplay-ovrdriver-lab-probe.ts",
      `--hold-open=${options.seconds ?? 3600}`,
    ], "keepalive.log");
    await waitFor("the keepalive to hold the runtime", () => {
      try {
        return Deno.readTextFileSync(join(LOG_DIR, "keepalive.log")).includes("Holding guarded");
      } catch {
        return false;
      }
    }, 30_000);
  }
  if (await health() == null) {
    const env: Record<string, string> = {};
    if (!options.realConfig) {
      for (
        const [name, variable] of [["spatial-layout.json", "PETPLAY_SPATIAL_LAYOUT_PATH"], [
          "settings.json",
          "PETPLAY_SETTINGS_PATH",
        ]]
      ) {
        const copy = join(LOG_DIR, name);
        try {
          Deno.copyFileSync(join(CONFIG, name), copy);
        } catch {
          // No saved file yet: PetPlay starts from defaults.
        }
        env[variable] = copy;
      }
    }
    log(`starting PetPlay (${options.realConfig ? "real" : "scratch"} layout and settings)`);
    state.petplayPid = spawnLogged(
      "deno",
      [
        "run",
        "-A",
        "--unstable-webgpu",
        "--env-file",
        "--no-check",
        "petplay/petplay.ts",
        "dev",
        "--agent-repl",
        "--openvr-reattach",
      ],
      "petplay.log",
      env,
    );
    state.startedAt = new Date().toISOString();
    writeState(state);
    await waitFor("the PetPlay agent REPL", health, 90_000, 1_000);
  }
  await waitFor(
    "PetPlay to attach to SteamVR",
    async () => (await supervisorPhase()) === "attached",
    60_000,
    1_000,
  );
  log("PetPlay attached");
  if (options.vrchat !== false) {
    log("launching VRChat");
    log(`VRChat in a world (${await vrchat.launch()})`);
  }
}

/**
 * Order matters: vrserver will not exit while a client is connected, and a PetPlay server with
 * `--openvr-reattach` re-attaches right after `DETACHOPENVR`. So PetPlay is stopped, not detached.
 * A server this stack did not start is only stopped with `stopPetplay`; otherwise `down` refuses.
 */
export async function down(
  options: { stopPetplay?: boolean; log?: (line: string) => void } = {},
): Promise<void> {
  const log = options.log ?? console.log;
  if (vrchat.isRunning()) {
    log("quitting VRChat");
    await vrchat.quit();
  }
  const state = readState();
  const servers = pidsMatching("petplay/petplay.ts", "dev");
  const ours = state.petplayPid != null && servers.includes(state.petplayPid);
  if (servers.length > 0 && labRunning() && !ours && !options.stopPetplay) {
    throw new Error(
      `a PetPlay server this stack did not start is attached to the lab (pid ${
        servers.join(", ")
      }); ` +
        "stop it, or pass --stop-petplay",
    );
  }
  for (const pid of ours ? [state.petplayPid!] : options.stopPetplay ? servers : []) {
    log(`stopping PetPlay (pid ${pid})`);
    try {
      // A single-process SIGTERM shuts PetPlay down cleanly; a group signal does not.
      Deno.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    await waitFor(
      "PetPlay to exit",
      () => !pidsMatching("petplay/petplay.ts", "dev").includes(pid),
      30_000,
    ).catch(() => {});
  }
  delete state.petplayPid;
  writeState(state);
  for (const pid of pidsMatching("petplay-ovrdriver-lab-probe.ts")) Deno.kill(pid, "SIGTERM");
  for (const pid of pidsMatching("petplay-ovrdriver-lab.py", "run")) {
    if (Deno.readTextFileSync(`/proc/${pid}/comm`).trim().startsWith("python")) {
      log("stopping the lab (restores SteamVR settings)");
      Deno.kill(pid, "SIGINT");
    }
  }
  await waitFor("the lab to exit", () => !labRunning(), 60_000).catch(() => {});
  if (restorePending()) {
    // The lab gives up when SteamVR outlives its 15 s stop window; finish its job.
    for (const name of ["vrcompositor", "vrserver"]) {
      for (const pid of pidsNamed(name)) Deno.kill(pid, "SIGTERM");
    }
    await waitFor("SteamVR to exit", () => !steamVrRunning(), 30_000).catch(() => {});
    if (!steamVrRunning()) {
      const recover = await new Deno.Command("python3", {
        args: ["utils/petplay-ovrdriver-lab.py", "recover"],
        cwd: ROOT,
      }).output();
      log(
        new TextDecoder().decode(recover.stdout).trim() ||
          new TextDecoder().decode(recover.stderr).trim(),
      );
    }
  }
  log(
    restorePending()
      ? "lab settings NOT restored: stop SteamVR, then `python3 utils/petplay-ovrdriver-lab.py recover`"
      : "SteamVR settings restored",
  );
}

function restorePending(): boolean {
  try {
    Deno.statSync(LAB_RESTORE);
    return true;
  } catch {
    return false;
  }
}

export async function status(): Promise<Record<string, unknown>> {
  return {
    lab: labRunning(),
    steamvr: steamVrRunning(),
    keepalive: pidsMatching("petplay-ovrdriver-lab-probe.ts").length > 0,
    petplay: (await health()) != null ? await supervisorPhase() : "not running",
    vrchat: vrchat.isRunning() ? (vrchat.inWorld() ? "in world" : "starting") : "not running",
    oscQueryPort: vrchat.isRunning() ? vrchat.oscQueryPort() : null,
  };
}

/**
 * A fresh VRChat session (menus and camera closed, avatar at spawn) that is actually presenting.
 * Restarting VRChat on the driver-direct lab sometimes takes vrcompositor down with it (SIGSEGV
 * in RADV right after the scene app exits; first seen 2026-10-18). When the compositor is gone
 * or VRChat never presents, the whole stack is restarted once, which also launches VRChat.
 * Recoveries are appended to `logs/vrlab/recoveries.log`.
 */
export async function freshVrchat(options: { log?: (line: string) => void } = {}): Promise<void> {
  const log = options.log ?? console.log;
  const { SyntheticDriver } = await import("./driver.ts");
  const { waitForScenePresent } = await import("./eye.ts");
  const presenting = async () => {
    if (pidsNamed("vrcompositor").length === 0) return "vrcompositor is not running";
    const driver = await SyntheticDriver.attach();
    try {
      await waitForScenePresent(driver, 120_000);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      driver.close();
    }
  };
  log("restarting VRChat");
  await vrchat.restart();
  const problem = await presenting();
  if (!problem) return;
  const line = `${
    new Date().toISOString()
  } after a VRChat restart: ${problem}; restarting the lab stack`;
  Deno.mkdirSync(LOG_DIR, { recursive: true });
  Deno.writeTextFileSync(join(LOG_DIR, "recoveries.log"), line + "\n", { append: true });
  log(line);
  await down({ log });
  await up({ log });
  const again = await presenting();
  if (again) throw new Error(`VRChat is still not presenting after a stack restart: ${again}`);
}

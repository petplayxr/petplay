#!/usr/bin/env -S deno run -A --env-file
/**
 * SteamVR-following launcher: PetPlay comes up when SteamVR comes up, and goes
 * away when SteamVR goes away.
 *
 * `deno task install:dev` runs this as a systemd **user** service so a checkout
 * behaves like a SteamVR companion app with no terminal attached; running it by
 * hand does the same thing in the foreground.
 *
 * Presence is a *process* watch (`vrserver`, the runtime server itself), not an
 * OpenVR probe: `VR_IsRuntimeInstalled` stays true for a SteamVR launcher that
 * is not running, so a probe would keep a server alive forever, polling a
 * runtime that is not there. The runtime process is also the signal that
 * actually matches the lifetime being followed.
 *
 * The server itself already survives SteamVR coming and going — `main`
 * supervises attach/detach and keeps the scene running through both. This
 * launcher is only about the *process* lifetime, which is what a dev install
 * wants: no idle server holding the REPL port and the OpenVR library while the
 * headset is off.
 *
 * ```sh
 * deno run -A --env-file utils/steamvr-watch.ts                 # follow SteamVR
 * deno run -A --env-file utils/steamvr-watch.ts --desktop       # + desktop control
 * deno run -A --env-file utils/steamvr-watch.ts --poll-ms=500   # tighter watch
 * ```
 *
 * Arguments it does not recognise are forwarded to the server, so every server
 * flag (`--novr`, `--desktop`, `--keyboard-locale=fi`, `--agent-repl-port=…`)
 * works here exactly as it does with `deno task server`.
 */
import { getAgentReplBaseUrl, getAgentReplPort, wait } from "../classes/utils.ts";
import {
  isServerProcess,
  serverHealth,
  startServer,
  stopServerProcess,
} from "../petplay/serverProcess.ts";

const LOG_PREFIX = "[steamvr-watch]";

/** The runtime server; SteamVR is up while it runs and gone when it exits. */
const DEFAULT_STEAMVR_PROCESSES = ["vrserver"] as const;
const DEFAULT_POLL_MS = 2_000;

type Options = {
  /** How often the process table is scanned, in milliseconds. */
  pollMs: number;
  /** Process names that mean "SteamVR is up". */
  processes: string[];
  /** Everything else, forwarded to the server. */
  serverArgs: string[];
};

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    pollMs: DEFAULT_POLL_MS,
    processes: [...DEFAULT_STEAMVR_PROCESSES],
    serverArgs: [],
  };
  for (const arg of args) {
    const poll = arg.match(/^--poll-ms=(\d+)$/);
    if (poll != null) {
      options.pollMs = Math.max(1, Number(poll[1]));
      continue;
    }
    const process = arg.match(/^--steamvr-process=(.+)$/);
    if (process != null) {
      options.processes = process[1]
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      continue;
    }
    // The launcher re-adds the REPL flags, so a forwarded copy would duplicate them.
    if (arg === "--agent-repl" || arg.startsWith("--agent-repl-port=")) {
      continue;
    }
    options.serverArgs.push(arg);
  }
  return options;
}

function help(): string {
  return [
    "steamvr-watch — run PetPlay for exactly as long as SteamVR runs",
    "",
    "usage: deno run -A --env-file utils/steamvr-watch.ts [--poll-ms=<n>]",
    "       [--steamvr-process=<name>[,<name>…]] [<server args…>]",
    "",
    "  --poll-ms=<n>          scan interval, default 2000",
    "  --steamvr-process=     process names that mean SteamVR is up, default vrserver",
    "",
    "Any other argument goes to the server (`--novr`, `--desktop`,",
    "`--keyboard-locale=fi`, `--agent-repl-port=<n>`, …). A server already",
    "running on the REPL port is left alone — this launcher only stops what it",
    "started. Linux only: the watch reads /proc.",
  ].join("\n");
}

/** Whether a process named one of `names` — its executable — is in the process table. */
function steamVrRunning(names: readonly string[]): boolean {
  const matches = (name: string): boolean =>
    names.some((candidate) => candidate === name || candidate.slice(0, 15) === name);
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    // `/proc/<pid>/comm` is the cheap read, but it truncates to 15 characters, so
    // a longer name only ever matches through the executable the process runs.
    try {
      if (matches(Deno.readTextFileSync(`/proc/${entry.name}/comm`).trim())) return true;
    } catch {
      continue; // Gone between the listing and the read.
    }
    try {
      const exe = Deno.readLinkSync(`/proc/${entry.name}/exe`).replace(/ \(deleted\)$/, "");
      if (matches(exe.split("/").pop() ?? "")) return true;
    } catch {
      // Another user's process, or gone: `comm` was all there was to ask.
    }
  }
  return false;
}

/**
 * Follows SteamVR: starts a server on the rising edge, stops its own on the
 * falling edge, and exits when told to.
 */
class SteamVrFollower {
  #options: Options;
  /** SteamVR was up as of the last poll. */
  #steamVrUp = false;
  /** The server this launcher started, if any; never a server it found running. */
  #serverPid: number | null = null;
  #stopping = false;

  constructor(options: Options) {
    this.#options = options;
  }

  async run(): Promise<void> {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      Deno.addSignalListener(signal, () => {
        // Stop first: the server's cleanup is what releases the OpenVR runtime
        // and the overlay. Re-issued signals are ignored while it runs.
        this.stop(signal).finally(() => Deno.exit(0));
      });
    }
    console.log(
      `${LOG_PREFIX} following ${
        this.#options.processes.join("/")
      } every ${this.#options.pollMs}ms` +
        (this.#options.serverArgs.length > 0
          ? `; server args=[${this.#options.serverArgs.join(" ")}]`
          : ""),
    );
    while (true) {
      const steamVrUp = steamVrRunning(this.#options.processes);
      if (steamVrUp && !this.#steamVrUp) {
        await this.start();
      } else if (!steamVrUp && this.#steamVrUp) {
        await this.stop("SteamVR exited");
      } else if (steamVrUp) {
        this.reapExitedServer();
      }
      this.#steamVrUp = steamVrUp;
      await wait(this.#options.pollMs);
    }
  }

  /** SteamVR appeared: adopt nothing, start a server unless one already runs here. */
  async start(): Promise<void> {
    console.log(`${LOG_PREFIX} SteamVR is up`);
    if (await serverHealth() != null) {
      // Someone else's server (a hand-started `deno task server`, another
      // checkout). Owning it would mean killing work this launcher did not start.
      console.log(
        `${LOG_PREFIX} a server already answers on ${getAgentReplBaseUrl()}; leaving it alone`,
      );
      return;
    }
    const { pid, ready } = await startServer(this.#options.serverArgs);
    this.#serverPid = pid;
    if (!ready) {
      console.warn(`${LOG_PREFIX} server pid=${pid} did not answer within the start timeout`);
      return;
    }
    console.log(`${LOG_PREFIX} server pid=${pid} ready on port ${getAgentReplPort()}`);
  }

  /** SteamVR went away, or this launcher is shutting down: stop our server. */
  async stop(reason: string): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    const pid = this.#serverPid;
    this.#serverPid = null;
    if (pid == null) {
      console.log(`${LOG_PREFIX} ${reason}: no server of ours was running`);
      return;
    }
    if (!isServerProcess(pid)) {
      console.log(`${LOG_PREFIX} ${reason}: server pid=${pid} had already exited`);
      return;
    }
    console.log(`${LOG_PREFIX} ${reason}: stopping server pid=${pid}`);
    await stopServerProcess(pid, (message) => console.warn(`${LOG_PREFIX} ${message}`));
    console.log(`${LOG_PREFIX} server pid=${pid} stopped`);
  }

  /**
   * A server that dies while SteamVR stays up is a bug, not a state to paper
   * over with a restart loop: report it and forget the pid, so the next rising
   * edge starts a fresh one.
   */
  reapExitedServer(): void {
    const pid = this.#serverPid;
    if (pid == null || isServerProcess(pid)) return;
    console.warn(`${LOG_PREFIX} server pid=${pid} exited while SteamVR is up; not restarting it`);
    this.#serverPid = null;
  }
}

if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
  console.log(help());
  Deno.exit(0);
}
if (Deno.build.os !== "linux") {
  console.error(
    `${LOG_PREFIX} Linux only: the SteamVR watch reads /proc for the runtime process.`,
  );
  Deno.exit(2);
}

await new SteamVrFollower(parseArgs(Deno.args)).run();

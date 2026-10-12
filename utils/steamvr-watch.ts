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
 * deno run -A --env-file utils/steamvr-watch.ts --once          # one SteamVR session
 * ```
 *
 * `--once` is what SteamVR's own auto-launch runs (`deno task steamvr:register`):
 * follow the SteamVR session that launched it, then exit with it instead of
 * waiting for the next one. If SteamVR never shows up it gives up after
 * [ONCE_STARTUP_GRACE_MS].
 *
 * Arguments it does not recognise are forwarded to the server, so every server
 * flag (`--novr`, `--desktop`, `--keyboard-locale=fi`, `--agent-repl-port=…`)
 * works here exactly as it does with `deno task server`.
 */
import { getAgentReplBaseUrl, getAgentReplPort, wait } from "../classes/utils.ts";
import {
  DEFAULT_STEAMVR_PROCESS_NAMES,
  OPENVR_ATTACH_ONLY_ARG,
  steamVrRunning,
} from "../classes/steamVrProcess.ts";
import {
  isServerProcess,
  serverHealth,
  startServer,
  stopServerProcess,
} from "../petplay/serverProcess.ts";

const LOG_PREFIX = "[steamvr-watch]";

/** The runtime server; SteamVR is up while it runs and gone when it exits. */
const DEFAULT_POLL_MS = 2_000;
/** How long `--once` waits for SteamVR before deciding it was not launched by it. */
const ONCE_STARTUP_GRACE_MS = 60_000;

type Options = {
  /** How often the process table is scanned, in milliseconds. */
  pollMs: number;
  /** Process names that mean "SteamVR is up". */
  processes: string[];
  /** Follow one SteamVR session, then exit. */
  once: boolean;
  /** Everything else, forwarded to the server. */
  serverArgs: string[];
};

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    pollMs: DEFAULT_POLL_MS,
    processes: [...DEFAULT_STEAMVR_PROCESS_NAMES],
    once: false,
    serverArgs: [],
  };
  for (const arg of args) {
    const poll = arg.match(/^--poll-ms=(\d+)$/);
    if (poll != null) {
      options.pollMs = Math.max(1, Number(poll[1]));
      continue;
    }
    if (arg === "--once") {
      options.once = true;
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
    "       [--steamvr-process=<name>[,<name>…]] [--once] [<server args…>]",
    "",
    "  --poll-ms=<n>          scan interval, default 2000",
    "  --steamvr-process=     process names that mean SteamVR is up, default vrserver",
    "  --once                 exit when SteamVR does (what SteamVR's auto-launch runs)",
    "",
    "Any other argument goes to the server (`--novr`, `--desktop`,",
    "`--keyboard-locale=fi`, `--agent-repl-port=<n>`, …). A server already",
    "running on the REPL port is left alone — this launcher only stops what it",
    "started. Linux only: the watch reads /proc.",
  ].join("\n");
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
          : "") +
        (this.#options.once ? "; once" : ""),
    );
    const startedAt = performance.now();
    while (true) {
      const steamVrUp = steamVrRunning(this.#options.processes);
      if (steamVrUp && !this.#steamVrUp) {
        await this.start();
      } else if (!steamVrUp && this.#steamVrUp) {
        await this.stop("SteamVR exited");
        if (this.#options.once) return;
        this.#stopping = false;
      } else if (!steamVrUp && this.#options.once) {
        if (performance.now() - startedAt > ONCE_STARTUP_GRACE_MS) {
          console.warn(`${LOG_PREFIX} SteamVR did not come up within ${ONCE_STARTUP_GRACE_MS}ms`);
          return;
        }
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
    // OpenVR initialization can launch SteamVR. The follower must only attach to
    // the instance that caused this rising edge, never create its own replacement.
    const serverArgs = this.#options.serverArgs.includes(OPENVR_ATTACH_ONLY_ARG)
      ? this.#options.serverArgs
      : [...this.#options.serverArgs, OPENVR_ATTACH_ONLY_ARG];
    const { pid, ready } = await startServer(serverArgs);
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
// Only `--once` returns; the signal listeners would otherwise keep the process alive.
Deno.exit(0);

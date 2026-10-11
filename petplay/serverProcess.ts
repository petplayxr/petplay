/**
 * Server lifecycle: how a shell tool finds, starts and stops the long-lived
 * `petplay/petplay.ts` server (`deno task server`).
 *
 * The client CLI (`petplay/client.ts`) and the SteamVR launcher
 * (`utils/steamvr-watch.ts`) both manage a server, and both have to resolve its
 * port and recognise its process exactly like the server does —
 * `--agent-repl-port=<n>`, then `PETPLAY_AGENT_REPL_PORT`, then 3987.
 *
 * Functions report; callers print. `stopServerProcess` takes a logger because it
 * is the one place that has something to say while the caller is blocked.
 */
import {
  DEFAULT_AGENT_REPL_PORT,
  fetchAgentReplJson,
  getAgentReplPort,
  wait,
} from "../classes/utils.ts";

/** How long a start waits for the REPL to answer before reporting failure. */
export const SERVER_READY_TIMEOUT_MS = 90_000;
/** How long a stop waits for SIGTERM to be honoured before escalating to SIGKILL. */
export const SERVER_STOP_TIMEOUT_MS = 20_000;

/** The server's `main` actor registers itself in `/health`, so a `main` means "ours". */
export type ServerHealth = {
  ok?: boolean;
  port?: number;
  actors?: Record<string, string>;
};

/** A running server, found through `/proc` because the REPL health carries no pid. */
export type ServerProcess = { pid: number; args: string[]; viaLauncher: boolean };

/** Receives progress notices that would otherwise have to be buffered until the call returns. */
export type ServerLogger = (message: string) => void;

export async function serverHealth(): Promise<ServerHealth | null> {
  try {
    const health = await fetchAgentReplJson<ServerHealth>("/health");
    return health.ok === true ? health : null;
  } catch {
    return null;
  }
}

/** `utils/dev-runner.ts` is a server launcher, `petplay/petplay.ts` the server itself. */
const SERVER_SCRIPT_MARKERS = ["utils/dev-runner.ts", "petplay/petplay.ts"] as const;

/** Command line of a process, split into arguments (`null` when it is gone or unreadable). */
function readCmdline(pid: number): string[] | null {
  try {
    return new TextDecoder()
      .decode(Deno.readFileSync(`/proc/${pid}/cmdline`))
      .split("\0")
      .filter((arg) => arg.length > 0);
  } catch {
    return null;
  }
}

/**
 * True while `pid` still is a PetPlay server (the server or its `dev-runner`
 * launcher). Checks the command line, not just liveness, so a recycled pid is
 * never mistaken for ours. `false` on any non-Linux host, which has no `/proc`.
 */
export function isServerProcess(pid: number): boolean {
  const args = readCmdline(pid);
  return args != null &&
    args.some((arg) => SERVER_SCRIPT_MARKERS.some((marker) => arg.endsWith(marker)));
}

/**
 * Waits until `pid` is gone, not just until its REPL stops answering. The REPL
 * dies early in shutdown, while the process still runs its actor teardown,
 * `EXIT_STABILIZE_MS`, and finally `destroyTemp()` — which would delete the
 * `./tmp` a freshly started server has already created. Only the pid going away
 * means its resources (OpenVR, tmp) are released. `true` on non-Linux, where
 * `/proc` is unavailable and nothing can be observed.
 */
async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (!isServerProcess(pid)) {
      return true;
    }
    await wait(100);
  }
  return !isServerProcess(pid);
}

/**
 * Finds the server for `port`. Prefers the `utils/dev-runner.ts` launcher, which
 * turns one SIGTERM into a cooperative shutdown of the server it spawned; falls
 * back to a directly launched server. `args` are the launcher's own extra
 * arguments, so a reboot keeps `--novr`, debug flags, locale overrides and the
 * like.
 */
export function findServerProcess(port: number): ServerProcess | null {
  if (Deno.build.os !== "linux") {
    return null;
  }
  // A server is ours if it was told this port, or if neither side names one and
  // both therefore run on the default.
  let launcher: ServerProcess | null = null;
  let direct: ServerProcess | null = null;
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name)) {
      continue;
    }
    const pid = Number(entry.name);
    if (pid === Deno.pid) {
      continue;
    }
    const args = readCmdline(pid);
    if (args == null) {
      continue;
    }
    const portFlag = args.find((arg) => arg.startsWith("--agent-repl-port="));
    const explicitPort = portFlag == null ? null : Number(portFlag.split("=", 2)[1]);
    if (explicitPort !== port && !(explicitPort == null && port === DEFAULT_AGENT_REPL_PORT)) {
      continue;
    }
    const scriptIndex = args.findIndex((arg) =>
      SERVER_SCRIPT_MARKERS.some((marker) => arg.endsWith(marker))
    );
    if (scriptIndex < 0) {
      continue;
    }
    const viaLauncher = args[scriptIndex]!.endsWith("dev-runner.ts");
    // Everything after the script is forwarded to PetPlay; the REPL flags are
    // re-added by the launcher, so they are dropped to avoid duplicating them.
    const extra = args.slice(scriptIndex + 1).filter((arg) =>
      arg !== "--agent-repl" && !arg.startsWith("--agent-repl-port")
    );
    const found: ServerProcess = { pid, args: extra, viaLauncher };
    if (viaLauncher) {
      launcher ??= found;
    } else {
      direct ??= found;
    }
  }
  return launcher ?? direct;
}

/** SIGTERM, then SIGKILL if the process has not exited, and wait for it. */
export async function stopServerProcess(
  pid: number,
  log: ServerLogger = () => {},
): Promise<void> {
  try {
    Deno.kill(pid, "SIGTERM");
  } catch (error) {
    log(`SIGTERM ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (await waitForProcessExit(pid, SERVER_STOP_TIMEOUT_MS)) {
    return;
  }
  log(`pid=${pid} did not exit within ${SERVER_STOP_TIMEOUT_MS}ms; SIGKILL`);
  try {
    Deno.kill(pid, "SIGKILL");
  } catch (error) {
    log(`SIGKILL ${pid}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await waitForProcessExit(pid, 5_000);
}

export type ServerStartResult = { pid: number; ready: boolean };

/**
 * Starts a detached server (`deno task server` equivalent) and waits for its
 * REPL, up to [SERVER_READY_TIMEOUT_MS]. Through `utils/dev-runner.ts`: it
 * mirrors the server's output to `logs/` (which is what survives a native FFI
 * crash) and gives it its own process group, so the caller can exit without
 * taking the server down.
 */
export async function startServer(extraArgs: string[] = []): Promise<ServerStartResult> {
  const port = getAgentReplPort();
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "utils/dev-runner.ts",
      "--agent-repl",
      `--agent-repl-port=${port}`,
      ...extraArgs,
    ],
    cwd: Deno.cwd(),
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  child.unref();
  const deadline = performance.now() + SERVER_READY_TIMEOUT_MS;
  while (performance.now() < deadline) {
    if (await serverHealth() != null) {
      return { pid: child.pid, ready: true };
    }
    await wait(500);
  }
  return { pid: child.pid, ready: false };
}

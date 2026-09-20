#!/usr/bin/env -S deno run -A
/**
 * Installs the checkout as a SteamVR-following **dev install**: a systemd user
 * service running `utils/steamvr-watch.ts`, so PetPlay comes up when SteamVR
 * comes up and goes away when SteamVR goes away, with no terminal attached.
 *
 * ```sh
 * deno task install:dev                    # server follows SteamVR
 * deno task install:dev -- --desktop       # ... and the desktop control surface
 * deno task uninstall:dev
 * ```
 *
 * The unit is a *user* unit (no root, no system unit): SteamVR runs inside the
 * graphical session, and the desktop surfaces open windows there, so it is
 * ordered after `graphical-session.target` and part of it.
 *
 * Server flags after the command word are written into `ExecStart`, which is why
 * the watcher has to be re-installed to change them. Runtime knobs that are not
 * flags (`PETPLAY_AGENT_REPL_PORT`, `PETPLAY_KEYBOARD_LOCALE`, …) belong in the
 * checkout's `.env`, which both the watcher and the server load.
 */
import { dirname, fromFileUrl, join } from "@std/path";

const LOG_PREFIX = "[dev-install]";
/** One dev install per machine: two checkouts would fight over the same SteamVR overlays. */
const UNIT_NAME = "petplay-dev.service";

type Command = "install" | "uninstall" | "status";

function help(): string {
  return [
    "dev-install — run PetPlay for exactly as long as SteamVR runs (Linux, systemd)",
    "",
    "usage: deno run -A utils/dev-install.ts <install|uninstall|status> [--force] [<server args…>]",
    "",
    "  install    write the user unit and `systemctl --user enable --now` it",
    "             (server args are baked into ExecStart)",
    "  uninstall  stop, disable and delete the unit",
    "  status     unit path, whether it is loaded, and the command it runs",
    "",
    "  --force    replace a unit that belongs to a different checkout",
  ].join("\n");
}

function unitPath(): string {
  const configHome = Deno.env.get("XDG_CONFIG_HOME")?.trim();
  const home = Deno.env.get("HOME")?.trim();
  const base = configHome && configHome.length > 0
    ? configHome
    : home && home.length > 0
    ? join(home, ".config")
    : null;
  if (base == null) {
    throw new Error("neither XDG_CONFIG_HOME nor HOME is set");
  }
  return join(base, "systemd", "user", UNIT_NAME);
}

/** The checkout this installer belongs to, from the script's own location. */
function checkoutRoot(): string {
  return dirname(dirname(fromFileUrl(import.meta.url)));
}

/**
 * systemd splits `ExecStart` on whitespace but honours quoting and backslash
 * escapes inside double quotes; `%` is a specifier there, not a literal.
 */
function systemdQuote(arg: string): string {
  const escaped = arg.replaceAll("%", "%%");
  if (!/[\s"'\\]/.test(escaped)) {
    return escaped;
  }
  return `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unitFile(execArgs: readonly string[]): string {
  const root = checkoutRoot();
  const deno = Deno.execPath();
  const watch = fromFileUrl(new URL("./steamvr-watch.ts", import.meta.url));
  const execStart = [
    deno,
    "run",
    "-A",
    "--env-file",
    watch,
    ...execArgs,
  ].map(systemdQuote).join(" ");
  return [
    "[Unit]",
    "Description=PetPlay dev session (starts and stops with SteamVR)",
    "# SteamVR lives in the graphical session, and the desktop surfaces open windows there,",
    "# so the unit needs that session's environment (WAYLAND_DISPLAY, XDG_RUNTIME_DIR) and",
    "# must not outlive it.",
    "After=graphical-session.target",
    "PartOf=graphical-session.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdQuote(root)}`,
    `ExecStart=${execStart}`,
    "Restart=on-failure",
    "RestartSec=2",
    "# The watcher forwards SIGTERM to the server, which tears its actors down before exiting.",
    "# Give that teardown room instead of SIGKILLing an overlay mid-detach.",
    "TimeoutStopSec=45",
    "",
    "[Install]",
    "WantedBy=graphical-session.target",
    "",
  ].join("\n");
}

async function systemctl(
  args: readonly string[],
  mode: "inherit" | "capture",
): Promise<{ code: number; stdout: string }> {
  const command = new Deno.Command("systemctl", {
    args: ["--user", ...args],
    // `.output()` requires piped streams; inherited output comes back as no text.
    stdout: mode === "inherit" ? "inherit" : "piped",
    stderr: mode === "inherit" ? "inherit" : "null",
  });
  try {
    if (mode === "capture") {
      const output = await command.output();
      return { code: output.code, stdout: new TextDecoder().decode(output.stdout).trim() };
    }
    const status = await command.spawn().status;
    return { code: status.code, stdout: "" };
  } catch (error) {
    throw new Error(
      `could not run systemctl --user ${args.join(" ")}: ` +
        `${error instanceof Error ? error.message : String(error)}` +
        " (a dev install needs a systemd user session)",
    );
  }
}

/** The checkout a written unit belongs to, so two installs cannot silently fight. */
function unitRootOf(text: string): string | null {
  const match = text.match(/^WorkingDirectory=(.*)$/m);
  return match?.[1].replace(/^"|"$/g, "") ?? null;
}

async function readUnit(): Promise<string | null> {
  try {
    return await Deno.readTextFile(unitPath());
  } catch {
    return null;
  }
}

async function install(execArgs: readonly string[], force: boolean): Promise<number> {
  const path = unitPath();
  const root = checkoutRoot();
  const existing = await readUnit();
  const existingRoot = existing == null ? null : unitRootOf(existing);
  if (existing != null && existingRoot !== root && !force) {
    throw new Error(
      `${path} already installs ${existingRoot ?? "an unknown checkout"};\n` +
        `  run \`deno task uninstall:dev\` there, or re-run with --force`,
    );
  }
  const text = unitFile(execArgs);
  if (existing === text) {
    console.log(`${LOG_PREFIX} ${path} is already up to date`);
  } else {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, text);
    console.log(`${LOG_PREFIX} wrote ${path}`);
  }
  await systemctl(["daemon-reload"], "inherit");
  const enabled = await systemctl(["enable", "--now", UNIT_NAME], "inherit");
  if (enabled.code !== 0) {
    return enabled.code;
  }
  console.log(
    [
      `${LOG_PREFIX} installed: PetPlay now starts and stops with SteamVR`,
      `  server args   ${execArgs.length > 0 ? execArgs.join(" ") : "(none)"}`,
      `  state         journalctl --user -u ${UNIT_NAME} -f   (the server's own log is in ./logs)`,
      `  control       systemctl --user status ${UNIT_NAME}`,
      `  remove        deno task uninstall:dev`,
    ].join("\n"),
  );
  return 0;
}

async function uninstall(): Promise<number> {
  const path = unitPath();
  const existing = await readUnit();
  if (existing == null) {
    console.log(`${LOG_PREFIX} no unit at ${path}`);
  }
  // `disable --now` on a unit that was never enabled is an error worth ignoring:
  // the file is what makes the install, and it is about to go away.
  const disabled = await systemctl(["disable", "--now", UNIT_NAME], "capture");
  if (disabled.code !== 0 && existing != null) {
    console.warn(`${LOG_PREFIX} systemctl disable --now ${UNIT_NAME}: ${disabled.stdout}`);
  }
  try {
    await Deno.remove(path);
    console.log(`${LOG_PREFIX} removed ${path}`);
  } catch {
    // Already gone.
  }
  await systemctl(["daemon-reload"], "inherit");
  console.log(`${LOG_PREFIX} uninstalled`);
  return 0;
}

async function status(): Promise<number> {
  const path = unitPath();
  const existing = await readUnit();
  const execStart = existing?.match(/^ExecStart=(.*)$/m)?.[1] ?? "(not installed)";
  const [active, enabled] = await Promise.all([
    systemctl(["is-active", UNIT_NAME], "capture"),
    systemctl(["is-enabled", UNIT_NAME], "capture"),
  ]);
  console.log(`unit      ${path}`);
  console.log(`state     ${active.stdout || "unknown"} / ${enabled.stdout || "unknown"}`);
  console.log(`exec      ${execStart}`);
  return 0;
}

async function main(): Promise<number> {
  const args = [...Deno.args];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help());
    return 0;
  }
  const command = (args.shift() ?? "status") as Command;
  if (command !== "install" && command !== "uninstall" && command !== "status") {
    console.error(`${LOG_PREFIX} unknown command "${command}"\n`);
    console.error(help());
    return 2;
  }
  const force = args.includes("--force");
  const execArgs = args.filter((arg) => arg !== "--force" && arg !== "--");
  switch (command) {
    case "install":
      return await install(execArgs, force);
    case "uninstall":
      return await uninstall();
    case "status":
      return await status();
  }
}

try {
  Deno.exit(await main());
} catch (error) {
  console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : error}`);
  Deno.exit(1);
}

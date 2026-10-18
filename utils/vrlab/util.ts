export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(
  what: string,
  probe: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (performance.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await sleep(intervalMs);
  }
}

/** Live PIDs whose `comm` is exactly `name` (zombies excluded). */
export function pidsNamed(name: string): number[] {
  const found: number[] = [];
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name)) continue;
    try {
      const stat = Deno.readTextFileSync(`/proc/${entry.name}/stat`);
      const comm = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
      const status = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
      if (comm === name && status !== "Z") found.push(Number(entry.name));
    } catch {
      // The process exited while we looked.
    }
  }
  return found;
}

/** PIDs whose full command line contains every fragment; never the caller itself. */
export function pidsMatching(...fragments: string[]): number[] {
  const found: number[] = [];
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name) || Number(entry.name) === Deno.pid) continue;
    try {
      const cmdline = Deno.readTextFileSync(`/proc/${entry.name}/cmdline`).replaceAll("\0", " ");
      if (fragments.every((fragment) => cmdline.includes(fragment))) found.push(Number(entry.name));
    } catch {
      // The process exited while we looked.
    }
  }
  return found;
}

/** The desktop session's X/Wayland/DBus variables, taken from the running Steam client. */
export function desktopEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pid of pidsNamed("steam")) {
    try {
      for (const entry of Deno.readTextFileSync(`/proc/${pid}/environ`).split("\0")) {
        const [key, ...rest] = entry.split("=");
        if (
          [
            "DISPLAY",
            "XAUTHORITY",
            "XDG_RUNTIME_DIR",
            "WAYLAND_DISPLAY",
            "DBUS_SESSION_BUS_ADDRESS",
          ].includes(key)
        ) {
          env[key] = rest.join("=");
        }
      }
      if (env.DISPLAY) return env;
    } catch {
      // Try the next Steam process.
    }
  }
  if (Deno.env.get("DISPLAY")) {
    return { DISPLAY: Deno.env.get("DISPLAY")!, XAUTHORITY: Deno.env.get("XAUTHORITY") ?? "" };
  }
  throw new Error("no desktop session found (Steam not running and DISPLAY unset)");
}

/** Linux process-table helpers shared by the SteamVR follower and OpenVR actor. */

export const DEFAULT_STEAMVR_PROCESS_NAMES = ["vrserver"] as const;
export const OPENVR_ATTACH_ONLY_ARG = "--openvr-attach-only";

function processNameMatches(name: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => candidate === name || candidate.slice(0, 15) === name);
}

function processIsZombie(pid: string): boolean {
  try {
    return /^State:\s+Z\b/m.test(Deno.readTextFileSync(`/proc/${pid}/status`));
  } catch {
    return true;
  }
}

/** PIDs whose executable name matches one of `names`; zombies are not running instances. */
export function steamVrProcessIds(names: readonly string[]): number[] {
  if (Deno.build.os !== "linux") return [];
  const pids: number[] = [];
  for (const entry of Deno.readDirSync("/proc")) {
    if (!/^\d+$/.test(entry.name) || processIsZombie(entry.name)) continue;
    let matched = false;
    try {
      matched = processNameMatches(
        Deno.readTextFileSync(`/proc/${entry.name}/comm`).trim(),
        names,
      );
    } catch {
      continue; // Gone between the directory listing and the read.
    }
    if (!matched) {
      try {
        const exe = Deno.readLinkSync(`/proc/${entry.name}/exe`).replace(/ \(deleted\)$/, "");
        matched = processNameMatches(exe.split("/").pop() ?? "", names);
      } catch {
        // Another user's process, or gone: `comm` was all there was to ask.
      }
    }
    if (matched) pids.push(Number(entry.name));
  }
  return pids;
}

export function steamVrRunning(names: readonly string[]): boolean {
  return steamVrProcessIds(names).length > 0;
}

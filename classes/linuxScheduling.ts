/**
 * ananicy-cpp v1.2.0 prefers argv[0] over comm. Replace only that original argument,
 * never the remaining CLI arguments used by server discovery and restart tools.
 * Four bytes fit the source CLI's shortest usual argv[0], "deno".
 */
export const LINUX_SCHEDULING_ARGV0 = "ppvr";

function setLinuxSchedulingArgv0(): void {
  const cmdline = Deno.readFileSync("/proc/self/cmdline");
  const end = cmdline.indexOf(0);
  const bytes = new TextEncoder().encode(LINUX_SCHEDULING_ARGV0);
  if (end < bytes.length) throw new Error("argv[0] has no room for the scheduling identity");
  if (new TextDecoder().decode(cmdline.subarray(0, end)) === LINUX_SCHEDULING_ARGV0) return;
  const stat = Deno.readTextFileSync("/proc/self/stat");
  // Fields after comm start at field 3. Fields 48/49 bound the original argv allocation.
  const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
  const start = Number(fields[45]);
  const limit = Number(fields[46]);
  const size = end + 1;
  if (
    !Number.isSafeInteger(start) || start <= 0 || !Number.isSafeInteger(limit) ||
    limit < start + size
  ) throw new Error("Cannot validate the original argv[0] allocation");
  const memory = Deno.openSync("/proc/self/mem", { read: true, write: true });
  try {
    memory.seekSync(start, Deno.SeekMode.Start);
    const original = new Uint8Array(size);
    if (memory.readSync(original) !== size || original.some((v, i) => v !== cmdline[i])) {
      throw new Error("Original argv[0] does not match its kernel-reported allocation");
    }
    const replacement = new Uint8Array(size);
    replacement.set(bytes);
    memory.seekSync(start, Deno.SeekMode.Start);
    if (memory.writeSync(replacement) !== size) throw new Error("Incomplete argv[0] update");
  } finally {
    memory.close();
  }
}

/** Linux process identity and recovery from inherited background scheduling. */
export type LinuxSchedulingStatus = {
  name: string;
  renamed: boolean;
  argv0Named: boolean;
  idleThreads: number;
  correctedThreads: number;
  deniedThreads: number;
  error?: string;
};

/**
 * Only this process is touched. Never request realtime scheduling or lower an existing boost.
 * A system policy may be needed to undo inherited positive niceness (see resources/linux).
 */
let settlingScheduled = false;

export function initializeLinuxScheduling(name = "petplay"): LinuxSchedulingStatus {
  const result = applyLinuxScheduling(name);
  if (Deno.build.os === "linux" && !settlingScheduled) {
    settlingScheduled = true;
    // A pre-start ananicy event may already hold the old "deno" classification.
    // Bounded startup rechecks catch that queued write; no permanent polling loop.
    for (const delay of [250, 1_000, 3_000]) {
      const timer = setTimeout(() => applyLinuxScheduling(name), delay);
      Deno.unrefTimer(Number(timer));
    }
  }
  return result;
}

function applyLinuxScheduling(name: string): LinuxSchedulingStatus {
  const status: LinuxSchedulingStatus = {
    name,
    renamed: false,
    argv0Named: false,
    idleThreads: 0,
    correctedThreads: 0,
    deniedThreads: 0,
  };
  if (Deno.build.os !== "linux") return status;
  if (!/^[a-z][a-z0-9-]{0,14}$/.test(name)) throw new Error("Invalid Linux process name");
  try {
    // Keep a readable leader name even when called from a hot-reloaded worker.
    Deno.writeTextFileSync(`/proc/self/task/${Deno.pid}/comm`, name);
    status.renamed = true;
    setLinuxSchedulingArgv0();
    status.argv0Named = true;
    const libc = Deno.dlopen("libc.so.6", {
      sched_getscheduler: { parameters: ["i32"], result: "i32" },
      sched_setscheduler: { parameters: ["i32", "i32", "buffer"], result: "i32" },
      getpriority: { parameters: ["i32", "u32"], result: "i32" },
      setpriority: { parameters: ["i32", "u32", "i32"], result: "i32" },
    });
    try {
      const param = new Int32Array([0]);
      for (const task of Deno.readDirSync("/proc/self/task")) {
        const tid = Number(task.name);
        if (!Number.isInteger(tid) || tid <= 0) continue;
        const policy = libc.symbols.sched_getscheduler(tid);
        // Preserve intentional batch/realtime threads; normalize only idle/normal.
        if (policy !== 0 && policy !== 5) continue;
        let denied = false;
        if (policy === 5) {
          status.idleThreads++;
          if (libc.symbols.sched_setscheduler(tid, 0, param) === 0) status.correctedThreads++;
          else denied = true;
        }
        if (
          libc.symbols.getpriority(0, tid) > 0 &&
          libc.symbols.setpriority(0, tid, 0) !== 0
        ) denied = true;
        // An exiting thread may fail these calls; count only threads that still exist.
        if (denied) {
          try {
            Deno.statSync(`/proc/self/task/${tid}`);
            status.deniedThreads++;
          } catch {
            // Thread exited during startup.
          }
        }
      }
    } finally {
      libc.close();
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }
  if (status.error || status.deniedThreads > 0) {
    console.warn(
      `[petplay] Linux scheduling: ${JSON.stringify(status)}; inherited priority could not ` +
        "be fully restored. See resources/linux/README.md for the optional ananicy rule.",
    );
  }
  return status;
}

/**
 * Set the calling thread's niceness (Linux; needs RLIMIT_NICE for negative values). For a
 * latency-critical thread on a loaded machine. Returns the niceness read back, or an error.
 */
export function setCurrentThreadNice(nice: number): { tid: number; nice: number; error?: string } {
  if (Deno.build.os !== "linux") return { tid: 0, nice: 0, error: "not linux" };
  if (!Number.isInteger(nice) || nice < -20 || nice > 19) throw new Error("Invalid niceness");
  const libc = Deno.dlopen("libc.so.6", {
    gettid: { parameters: [], result: "i32" },
    getpriority: { parameters: ["i32", "u32"], result: "i32" },
    setpriority: { parameters: ["i32", "u32", "i32"], result: "i32" },
  });
  try {
    const tid = libc.symbols.gettid();
    const failed = libc.symbols.setpriority(0, tid, nice) !== 0;
    const now = libc.symbols.getpriority(0, tid);
    return failed ? { tid, nice: now, error: `setpriority(${nice}) denied` } : { tid, nice: now };
  } finally {
    libc.close();
  }
}

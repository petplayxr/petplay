/**
 * Dev loop for the `webxr` actor: reload it whenever a file it loads changes.
 *
 * Deno cannot evict a module from a running isolate, so new code needs a new
 * worker — which is exactly what `RELOAD` builds (snapshot → shutdown →
 * recreate → restore). This only decides *when* to send it.
 *
 * Two things make that safe to do on every save:
 *
 * - **Only the actor's own module graph is watched**, as `deno info` reports
 *   it, and it is re-read after every change so a newly imported file is
 *   picked up.
 * - **Nothing is reloaded until the graph loads.** `RELOAD` drops the old actor
 *   before the new worker starts; a worker that fails to load (a half-typed
 *   save) never reports in, and the actor is gone until the server restarts.
 *   `deno info` parses every module in the graph in a fraction of a second, so a
 *   syntax error or a missing import keeps the old actor running and says why.
 *   (A module that throws while *evaluating* still gets past this check.)
 */
import { dirname, fromFileUrl } from "@std/path";

export type ModuleGraph = {
  /** Absolute paths of every local file in the graph. */
  files: Set<string>;
  /** `path: message` for each module that failed to resolve or parse. */
  errors: string[];
};

type DenoInfoModule = { specifier?: string; error?: string };

/** The parts of `deno info --json` that matter here. */
export function parseModuleGraph(info: { modules?: DenoInfoModule[] }): ModuleGraph {
  const files = new Set<string>();
  const errors: string[] = [];
  for (const module of info.modules ?? []) {
    const specifier = module.specifier ?? "";
    const local = specifier.startsWith("file://");
    if (local) files.add(fromFileUrl(specifier));
    if (module.error != null) {
      errors.push(`${local ? fromFileUrl(specifier) : specifier}: ${module.error}`);
    }
  }
  return { files, errors };
}

export async function loadModuleGraph(entry: string): Promise<ModuleGraph> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--allow-import", "--json", entry],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    return { files: new Set(), errors: [new TextDecoder().decode(output.stderr).trim()] };
  }
  return parseModuleGraph(JSON.parse(new TextDecoder().decode(output.stdout)));
}

/**
 * Directories to watch, not files: editors save by writing a temporary file
 * and renaming it over the original, which a watch on the file itself misses.
 */
export function watchDirectories(files: Iterable<string>): string[] {
  return [...new Set([...files].map((file) => dirname(file)))].sort();
}

/**
 * Coalesces bursts of changes into one run, and never runs twice at once: a
 * change that arrives mid-run queues exactly one more run after it.
 */
export class ReloadScheduler {
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running = false;
  #rerun = false;
  #pending = new Set<string>();

  constructor(
    private readonly run: (changed: string[]) => Promise<void>,
    private readonly debounceMs = 300,
  ) {}

  notify(path: string): void {
    this.#pending.add(path);
    if (this.#running) {
      this.#rerun = true;
      return;
    }
    if (this.#timer != null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#flush(), this.debounceMs);
  }

  async #flush(): Promise<void> {
    this.#timer = null;
    this.#running = true;
    try {
      do {
        this.#rerun = false;
        const changed = [...this.#pending];
        this.#pending.clear();
        await this.run(changed);
      } while (this.#rerun);
    } finally {
      this.#running = false;
    }
  }

  dispose(): void {
    if (this.#timer != null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

export type WebXrAutoReloadOptions = {
  /** The actor's module, e.g. `petplay/webxr.ts`. */
  entry: string;
  /** The actor to reload, or `null` while there is none. */
  getTarget: () => string | null;
  reload: (actorId: string) => Promise<void>;
  /** Headset feedback; the server log gets everything regardless. */
  toast: (title: string, content: string, tone: "info" | "warning") => void;
  log: (message: string) => void;
  debounceMs?: number;
};

const RELEVANT_EVENTS = new Set<Deno.FsEvent["kind"]>(["create", "modify", "rename", "remove"]);

/** Watches `entry`'s module graph and reloads the actor on change. */
export async function startWebXrAutoReload(
  options: WebXrAutoReloadOptions,
): Promise<{ stop: () => void }> {
  const { entry, log } = options;
  let graph = await loadModuleGraph(entry);
  let watcher: Deno.FsWatcher | null = null;
  let watched = "";
  let stopped = false;

  const scheduler = new ReloadScheduler(async (changed) => {
    const next = await loadModuleGraph(entry);
    if (next.errors.length > 0) {
      // Keep watching what was there plus anything new, so the fix is seen too.
      graph = { files: new Set([...graph.files, ...next.files]), errors: next.errors };
      rewatch();
      log(
        `[webxr-autoreload] not reloading; the code does not load:\n  ${next.errors.join("\n  ")}`,
      );
      // `/abs/dir/file.ts: SyntaxError: …` plus a code frame → `file.ts: SyntaxError: …`.
      const first = next.errors[0]!.split("\n")[0]!;
      options.toast(
        "WebXR not reloaded",
        first.slice(first.lastIndexOf("/", first.indexOf(": ")) + 1),
        "warning",
      );
      return;
    }
    graph = next;
    rewatch();
    const target = options.getTarget();
    if (target == null) {
      log("[webxr-autoreload] no webxr actor to reload");
      return;
    }
    const names = changed.map((path) => path.split("/").at(-1)).join(", ");
    log(`[webxr-autoreload] reloading webxr (${names})`);
    const started = performance.now();
    try {
      await options.reload(target);
    } catch (error) {
      log(`[webxr-autoreload] reload failed: ${error instanceof Error ? error.message : error}`);
      return;
    }
    const ms = Math.round(performance.now() - started);
    log(`[webxr-autoreload] reloaded in ${ms}ms`);
    options.toast("WebXR reloaded", names, "info");
  }, options.debounceMs);

  function rewatch(): void {
    const directories = watchDirectories(graph.files);
    const key = directories.join("\n");
    if (stopped || key === watched) return;
    watcher?.close();
    watched = key;
    const next = Deno.watchFs(directories, { recursive: false });
    watcher = next;
    void (async () => {
      try {
        for await (const event of next) {
          if (!RELEVANT_EVENTS.has(event.kind)) continue;
          for (const path of event.paths) {
            if (graph.files.has(path)) scheduler.notify(path);
          }
        }
      } catch {
        // Closed by a rewatch or stop.
      }
    })();
  }

  rewatch();
  log(
    `[webxr-autoreload] watching ${graph.files.size} files in ${
      watchDirectories(graph.files).length
    } directories`,
  );
  return {
    stop: () => {
      stopped = true;
      scheduler.dispose();
      watcher?.close();
    },
  };
}

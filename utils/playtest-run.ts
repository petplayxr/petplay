/**
 * Playtest runner: launches a `--novr` server on scratch files, runs `tests/playtest/<name>.ts`
 * step by step inside the `webxr` actor, and leaves the run in `logs/playtest/<time>-<name>/`
 * (`result.json`, a capture of each failed step, `server.log`, and the scratch layout and settings
 * it ran against).
 *
 * ```sh
 * deno task playtest smoke
 * deno task playtest all
 * deno task playtest smoke --port=3995 --keep   # leave the server up afterwards to poke at it
 * deno task playtest smoke --file-issue         # a failed run writes markdown/issues/<slug>/
 * deno task playtest smoke --captures           # a PNG after every step, not just failed ones
 * deno task playtest smoke --profile            # CPU-profile each step, break down long stalls
 * ```
 *
 * Never touches the real layout or settings, and never attaches to a running session: steps move
 * windows and press keys, which in a headset session would land on the real desktop.
 */
import { basename, dirname, fromFileUrl, join, toFileUrl } from "@std/path";
import type { PlaytestStepResult } from "./playtest.ts";

const args = Deno.args;
const projectRoot = join(dirname(fromFileUrl(import.meta.url)), "..");
const scriptsDir = join(projectRoot, "tests", "playtest");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const basePort = Number(argValue("port") ?? 3995);
const keep = args.includes("--keep");
const fileIssue = args.includes("--file-issue");
/** A capture boots a preview process (about a second), so by default only failed steps get one. */
const captureAll = args.includes("--captures");
/**
 * The test server's frame rate. Steps wait in frames, so a faster clock runs them faster; nothing
 * the scripts check depends on the rate (grab damping and timers run on elapsed time).
 */
const hz = Number(argValue("hz") ?? 240);
/** CPU-profile every step and print where each long stall's time went. */
const profile = args.includes("--profile");
const names = args.filter((arg) => !arg.startsWith("--"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function scriptNames(): Promise<string[]> {
  if (names.length > 0 && !names.includes("all")) return names;
  const found: string[] = [];
  for await (const entry of Deno.readDir(scriptsDir)) {
    if (entry.isFile && entry.name.endsWith(".ts")) found.push(basename(entry.name, ".ts"));
  }
  return found.sort();
}

async function portInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/registry`);
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

type Server = { stop: () => Promise<void>; exitCode: () => number | null };

async function launch(runDir: string, port: number): Promise<Server> {
  const log = await Deno.open(join(runDir, "server.log"), { createNew: true, write: true });
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "--unstable-webgpu",
      "--env-file",
      "--no-check",
      "petplay/petplay.ts",
      "dev",
      "--novr",
      "--agent-repl",
      `--agent-repl-port=${port}`,
      `--webxr-polyfill-hz=${hz}`,
    ],
    cwd: projectRoot,
    env: {
      PETPLAY_SPATIAL_LAYOUT_PATH: join(runDir, "spatial-layout.json"),
      PETPLAY_SETTINGS_PATH: join(runDir, "settings.json"),
    },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  let exitCode: number | null = null;
  child.status.then((status) => exitCode = status.code);
  const mirrored = Promise.all([child.stdout, child.stderr].map(async (stream) => {
    for await (const chunk of stream) await log.write(chunk);
  }));
  return {
    exitCode: () => exitCode,
    stop: async () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
      await child.status;
      await mirrored.catch(() => {});
      log.close();
    },
  };
}

async function evalInWebxr(port: number, code: string, timeoutMs: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/eval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "webxr", code, timeoutMs }),
  });
  const body = await response.json() as {
    result?: { ok: boolean; error?: string };
    error?: unknown;
  };
  if (!response.ok || body.result?.ok !== true) {
    throw new Error(`eval failed: ${body.result?.error ?? JSON.stringify(body.error ?? body)}`);
  }
}

/** Waits for the webxr actor, then for a scene with a wrist menu in it; gives up if the server exits. */
async function waitForScene(port: number, server: Server, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    const code = server.exitCode();
    if (code !== null) {
      throw new Error(`the server exited with code ${code} before the scene came up`);
    }
    try {
      await evalInWebxr(
        port,
        `let found = false;
         host.rootStore.getState().scene.traverse((o) => {
           if (o.userData?.wristMenuActor !== undefined) found = true;
         });
         if (!found) throw new Error("no wrist menu yet");
         return true;`,
        5_000,
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`the scene did not come up within ${timeoutMs} ms (${lastError})`);
}

/** Counted in the actor: the script imports the app's modules, which only load there. */
async function stepCount(port: number, scriptUrl: string, path: string): Promise<number> {
  await evalInWebxr(
    port,
    `const { steps } = await import(${JSON.stringify(scriptUrl)});
     await Deno.writeTextFile(${JSON.stringify(path)}, String(steps.length));
     return true;`,
    30_000,
  );
  return Number(await Deno.readTextFile(path));
}

async function runStep(
  port: number,
  scriptUrl: string,
  index: number,
  resultPath: string,
  profilePath?: string,
): Promise<PlaytestStepResult> {
  const playtestUrl = toFileUrl(join(projectRoot, "utils", "playtest.ts")).href;
  await evalInWebxr(
    port,
    `const p = await import(${JSON.stringify(playtestUrl)});
     const result = await p.runPlaytestStep(host, ${JSON.stringify(scriptUrl)}, ${index}, ${
      JSON.stringify({ profilePath })
    });
     await Deno.writeTextFile(${JSON.stringify(resultPath)}, JSON.stringify(result));
     return result.ok;`,
    60_000,
  );
  return JSON.parse(await Deno.readTextFile(resultPath)) as PlaytestStepResult;
}

async function capture(port: number, path: string): Promise<boolean> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      "petplay/client.ts",
      "capture",
      `--agent-repl-port=${port}`,
      `--path=${path}`,
    ],
    cwd: projectRoot,
    stdout: "null",
    stderr: "piped",
  }).output();
  return output.success;
}

type RunResult = {
  name: string;
  ok: boolean;
  seconds: number;
  steps: (PlaytestStepResult & { capture: string | null })[];
  error?: string;
};

async function writeIssue(run: RunResult, runDir: string): Promise<string> {
  const failed = run.steps.find((step) => !step.ok);
  const slug = `playtest-${run.name}-${failed?.name ?? "crashed"}-fails`;
  const dir = join(projectRoot, "markdown", "issues", slug);
  await Deno.mkdir(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const failures = failed?.failures ?? [run.error ?? "unknown"];
  if (failed?.capture != null) await Deno.copyFile(failed.capture, join(dir, "capture.png"));
  await Deno.copyFile(join(runDir, "result.json"), join(dir, "result.json"));
  await Deno.writeTextFile(
    join(dir, "README.md"),
    `# Playtest \`${run.name}\` fails at \`${failed?.name ?? "startup"}\`

Status: open
Track: agentic playtesting

## What happens

${failures.map((failure) => `- ${failure.split("\n")[0]}`).join("\n")}

## Repro

\`deno task playtest ${run.name}\` (script: \`tests/playtest/${run.name}.ts\`). Found ${today}; the
full run is in \`${runDir.replace(projectRoot + "/", "")}\`, and \`result.json\` here is its result.
`,
  );
  return dir;
}

/** A script's server, launched ahead of its turn. */
type Launched = { name: string; port: number; runDir: string; server: Server };

async function prepare(name: string, port: number): Promise<Launched> {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "");
  const runDir = join(projectRoot, "logs", "playtest", `${stamp}-${name}`);
  await Deno.mkdir(runDir, { recursive: true });
  return { name, port, runDir, server: await launch(runDir, port) };
}

/** Runs the script on its server; the caller stops the server. */
async function runScript({ name, port, runDir, server }: Launched): Promise<RunResult> {
  const scriptUrl = toFileUrl(join(scriptsDir, `${name}.ts`)).href;
  const started = performance.now();
  const run: RunResult = { name, ok: false, seconds: 0, steps: [] };
  try {
    await waitForScene(port, server, 90_000);
    const total = await stepCount(port, scriptUrl, join(runDir, "steps.txt"));
    for (let index = 0; index < total; index++) {
      const result = await runStep(
        port,
        scriptUrl,
        index,
        join(runDir, `step-${index}.json`),
        profile ? join(runDir, `step-${index}.cpuprofile`) : undefined,
      );
      const shot = join(runDir, `${index + 1}-${result.name}.png`);
      const captured = (captureAll || !result.ok) && await capture(port, shot);
      run.steps.push({ ...result, capture: captured ? shot : null });
      const mark = result.ok ? "ok  " : "FAIL";
      console.log(`  ${mark} ${result.name} (${result.ms} ms)`);
      for (const note of result.notes) console.log(`         ${note}`);
      const frames = result.frames;
      if (frames != null && frames.stalls.length > 0) {
        const worst = [...frames.stalls].sort((a, b) => b[1] - a[1]).slice(0, 5);
        console.log(
          `       ~ ${frames.stalls.length} stalled of ${frames.count} frames (median ` +
            `${frames.medianMs} ms): ${worst.map(([at, ms]) => `${ms} ms @${at}`).join(", ")}`,
        );
      }
      for (const stall of result.stallProfiles ?? []) {
        console.log(`       ~ ${stall.ms} ms @${stall.at}`);
        const list = (pairs: [string, number][], count: number) =>
          pairs.slice(0, count).map(([label, ms]) => `${ms} ${label}`).join("\n             ");
        console.log(`           self:  ${list(stall.self, 8)}`);
        console.log(`           app:   ${list(stall.app, 10)}`);
      }
      for (const failure of result.failures) console.log(`       ! ${failure.split("\n")[0]}`);
    }
    run.ok = run.steps.every((step) => step.ok);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL ${run.error}`);
  } finally {
    run.seconds = Math.round((performance.now() - started) / 1000);
    await Deno.writeTextFile(join(runDir, "result.json"), JSON.stringify(run, null, 2) + "\n");
  }
  console.log(`${run.ok ? "PASS" : "FAIL"} ${name} in ${run.seconds} s -> ${runDir}`);
  if (!run.ok && fileIssue) console.log(`  issue: ${await writeIssue(run, runDir)}`);
  return run;
}

const list = keep ? (await scriptNames()).slice(0, 1) : await scriptNames();
// Scripts run one at a time, each on a fresh server. The next script's server boots while the
// current one runs and the finished one shuts down in the background, so neither start-up (~4 s)
// nor the graceful teardown (~3 s) is on the clock. Three ports, so a port is never reused while
// its last server may still be tearing down.
const ports = [basePort, basePort + 1, basePort + 2].slice(0, Math.min(3, list.length));
for (const port of ports) {
  if (await portInUse(port)) {
    console.error(`port ${port} already has a petplay server; pick another base with --port=<n>`);
    Deno.exit(2);
  }
}
const stopping = new Map<number, Promise<void>>();
const launchAt = async (index: number) => {
  const port = ports[index % ports.length];
  await stopping.get(port);
  return await prepare(list[index], port);
};
const results: RunResult[] = [];
let next = list.length > 0 ? launchAt(0) : null;
for (let index = 0; index < list.length; index++) {
  const current = await next!;
  next = index + 1 < list.length ? launchAt(index + 1) : null;
  console.log(`playtest ${current.name}`);
  results.push(await runScript(current));
  if (keep) {
    console.log(`  server left running on :${current.port} (--keep)`);
  } else {
    stopping.set(current.port, current.server.stop());
  }
}
await Promise.all(stopping.values());
Deno.exit(results.every((run) => run.ok) ? 0 : 1);

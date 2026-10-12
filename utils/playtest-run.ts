/**
 * Playtest runner: launches a `--novr` server on scratch files, runs `tests/playtest/<name>.ts`
 * step by step inside the `webxr` actor, captures the view after each step, and leaves the run in
 * `logs/playtest/<time>-<name>/` (`result.json`, one PNG per step, `server.log`, and the scratch
 * layout and settings it ran against).
 *
 * ```sh
 * deno task playtest smoke
 * deno task playtest all
 * deno task playtest smoke --port=3995 --keep   # leave the server up afterwards to poke at it
 * deno task playtest smoke --file-issue         # a failed run writes markdown/issues/<slug>/
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

const port = Number(argValue("port") ?? 3995);
const keep = args.includes("--keep");
const fileIssue = args.includes("--file-issue");
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

async function portInUse(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/registry`);
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

type Server = { stop: () => Promise<void> };

async function launch(runDir: string): Promise<Server> {
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
  const mirrored = Promise.all([child.stdout, child.stderr].map(async (stream) => {
    for await (const chunk of stream) await log.write(chunk);
  }));
  return {
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

async function evalInWebxr(code: string, timeoutMs: number): Promise<void> {
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

/** Waits for the webxr actor, then for a scene with a wrist menu in it. */
async function waitForScene(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await evalInWebxr(
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
async function stepCount(scriptUrl: string, path: string): Promise<number> {
  await evalInWebxr(
    `const { steps } = await import(${JSON.stringify(scriptUrl)});
     await Deno.writeTextFile(${JSON.stringify(path)}, String(steps.length));
     return true;`,
    30_000,
  );
  return Number(await Deno.readTextFile(path));
}

async function runStep(
  scriptUrl: string,
  index: number,
  resultPath: string,
): Promise<PlaytestStepResult> {
  const playtestUrl = toFileUrl(join(projectRoot, "utils", "playtest.ts")).href;
  await evalInWebxr(
    `const p = await import(${JSON.stringify(playtestUrl)});
     const result = await p.runPlaytestStep(host, ${JSON.stringify(scriptUrl)}, ${index});
     await Deno.writeTextFile(${JSON.stringify(resultPath)}, JSON.stringify(result));
     return result.ok;`,
    60_000,
  );
  return JSON.parse(await Deno.readTextFile(resultPath)) as PlaytestStepResult;
}

async function capture(path: string): Promise<boolean> {
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

async function runScript(name: string): Promise<RunResult> {
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "");
  const runDir = join(projectRoot, "logs", "playtest", `${stamp}-${name}`);
  await Deno.mkdir(runDir, { recursive: true });
  const scriptUrl = toFileUrl(join(scriptsDir, `${name}.ts`)).href;
  const started = performance.now();
  const run: RunResult = { name, ok: false, seconds: 0, steps: [] };
  const server = await launch(runDir);
  try {
    await waitForScene(90_000);
    const total = await stepCount(scriptUrl, join(runDir, "steps.txt"));
    for (let index = 0; index < total; index++) {
      const result = await runStep(scriptUrl, index, join(runDir, `step-${index}.json`));
      const shot = join(runDir, `${index + 1}-${result.name}.png`);
      const captured = await capture(shot);
      run.steps.push({ ...result, capture: captured ? shot : null });
      const mark = result.ok ? "ok  " : "FAIL";
      console.log(`  ${mark} ${result.name} (${result.ms} ms)`);
      for (const note of result.notes) console.log(`         ${note}`);
      for (const failure of result.failures) console.log(`       ! ${failure.split("\n")[0]}`);
    }
    run.ok = run.steps.every((step) => step.ok);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL ${run.error}`);
  } finally {
    run.seconds = Math.round((performance.now() - started) / 1000);
    await Deno.writeTextFile(join(runDir, "result.json"), JSON.stringify(run, null, 2) + "\n");
    if (keep) {
      console.log(`  server left running on :${port} (--keep)`);
    } else {
      await server.stop();
    }
  }
  console.log(`${run.ok ? "PASS" : "FAIL"} ${name} in ${run.seconds} s -> ${runDir}`);
  if (!run.ok && fileIssue) console.log(`  issue: ${await writeIssue(run, runDir)}`);
  return run;
}

if (await portInUse()) {
  console.error(`port ${port} already has a petplay server; pick another with --port=<n>`);
  Deno.exit(2);
}
const results: RunResult[] = [];
for (const name of await scriptNames()) {
  console.log(`playtest ${name}`);
  results.push(await runScript(name));
  if (keep) break;
}
Deno.exit(results.every((run) => run.ok) ? 0 : 1);

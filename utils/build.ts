/**
 * `deno task build`: compile the launcher into `dist/`.
 *
 * Deno already handles the per-OS executable suffix — `--output dist/petplay` becomes
 * `dist/petplay.exe` when targeting Windows — so the only thing that has to branch is the icon,
 * which Deno refuses outside Windows (`--icon` on Linux: *"only available when targeting
 * Windows"*). Writing into `dist/` also keeps the output from colliding with the `petplay/`
 * source directory on the OSes where the binary has no extension.
 */
import { nativeBuildTarget } from "../classes/nativeBuildTarget.ts";
import { buildNative } from "./build-native.ts";

const targetArg = Deno.args.find((arg) => arg.startsWith("--target="));
if (Deno.args.length > (targetArg ? 1 : 0)) {
  throw new Error("usage: deno task build [--target=aarch64-unknown-linux-gnu]");
}
const target = targetArg?.slice("--target=".length);
if (target != null && target !== "aarch64-unknown-linux-gnu") {
  throw new Error(`unsupported build target: ${target}`);
}
const output = target ? "dist/petplay-aarch64" : "dist/petplay";

const webxr = await new Deno.Command(Deno.execPath(), {
  args: ["task", "build:webxr"],
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).output();
if (!webxr.success) throw new Error(`WebXR runtime build failed (${webxr.code})`);

await Deno.mkdir("dist", { recursive: true });
const captureHelper = await buildNative(nativeBuildTarget(target));

// Every directory holding a module that is spawned by URL at runtime has to be embedded as files:
// actors are workers, and `{ worker: "process" }` children are dispatched into a module href. The
// actor modules live in `petplay/` and `classes/`; `IPCWorker` reaches its host module inside
// stageforge. A module whose directory is missing here only fails once that child is actually
// spawned, so keep this list in step with the spawn sites.
const args = [
  "compile",
  "-A",
  // A cross build must not embed the developer machine's .env into a deployable binary.
  ...(target ? [] : ["--env-file"]),
  "--no-check",
  ...(target ? ["--target", target] : []),
  "--include",
  "./petplay/",
  "--include",
  "./classes/",
  "--include",
  "./resources/",
  "--include",
  "./submodules/threewebxrwebgpudeno/submodules/iwer/packages/iwer/build/",
  "--include",
  captureHelper,
  "--include",
  "./submodules/stageforge/",
  // Agent playtests are dynamically imported inside the compiled webxr worker too.
  "--include",
  "./utils/playtest.ts",
  "--include",
  "./tests/playtest/",
  "--include",
  "./submodules/threewebxrwebgpudeno/vendor/three-msdf-text-utils/demo/fonts/roboto/",
  "--include",
  "./resources/fonts/",
  "--output",
  output,
];

if (Deno.build.os === "windows" && !target) {
  args.push("--icon", "resources/petplay.ico");
}

// `dev` matches the previous release launcher: the compiled binary boots straight into a session.
args.push("petplay/petplay.ts", "dev");

const build = new Deno.Command(Deno.execPath(), {
  args,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const { code } = await build.output();
Deno.exit(code);

/** Boot a compiled app outside its checkout and verify its bundled renderer and capture helper. */
import { fromFileUrl, resolve } from "@std/path";

const expectedMode = Deno.args.find((a) => a.startsWith("--expect-mode="))?.slice(
  "--expect-mode=".length,
);
if (
  Deno.args.length !== (expectedMode ? 2 : 1) ||
  (expectedMode && !["development", "production"].includes(expectedMode))
) {
  throw new Error(
    "usage: deno run -A utils/compiled-smoke.ts <executable> [--expect-mode=development|production]",
  );
}
const binary = resolve(Deno.args[0]!);
const scratch = fromFileUrl(new URL("../_scratch/", import.meta.url));
await Deno.mkdir(scratch, { recursive: true });
const work = await Deno.makeTempDir({ dir: scratch, prefix: "compiled-smoke-" });
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const log = await Deno.open(`${work}/server.log`, { create: true, write: true });
const environment = Deno.env.toObject();
delete environment.PETPLAY_RAYLIB_LIBRARY;
delete environment.PETPLAY_SCREEN_STREAMER;
// Verify embedded conditions rather than accidentally inheriting a matching shell override.
delete environment.NODE_ENV;
delete environment.DENO_CONDITIONS;
const child = new Deno.Command(binary, {
  args: ["--novr", "--agent-repl", `--agent-repl-port=${port}`],
  cwd: work,
  clearEnv: true,
  env: {
    ...environment,
    PETPLAY_SPATIAL_LAYOUT_PATH: `${work}/layout.json`,
    PETPLAY_SETTINGS_PATH: `${work}/settings.json`,
  },
  stdin: "null",
  stdout: "piped",
  stderr: "piped",
}).spawn();
let exited = false;
const status = child.status.then((result) => {
  exited = true;
  return result;
});
const logging = Promise.all([child.stdout, child.stderr].map(async (stream) => {
  for await (const bytes of stream) await log.write(bytes);
}));
try {
  let ready = false;
  let lastError = "scene not ready";
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`compiled process exited before readiness (${(await status).code})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/eval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({
          target: "webxr",
          timeoutMs: 8_000,
          code: `
          const expectedMode = ${JSON.stringify(expectedMode ?? null)};
          if (expectedMode) {
            const React = await import('react');
            const element = React.createElement('group');
            const development = Object.hasOwn(element, '_store');
            if (Deno.env.get('NODE_ENV') !== expectedMode || development !== (expectedMode === 'development'))
              throw Error('Embedded build mode/React mismatch: ' + JSON.stringify({ NODE_ENV: Deno.env.get('NODE_ENV'), development, expectedMode }));
          }
          let found = false;
          host.rootStore.getState().scene.traverse(o => {
            if (o.userData?.wristMenuActor !== undefined) found = true;
          });
          if (!found) throw Error('scene not ready');
          const { default: raylib } = await import(new URL('../submodules/raylib_ts_bindings_deno/raylib_bindings.ts', moduleUrl).href);
          const { getRaylibLibraryPath } = await import(new URL('../classes/nativeLibraryPaths.ts', moduleUrl).href);
          if (Deno.build.arch === 'aarch64' && !getRaylibLibraryPath().includes('dist/native/aarch64-unknown-linux-gnu/')) throw Error('raylib is not bundled');
          if (!raylib.isRaylibLoaded()) raylib.loadRaylib(getRaylibLibraryPath());
          const hadWindow = raylib.IsWindowReady();
          try {
            if (!hadWindow) {
              raylib.SetConfigFlags(raylib.ConfigFlags.FLAG_WINDOW_HIDDEN);
              raylib.H.InitWindow(64, 64, 'PetPlay bundled raylib probe');
            }
            if (!raylib.IsWindowReady()) throw Error('OpenGL window not ready');
            const texture = raylib.H.LoadRenderTexture(32, 32);
            try {
              if (!raylib.H.IsRenderTextureValid(texture)) throw Error('render texture invalid');
              raylib.H.BeginTextureMode(texture);
              raylib.H.ClearBackground({ r: 0, g: 0, b: 0, a: 255 });
              raylib.EndTextureMode();
            } finally { raylib.H.UnloadRenderTexture(texture); }
          } finally { if (!hadWindow && raylib.IsWindowReady()) raylib.CloseWindow(); }

          const { nativeBuildTarget, screenStreamerRelativePath } = await import(new URL('../classes/nativeBuildTarget.ts', moduleUrl).href);
          const path = Deno.makeTempFileSync({ prefix: 'capture-probe-' });
          try {
            Deno.writeFileSync(path, Deno.readFileSync(new URL('../' + screenStreamerRelativePath(nativeBuildTarget()), moduleUrl)));
            Deno.chmodSync(path, 0o755);
            const probe = await new Deno.Command(path, { args: ['--version'] }).output();
            if (!probe.success || !new TextDecoder().decode(probe.stdout).startsWith('screen-streamer ')) throw Error('capture helper startup failed');
          } finally { Deno.removeSync(path); }
          return true;
        `,
        }),
      });
      const body = await response.json();
      if (response.ok && body.result?.ok === true) {
        ready = true;
        break;
      }
      lastError = JSON.stringify(body);
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error(`compiled readiness timed out: ${lastError}`);
} catch (error) {
  console.error(`Compiled smoke failed; log: ${work}/server.log`);
  throw error;
} finally {
  if (!exited) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (!exited) child.kill("SIGKILL");
  }, 20_000);
  const result = await status;
  clearTimeout(timer);
  await logging;
  log.close();
  const output = await Deno.readTextFile(`${work}/server.log`);
  if (!result.success || /SIGSEGV|segmentation fault/i.test(output)) {
    console.error(output);
    throw new Error(`compiled process failed during startup/shutdown (${result.code})`);
  }
}
console.log(`Compiled scene, bundled raylib and capture helper passed; log: ${work}/server.log`);

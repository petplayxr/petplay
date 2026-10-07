/** Explicit native fault diagnostics. Never enabled by a normal launch. */
let library: Deno.DynamicLibrary<{
  droidframe_install_crash_trace: { parameters: []; result: "void" };
}> | null = null;

export function installNativeCrashTrace(): void {
  const path = Deno.env.get("PETPLAY_CRASH_TRACE_LIBRARY");
  if (!path) return;
  if (Deno.build.os !== "linux" || Deno.build.arch !== "aarch64") {
    throw new Error("Native crash tracing requires the Linux ARM64 diagnostic reporter");
  }
  if (!Deno.env.get("LD_PRELOAD")?.split(":").includes(path)) {
    throw new Error("Crash reporter must remain loaded through an explicit preload");
  }
  library ??= Deno.dlopen(path, {
    droidframe_install_crash_trace: { parameters: [], result: "void" },
  });
  library.symbols.droidframe_install_crash_trace();
}

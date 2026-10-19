/** Explicit build variants keep performance comparisons from confusing source with debug. */
export type BuildMode = "production" | "development";
export function parseBuildConfiguration(args: string[]) {
  const options = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(target|mode|output)=(.+)$/.exec(arg);
    if (!match || options.has(match[1]!)) {
      throw new Error(`Invalid or duplicate build option: ${arg}`);
    }
    options.set(match[1]!, match[2]!);
  }
  const mode = options.get("mode") ?? "production";
  if (mode !== "production" && mode !== "development") {
    throw new Error(`Unsupported build mode: ${mode}`);
  }
  const target = options.get("target");
  if (target && target !== "aarch64-unknown-linux-gnu") {
    throw new Error(`Unsupported cross-build target: ${target}`);
  }
  const output = options.get("output") ??
    (target
      ? "dist/petplay-aarch64"
      : mode === "development"
      ? "dist/petplay-debug"
      : "dist/petplay");
  return {
    mode: mode as BuildMode,
    target,
    output,
    envFile: mode === "production" ? "release.env" : "development.env",
  };
}

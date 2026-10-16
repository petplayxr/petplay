/** Bounded in-process V8 CPU capture; opens no remote inspector port. */
let busy = false;
export async function captureCpuProfile(
  durationMs: number,
  intervalUs = 1000,
): Promise<unknown> {
  if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 30000) {
    throw new Error("CPU profile duration must be 100..30000 ms");
  }
  if (!Number.isInteger(intervalUs) || intervalUs < 50 || intervalUs > 10000) {
    throw new Error("CPU profile sampling interval must be 50..10000 us");
  }
  if (busy) throw new Error("CPU profiling already active");
  busy = true;
  const { Session } = await import("node:inspector");
  const session = new Session();
  const post = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<unknown>((resolve, reject) => {
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
    });
  try {
    session.connect();
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: intervalUs });
    await post("Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const result = await post("Profiler.stop") as { profile: unknown };
    return result.profile;
  } finally {
    session.disconnect();
    busy = false;
  }
}

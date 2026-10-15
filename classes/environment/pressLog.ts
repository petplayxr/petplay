/**
 * Recent presses for diagnosing activations the user did not aim at, read over the agent REPL
 * as `globalThis.__petplayPressLog` in the webxr worker: what was pressed, by which pointer, where.
 */
const PRESS_LOG_LIMIT = 64;

export function recordPress(target: string, event: unknown): void {
  const e = event as {
    pointerType?: string;
    pointerId?: number;
    distance?: number;
    point?: { toArray?: () => number[] };
    ray?: { origin?: { toArray(): number[] }; direction?: { toArray(): number[] } };
  };
  const global = globalThis as unknown as { __petplayPressLog?: unknown[] };
  const log = global.__petplayPressLog ??= [];
  log.push({
    at: Math.round(performance.now()),
    wall: new Date().toISOString(),
    target,
    pointerType: e?.pointerType,
    pointerId: e?.pointerId,
    distance: e?.distance,
    point: e?.point?.toArray?.(),
    rayOrigin: e?.ray?.origin?.toArray(),
    rayDirection: e?.ray?.direction?.toArray(),
  });
  if (log.length > PRESS_LOG_LIMIT) log.shift();
}

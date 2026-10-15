/** Live diagnostic: briefly freezes scene delivery and rendering, restoring both on exit. */
const port = Number(Deno.args.find((arg) => arg.startsWith("--port="))?.slice(7));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Usage: deno run -A utils/check-overlay-render-independence.ts --port=3988");
}
const base = `http://127.0.0.1:${port}`;
async function request(path: string, body?: unknown): Promise<any> {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok || value.ok === false) throw new Error(JSON.stringify(value));
  return value;
}
async function health(actor: string) {
  return (await request(`/health/actor?actor=${encodeURIComponent(actor)}`)).health.details;
}
const source = await health("webxr");
const actor = source.independentRenderer?.actor;
if (!source.independentRenderer?.enabled || !actor) {
  throw new Error("Independent renderer is not active");
}
async function debug(value: { freezeScene?: boolean; freezeRendering?: boolean }) {
  return await request("/message", {
    target: actor,
    type: "SETRENDERERDEBUG",
    payload: value,
    reply: true,
  });
}
const initial = await health(actor);
if (initial.freezeScene || initial.freezeRendering) {
  throw new Error("Renderer already has a debug freeze active");
}
const sleep = () => new Promise((resolve) => setTimeout(resolve, 1200));
const results: Record<string, unknown> = {};
try {
  await debug({ freezeScene: true });
  let renderBefore = await health(actor), sceneBefore = await health("webxr");
  await sleep();
  let renderAfter = await health(actor), sceneAfter = await health("webxr");
  results.sceneFrozen = {
    sceneBefore: renderBefore.sceneVersion,
    sceneAfter: renderAfter.sceneVersion,
    publishedFrames: renderAfter.publishedFrames - renderBefore.publishedFrames,
    simulationFrames: sceneAfter.frameCount - sceneBefore.frameCount,
  };
  if (
    renderAfter.sceneVersion !== renderBefore.sceneVersion ||
    renderAfter.publishedFrames <= renderBefore.publishedFrames ||
    sceneAfter.frameCount <= sceneBefore.frameCount
  ) throw new Error("Scene freeze independence failed");

  await debug({ freezeScene: false, freezeRendering: true });
  renderBefore = await health(actor);
  sceneBefore = await health("webxr");
  await sleep();
  renderAfter = await health(actor);
  sceneAfter = await health("webxr");
  results.rendererFrozen = {
    renderBefore: renderBefore.renderFrameId,
    renderAfter: renderAfter.renderFrameId,
    simulationFrames: sceneAfter.frameCount - sceneBefore.frameCount,
  };
  if (
    renderAfter.renderFrameId !== renderBefore.renderFrameId ||
    sceneAfter.frameCount <= sceneBefore.frameCount
  ) throw new Error("Render freeze independence failed");
} finally {
  await debug({ freezeScene: false, freezeRendering: false });
}
await sleep();
const resumed = await health(actor);
if (
  !resumed.running || resumed.error || resumed.sceneVersion <= initial.sceneVersion ||
  resumed.publishedFrames <= initial.publishedFrames
) throw new Error("Renderer did not resume");
results.resumed = {
  publishedFrames: resumed.publishedFrames,
  waitTimeouts: resumed.waitTimeouts,
  error: resumed.error,
};
console.log(JSON.stringify(results, null, 2));

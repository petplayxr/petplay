/**
 * A worker asking the server process for its normal shutdown. Actors run in
 * workers and cannot run the host's teardown or call `Deno.exit` for it, and
 * stageforge swallows their uncaught errors. A `BroadcastChannel` reaches the
 * server's main thread from any worker in the process, on every platform.
 */
const CHANNEL = "petplay-process-exit";

export function requestProcessExit(reason: string): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(reason);
  channel.close();
}

/** Server side: `onRequest` runs with the reason for each request. */
export function listenForProcessExitRequests(onRequest: (reason: string) => void): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event) => onRequest(String(event.data));
}

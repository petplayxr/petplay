/** Imports the running driver's identity; no INIT, spawning, or ownership of vrserver. */
import { createActorId, type PostalService } from "../submodules/stageforge/mod.ts";
import { NativeUnixProxy } from "../submodules/petplay_ovrdriver/integration/unix-proxy.ts";
import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
} from "../submodules/stageforge/src/lib/webSocketWorkerCodec.ts";
export async function attachOpenVrDriverProxy(
  postal: PostalService,
  path = `/run/user/${Deno.uid()}/petplay_ovrdriver/control.sock`,
) {
  const proxy = await NativeUnixProxy.connect({
    path,
    encode: encodeWebSocketWorkerMessage,
    decode: decodeWebSocketWorkerMessage,
  });
  try {
    const id = createActorId(proxy.actorId);
    postal.attachProxy(id, proxy, { transport: "native-unix", endpoint: { path } });
    return id;
  } catch (error) {
    proxy.terminate();
    throw error;
  }
}

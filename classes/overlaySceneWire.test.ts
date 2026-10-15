import { decodeOverlayScene, encodeOverlayScene } from "./overlaySceneWire.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";
import {
  decodeWebSocketWorkerMessage,
  encodeWebSocketWorkerMessage,
} from "../submodules/stageforge/src/lib/webSocketWorkerCodec.ts";

Deno.test("scene packets retain typed buffers, ownership, and stereo aliases through process JSON", () => {
  const eye = { frame: { instances: [{ worldMatrix: new Float64Array([1, 2, 3]) }] } };
  const source = { leftEye: eye, rightEye: eye } as unknown as WebXRRaythreeRenderPayload;
  const packet = encodeOverlayScene(source);
  eye.frame.instances[0].worldMatrix[0] = 99;
  const decoded = decodeOverlayScene(
    decodeWebSocketWorkerMessage(
      encodeWebSocketWorkerMessage(packet),
    ) as typeof packet,
  );
  const matrix = decoded.leftEye.frame.instances[0].worldMatrix;
  if (!(matrix instanceof Float64Array) || matrix[0] !== 1) throw new Error("Buffer not preserved");
  if (decoded.leftEye !== decoded.rightEye) throw new Error("Stereo extraction copied twice");
  matrix[0] = 7;
  if (eye.frame.instances[0].worldMatrix[0] !== 99) throw new Error("Source ownership violated");
});

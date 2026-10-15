import { Buffer } from "node:buffer";
import { deserialize, serialize } from "node:v8";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";

// Same-runtime child processes: retain typed buffers and stereo aliases inside the JSON envelope.
// Base64 keeps the existing actor transport opaque to large numeric object graphs.
export const OVERLAY_SCENE_WIRE_FORMAT = "petplay-ir-v8-base64-v1";
export type OverlayScenePacket = { format: typeof OVERLAY_SCENE_WIRE_FORMAT; data: string };
export function encodeOverlayScene(payload: WebXRRaythreeRenderPayload): OverlayScenePacket {
  return { format: OVERLAY_SCENE_WIRE_FORMAT, data: serialize(payload).toString("base64") };
}
export function decodeOverlayScene(packet: OverlayScenePacket): WebXRRaythreeRenderPayload {
  if (packet.format !== OVERLAY_SCENE_WIRE_FORMAT) throw new Error("Unsupported IR wire format");
  return deserialize(Buffer.from(packet.data, "base64")) as WebXRRaythreeRenderPayload;
}

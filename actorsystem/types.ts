import { type } from "arktype";
import { ActorWorker } from "./ActorWorker.ts";

export const worker = self as unknown as ActorWorker;

export const xToAddress = type("string");
export type ToAddress = typeof xToAddress.infer;

export type BaseState = {
  name: string;
  id: string;
  socket: WebSocket | null;
  [key: string]: unknown;
};

export const System = "SYSTEM";
export const xSystem = type("'System'");
export type SystemType = typeof xSystem.infer;

export const xPairAddress = type({
  fm: "string",
  to: "string|null",
});
export type PairAddress = typeof xPairAddress.infer;

export const xSystemCommand = type({
  fm: xSystem,
  to: "null",
});
export type SystemCommand = typeof xSystemCommand.infer;

export const xWorkerToSystem = type({
  fm: "string",
  to: xSystem,
});
export type WorkerToSystem = typeof xWorkerToSystem.infer;

export const xMessageAddressSingle = type(
  xPairAddress,
).or(
  xSystemCommand,
).or(
  xWorkerToSystem,
);
export const xMessageAddressArray = type(xPairAddress.array());
export const xMessageAddressReal = type({
  fm: "string",
  to: xToAddress,
});

export type MessageAddressReal = typeof xMessageAddressReal.infer;
export type MessageAddress =
  | typeof xMessageAddressSingle.infer
  | typeof xMessageAddressArray.infer;

//#endregion

//#region payloads

export const xPayloadSys = type({
  type: "'KEEPALIVE'",
  payload: "null",
}).or({
  type: "'LOADED'",
  payload: "string",
}).or({
  type: "'CREATE'",
  payload: "string",
}).or({
  type: "'MURDER'",
  payload: "string",
}).or({
  type: "'FIND_ROUTE'",
  payload: [xToAddress, "'CBROUTE'"],
}).or({
  type: "'SHUT'",
  payload: "null",
}).or({
  type: "'DELETE'",
  payload: xToAddress,
}).or({
  type: "'STDIN'",
  payload: "string",
}).or({
  type: "'CB'",
  payload: "unknown",
});

export const xPayloadMain = type({
  type: "'MAIN'",
  payload: "null|string",
});

export const xPayloadActor = type({
  type: "'LOG'",
  payload: "null",
}).or({
  type: "'INIT'",
  payload: "null|string",
}).or({
  type: "'REGISTER'",
  payload: xToAddress,
}).or({
  type: "'CUSTOMINIT'",
  payload: "null",
}).or({
  type: "'CB:GETID'|'GETID'",
  payload: "null|string",
});

export const xPayloadRTC = type({
  type: "'RTC'",
  payload: "null",
}).or({
  type: "'CONNECT'",
  payload: xToAddress,
}).or({
  type: "'ADDREMOTE'",
  payload: xToAddress,
});

export const xPayloadSignaling = type({
  type: "'STARTSERVER'",
  payload: "number",
});

export const xString = type("string");

export const xPayloadPortal = type({
  type: "'PREGISTER'",
  payload: { name: xString, address: xToAddress },
}).or({
  type: "'CB:LOOKUP'|'LOOKUP'",
  payload: xToAddress,
}).or({
  type: "'CB:GET_ALL'|'GET_ALL'",
  payload: "null|Array",
});

export const xPayload = type(
  xPayloadSys,
).or(
  xPayloadMain,
).or(
  xPayloadActor,
).or(
  xPayloadRTC,
).or(
  xPayloadSignaling,
).or(
  xPayloadPortal,
);

export type xPayload = typeof xPayload.infer;
export type MessageType = typeof xPayload.infer.type;

export type Payload = {
  [K in MessageType]: Extract<
    xPayload,
    { type: K }
  >["payload"];
};

//#endregion

export const xMessage = type([
  { address: xMessageAddressSingle },
  "&",
  xPayload,
]);
export type Message = typeof xMessage.infer;

//payloads
export type hFunction = (_payload: Payload[MessageType]) => void;

export type PayloadHandler<T extends MessageType> = (
  payload: Payload[T],
  address: MessageAddressReal | ToAddress,
) => hFunction | void | Promise<void>;

export type ActorFunctions = { [K in MessageType]?: PayloadHandler<K> };

export type nonArrayAddress = PairAddress | SystemCommand | WorkerToSystem;

export function notAddressArray(
  address: Message["address"],
): address is nonArrayAddress {
  return !Array.isArray(address);
}

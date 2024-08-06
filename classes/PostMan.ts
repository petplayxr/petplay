
import { Signal } from "../actorsystem/utils.ts";
import {
  ActorFunctions,
  BaseState,
  Message,
  MessageAddressReal,
  notAddressArray,
  Payload,
  PayloadHandler,
  System,
  ToAddress,
  worker,
} from "../actorsystem/types.ts";
import { ActorWorker } from "../actorsystem/ActorWorker.ts";
import { wait } from "../actorsystem/utils.ts";
import { WebRTCServer } from "./webrtcClass.ts";
import { getAvailablePort } from "jsr:@std/net";
import * as JSON from "../classes/JSON.ts";


export const OnMessage = (handler: (message: Message) => void) => {
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as Message;
    handler(message);
  };
};

export class Postman {
  static worker: ActorWorker;
  static state: BaseState;
  static creationSignal: Signal<ToAddress>;
  static portalCheckSignal: Signal<boolean>;
  static customCB: Signal<unknown>;
  static portals: Array<ToAddress>;

  public static functions: ActorFunctions = {
    //initialize actor
    INIT: (payload) => {
      Postman.state.id = `${Postman.state.name}@${crypto.randomUUID()}`;
      Postman.PostMessage(worker, {
        address: { fm: Postman.state.id, to: System },
        type: "LOADED",
        payload: Postman.state.id,
      });
      Postman.functions.CUSTOMINIT?.(null, Postman.state.id);
      console.log(`initied ${Postman.state.id} actor with args:`, payload);
    },

    //register self to system
    REGISTER: (payload) => {
      Postman.creationSignal.trigger(payload as ToAddress);
    },

    //terminate
    SHUT: (_payload) => {
      console.log("Shutting down...");
      worker.terminate();
    },

    RTC: async (_payload) => {
      console.log("creating rtc socket");
      const _socket = await Postman.creatertcsocket();
    },

    CONNECT: (payload) => {
      Postman.state.socket?.send(JSON.stringify({
        type: "create_offer",
        targetPeerId: payload,
      }));
    },
    CB: (payload) => {
      if (!Postman.customCB) throw new Error("UNEXPECTED CALLBACK");
      Postman.customCB.trigger(payload);
    },
  };

  constructor(
    _worker: ActorWorker,
    functions: ActorFunctions,
    state: BaseState,
  ) {
    Postman.state = state;
    Postman.functions = { ...Postman.functions, ...functions };
  }

  static runFunctions(message: Message) {
    if (notAddressArray(message.address)) {
      const address = message.address as MessageAddressReal;
      console.log(
        `[${address.to}]Actor running function, type: ${message.type}, payload: ${JSON.stringify(message.payload)}`,
      );

      (this.functions[message.type] as PayloadHandler<typeof message.type>)?.(
        message.payload as Payload[typeof message.type],
        address,
      );
    } else throw new Error("not address array");
  }

  static async PostMessage(
    worker: ActorWorker,
    message: Message,
    cb?: boolean,
  ): Promise<unknown | undefined> {
    if (cb) {
      console.log("cb enabled");
      Postman.customCB = new Signal<unknown>();
      Postman.posterr(worker, message);
      const result = await Postman.customCB.wait();
      return result;
    } //use return false if fail to send msg for some reason
    else {
      Postman.posterr(worker, message);
    }
  }

  static async posterr(worker: ActorWorker, message: Message) {
    if (
      Postman.state.socket &&
      Postman.state.socket !== null &&
      Postman.state.socket.readyState === WebSocket.OPEN
    ) {
      //check portal

      Postman.portalCheckSignal = new Signal<boolean>();
      Postman.state.socket.send(JSON.stringify({
        type: "query_dataPeers",
        from: Postman.state.id,
        targetPeerId: message.address.to,
      }));
      const result: boolean = await Postman.portalCheckSignal.wait();
      if (result) {
        console.log("wat");
        Postman.state.socket.send(JSON.stringify({
          type: "send_message",
          targetPeerId: message.address.to,
          payload: message,
        }));
      } else {
        console.error("trough rtc failed, trying locally");
        worker.postMessage(message);
      }
    }
    else {
      worker.postMessage(message);
    }
  }

  static async create(
    worker: ActorWorker,
    actorname: string,
    state: BaseState,
  ): Promise<ToAddress> {
    Postman.creationSignal = new Signal<ToAddress>();

    worker.postMessage({
      address: { fm: state.id, to: System },
      type: "CREATE",
      payload: actorname,
    });

    const result = await Postman.creationSignal.wait();

    return result;
  }

  /**
   * Sets state.socket to a new rtc socket
   */
  static async creatertcsocket() {
    const port = getAvailablePort();
    if (!port) {
      throw new Error("no port available");
    }
    const server = new WebRTCServer(Postman.state.id, port);
    const socket = await server.start();
    Postman.state.socket = socket;
    socket.addEventListener("open", () => {
      console.log("socket open");
      socket.send(JSON.stringify({
        type: "portalSet",
        payload: Postman.state.id,
      }));
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      console.log("got message raw", data);
      if (data.type === "webrtc_message_custom") {
        const message = JSON.parse(data.rtcmessage) as Message;
        console.log("got custom message", message);
        if (message.address.to === Postman.state.id) {
          Postman.runFunctions(message);
        } else {
          throw new Error("message not to self");
        }
      } else if (data.type === "query_dataPeers") {
        const message = JSON.parse(data.rtcmessage);
        Postman.portalCheckSignal.trigger(message);
      }
    });
    while (socket.readyState !== WebSocket.OPEN) {
      await wait(100);
    }
    return true;
  }

  static addPortal(worker: Worker, actorAddr: string, portal: string) {
    worker.postMessage({
      address: System,
      type: "addPortal",
      payload: [actorAddr, portal],
    });
  }
}


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
import { WebRTCInterface } from "./webrtcInterface.ts";
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
  static webRTCInterface: WebRTCInterface;

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
    CB: (payload) => {
      if (!Postman.customCB) throw new Error("UNEXPECTED CALLBACK");
      Postman.customCB.trigger(payload);
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
      console.log("Initializing WebRTC interface");
      await Postman.initWebRTCInterface();
    },  

    CONNECT: async (payload, address) => {
      const addr = address as MessageAddressReal;
      Postman.webRTCInterface.sendToNodeProcess({
        type: "create_offer",
        targetPeerId: payload,
      });

      await wait(1000);

      // This needs to be adjusted based on how we determine connection status
      const isConnected = true; // Placeholder
      Postman.PostMessage(worker, {
        address: { fm: Postman.state.id, to: addr.fm },
        type: "CB:CONNECT",
        payload: isConnected,
      });
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
      Postman.webRTCInterface
    ) {
      //check portal

      Postman.portalCheckSignal = new Signal<boolean>();
      console.log("trying to query dataPeers")
      console.log(Postman.state.id)
      console.log(message.address.to)
      Postman.webRTCInterface.sendToNodeProcess({
        type: "query_dataPeers",
        from: Postman.state.id,
        targetPeerId: message.address.to,
      });
      const result: boolean = await Postman.portalCheckSignal.wait();
      if (result) {
        Postman.webRTCInterface.sendToNodeProcess({
          type: "send_message",
          targetPeerId: message.address.to,
          payload: message,
        });
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


  static async initWebRTCInterface() {
    const port = await getAvailablePort();
    if (!port) {
      throw new Error("No port available");
    }
    Postman.webRTCInterface = new WebRTCInterface(Postman.state.id, port);
    await Postman.webRTCInterface.start();

    Postman.webRTCInterface.onMessage((data) => {
      console.log("Received message from WebRTC interface:", data);
      if (data.type === "webrtc_message_custom") {
        const message = JSON.parse(data.rtcmessage) as Message;
        if (message.address.to === Postman.state.id) {
          Postman.runFunctions(message);
        } else {
          throw new Error("Message not to self");
        }
      } else if (data.type === "query_dataPeersReturn") {
        Postman.portalCheckSignal.trigger(data.rtcmessage);
      }
    });
  }
}
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
} from "../actorsystem/types.ts";
import { ActorWorker } from "../actorsystem/ActorWorker.ts";
import { wait } from "../actorsystem/utils.ts";
import { WebRTCInterface } from "./webrtcInterface.ts";
import { getAvailablePort } from "jsr:@std/net";
import * as JSON from "../classes/JSON.ts";
import { CustomLogger } from "../classes/customlogger.ts";

export const OnMessage = (handler: (message: Message) => void) => {
  const worker = self as unknown as ActorWorker;
  worker.onmessage = (event: MessageEvent) => {
    const message = event.data as Message;
    handler(message);
  };
};

export class Postman {
  static worker: ActorWorker = self as unknown as ActorWorker;
  static state: BaseState;
  static creationSignal: Signal<ToAddress>;
  static portalCheckSignal: Signal<boolean>;
  static customCB: Signal<unknown>;
  static portals: Array<ToAddress>;
  static webRTCInterface: WebRTCInterface;
  private static topic: string | null = null;
  static addressBook: Set<string>;
  static hmm: any;

  private static pendingTopicSet: string | null = null;

  public static functions: ActorFunctions = {
    //initialize actor
    INIT: (payload) => {
      Postman.state.id = `${Postman.state.name}@${crypto.randomUUID()}`;
      Postman.PostMessage({
        address: { fm: Postman.state.id, to: System },
        type: "LOADED",
        payload: Postman.state.id,
      });
      Postman.functions.CUSTOMINIT?.(null, Postman.state.id);
      CustomLogger.log("class", `initied ${Postman.state.id} actor with args:`, payload);
    },
    CB: (payload) => {
      console.log("CB", payload)
      if (!Postman.customCB) throw new Error("UNEXPECTED CALLBACK");
      Postman.customCB.trigger(payload);
    },

    //register self to system
    REGISTER: (payload) => {
      Postman.creationSignal.trigger(payload as ToAddress);
    },

    //terminate
    SHUT: (_payload) => {
      CustomLogger.log("class", "Shutting down...");
      this.worker.terminate();
    },

    RTC: async (_payload) => {
      CustomLogger.log("class", "Initializing WebRTC interface");
      await Postman.initWebRTCInterface();
    },
    SET_TOPIC: async (payload, address) => {
      const addr = address as MessageAddressReal;
      Postman.hmm = addr.fm
      const topicId = payload as string | null;
      Postman.attemptSetTopic(topicId);
    },
  };

  constructor(
    _worker: ActorWorker,
    functions: ActorFunctions,
    state: BaseState,
  ) {
    Postman.state = state;
    Postman.addressBook = Postman.state.addressBook;
    Postman.functions = { ...Postman.functions, ...functions };
  }

  //#region TOPIC
  private static attemptSetTopic(topicId: string | null) {
    if (Postman.webRTCInterface.isSocketOpen()) {
      Postman.setTopicImmediate(topicId);
    } else {
      CustomLogger.log("class", "WebSocket not open. Scheduling topic set attempt.");
      Postman.pendingTopicSet = topicId;
      Postman.scheduleSetTopicAttempt();
    }
  }

  private static scheduleSetTopicAttempt() {
    setTimeout(() => {
      if (Postman.pendingTopicSet !== null) {
        if (Postman.webRTCInterface.isSocketOpen()) {
          Postman.setTopicImmediate(Postman.pendingTopicSet);
        } else {
          CustomLogger.log("class", "WebSocket still not open. Rescheduling topic set attempt.");
          Postman.scheduleSetTopicAttempt();
        }
      }
    }, 1000); // Check every second
  }

  private static setTopicImmediate(topicId: string | null) {
    Postman.topic = topicId;
    Postman.webRTCInterface.setTopic(topicId);
    Postman.pendingTopicSet = null;
    CustomLogger.log("class", `Topic set to: ${Postman.topic}`);
  }

  //#endregion

  //#region peers

  //#endregion

  static runFunctions(message: Message) {
    //console.log("customcb check: ", Postman.customCB)
    if (notAddressArray(message.address)) {
      const address = message.address as MessageAddressReal;
      CustomLogger.log(
        "class",
        `[${address.to}]Actor running function, type: ${message.type}, payload: ${
          JSON.stringify(message.payload)
        }`,
      );

      (this.functions[message.type] as PayloadHandler<typeof message.type>)?.(
        message.payload as Payload[typeof message.type],
        address,
      );
    } else throw new Error("not address array");
  }

  static async PostMessage(
    message: Message,
    cb?: boolean,
  ): Promise<unknown | undefined> {
    if (cb) {
      CustomLogger.log("class", "cb enabled");
      console.log("customCB created")
      Postman.customCB = new Signal<unknown>();
      console.log("customCB", Postman.customCB)
      Postman.posterr(message);
      const result = await Postman.customCB.wait();
      return result;
    } //use return false if fail to send msg for some reason
    else {
      Postman.posterr(message);
    }
  }

  static async posterr(message: Message) {
    const addresses = Array.isArray(message.address.to) ? message.address.to : [message.address.to];

    const addr = message.address as MessageAddressReal;

    await Promise.all(addresses.map(async (address) => {
      message.address.to = address!;
      console.log(Postman.addressBook)
      if (Postman.webRTCInterface && Postman.addressBook.has(message.address.to)) {
        Postman.webRTCInterface.sendToNodeProcess({
          type: "send_message",
          targetPeerId: message.address.to,
          payload: message,
        });
      } /* else if (Postman.webRTCInterface) {
        //check portal
        CustomLogger.log("syncloop", "portal check? ");

        throw new Error("not implemented");

        Postman.portalCheckSignal = new Signal<boolean>();
        CustomLogger.log("class", "trying to query dataPeers")
        CustomLogger.log("class", Postman.state.id)
        CustomLogger.log("class", message.address.to)
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
          CustomLogger.error("classerr", "trough rtc failed, trying locally");
          this.worker.postMessage(message);
        }
      } */
      else {
        this.worker.postMessage(message);
      }
    }));
  }

  static async create(
    actorname: string,
  ): Promise<ToAddress> {
    Postman.creationSignal = new Signal<ToAddress>();

    this.worker.postMessage({
      address: { fm: Postman.state.id, to: System },
      type: "CREATE",
      payload: actorname,
    });

    const result = await Postman.creationSignal.wait();

    return result;
  }

  static addPeerToAddressBook(peerId: string) {
    if (!Postman.addressBook.has(peerId)) {
      Postman.addressBook.add(peerId);
      CustomLogger.log("class", `New peer available: ${peerId}`);
      CustomLogger.log("class", `Current peers: ${Array.from(Postman.addressBook).join(", ")}`);
    }
  }

  static async initWebRTCInterface() {
    const port = await getAvailablePort();
    if (!port) {
      throw new Error("No port available");
    }
    Postman.webRTCInterface = new WebRTCInterface(Postman.state.id, port);
    await Postman.webRTCInterface.start();

    Postman.webRTCInterface.onMessage((data:any) => {

      CustomLogger.log("class", "Received message from WebRTC interface:", data);
      if (data.type === "peer_available") {
        console.log("Peer available adding to addressbook:", data.peerId);
        Postman.addPeerToAddressBook(data.peerId);
      } else if (data.type === "petplay_message") {
        const message = JSON.parse(data.payload) as Message;
        if (message.address.to === Postman.state.id) {
          Postman.runFunctions(message);
        } else {
          throw new Error("Message not to self");
        }
      } else if (data.type === "topic_connected") { 
        Postman.PostMessage({
          address: { fm: Postman.state.id, to: Postman.hmm },
          type: "CB:SET_TOPIC",
          payload: data.topicId,
        });
      }
    });
  }
}

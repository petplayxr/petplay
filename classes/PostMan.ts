
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
  private static channel: string | null = null;
  static addressBook: Array<string>;


  private static pendingChannelSet: string | null = null;

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

    CONNECT: async (payload, address) => {
      const addr = address as MessageAddressReal;
      Postman.webRTCInterface.sendToNodeProcess({
        type: "create_offer",
        targetPeerId: payload,
      });

      await wait(1000);

      // This needs to be adjusted based on how we determine connection status
      const isConnected = true; // Placeholder
      Postman.PostMessage({
        address: { fm: Postman.state.id, to: addr.fm },
        type: "CB:CONNECT",
        payload: isConnected,
      });
    },
    SET_CHANNEL: (payload) => {
      const channelId = payload as string | null;
      Postman.attemptSetChannel(channelId);
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

  private static broadcastInterval: number | null = null;
  private static queryInterval: number | null = null;

  private static attemptSetChannel(channelId: string | null) {
    if (Postman.webRTCInterface.isSocketOpen()) {
      Postman.setChannelImmediate(channelId);
    } else {
      CustomLogger.log("class", "WebSocket not open. Scheduling channel set attempt.");
      Postman.pendingChannelSet = channelId;
      Postman.scheduleSetChannelAttempt();
    }
  }

  private static scheduleSetChannelAttempt() {
    setTimeout(() => {
      if (Postman.pendingChannelSet !== null) {
        if (Postman.webRTCInterface.isSocketOpen()) {
          Postman.setChannelImmediate(Postman.pendingChannelSet);
        } else {
          CustomLogger.log("class", "WebSocket still not open. Rescheduling channel set attempt.");
          Postman.scheduleSetChannelAttempt();
        }
      }
    }, 1000); // Check every second
  }

  private static setChannelImmediate(channelId: string | null) {
    Postman.channel = channelId;
    Postman.webRTCInterface.setChannel(channelId);
    if (channelId) {
      Postman.startChannelBroadcastAndQuery();
    } else {
      Postman.stopChannelBroadcastAndQuery();
    }
    Postman.pendingChannelSet = null;
    CustomLogger.log("class", `Channel set to: ${Postman.channel}`);
  }



  private static startChannelBroadcastAndQuery() {
    Postman.broadcastInterval = setInterval(() => {
      Postman.webRTCInterface.broadcastAddress();
    }, 3000); // Broadcast every 30 seconds

    Postman.queryInterval = setInterval(() => {
      Postman.webRTCInterface.queryAddresses();
    }, 5000); // Query every 10 seconds
  }

  private static stopChannelBroadcastAndQuery() {
    if (Postman.broadcastInterval) clearInterval(Postman.broadcastInterval);
    if (Postman.queryInterval) clearInterval(Postman.queryInterval);
  }

  static runFunctions(message: Message) {
    if (notAddressArray(message.address)) {
      const address = message.address as MessageAddressReal;
      CustomLogger.log("class",
        `[${address.to}]Actor running function, type: ${message.type}, payload: ${JSON.stringify(message.payload)}`,
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
      Postman.customCB = new Signal<unknown>();
      Postman.posterr(message);
      const result = await Postman.customCB.wait();
      return result;
    } //use return false if fail to send msg for some reason
    else {
      Postman.posterr(message);
    }
  }

  static async posterr(message: Message) {
    const addresses = Array.isArray(message.address.to)
      ? message.address.to
      : [message.address.to];

    const addr = message.address as MessageAddressReal;

    await Promise.all(addresses.map(async (address) => {
      message.address.to = address!;

      
      if (Postman.webRTCInterface && Postman.addressBook.includes(addr.to)) {
        if (message.address.to.startsWith("overlay")) {
          CustomLogger.log("syncloop", "address " + message.address.to);
        }
        Postman.webRTCInterface.sendToNodeProcess({
          type: "send_message",
          targetPeerId: addr.to,
          payload: message,
        });


      } else if (Postman.webRTCInterface) {
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
      }
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
  private static updateAddressBook(addresses: string[]) {
    addresses.forEach(addr => Postman.state.addressBook.push(addr));
  }


  static async initWebRTCInterface() {
    const port = await getAvailablePort();
    if (!port) {
      throw new Error("No port available");
    }
    Postman.webRTCInterface = new WebRTCInterface(Postman.state.id, port);
    await Postman.webRTCInterface.start();

    Postman.webRTCInterface.onMessage((data) => {
      CustomLogger.log("class", "Received message from WebRTC interface:", data);
      if (data.type === "address_update") {
        Postman.updateAddressBook(data.addresses);
      } else if (data.type === "webrtc_message_custom") {
        const message = JSON.parse(data.rtcmessage) as Message;
        if (message.address.to === Postman.state.id) {
          Postman.runFunctions(message);
        } else {
          throw new Error("Message not to self");
        }
      }
      if (Postman.pendingChannelSet !== null) {
        Postman.attemptSetChannel(Postman.pendingChannelSet);
      }

      else if (data.type === "query_dataPeersReturn") {
        Postman.portalCheckSignal.trigger(data.rtcmessage);
      }


    });
  }
}
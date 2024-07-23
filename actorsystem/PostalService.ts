import { ActorFunctions, MessageAddressReal } from "./types.ts";
import { Signal } from "./utils.ts";
import {
  Message,
  nonArrayAddress,
  notAddressArray,
  Payload,
  PayloadHandler,
  System,
  ToAddress,
} from "./types.ts";
import { ActorWorker } from "./ActorWorker.ts";

export class PostalService {
  public static actors: Map<string, ActorWorker> = new Map();
  public static remoteActors: Array<ToAddress> = [];
  static signal: Signal<ToAddress>;

  async add(address: string): Promise<ToAddress> {
    PostalService.signal = new Signal<ToAddress>();

    const worker: ActorWorker = new ActorWorker(
      new URL(`../actors/${address}`, import.meta.url).href,
      {
        type: "module",
      },
    );

    //attach message handler
    worker.onmessage = (event: MessageEvent<Message>) => {
      const message: Message = event.data;
      this.handleMessage(worker, message);
    };
    //send init message
    worker.postMessage({
      address: { fm: System, to: null },
      type: "INIT",
      payload: null,
    });

    const id = await PostalService.signal.wait();
    console.log("created", id);
    PostalService.actors.set(id, worker);
    return id;
  }

  murder(address: string) {
    const worker = PostalService.actors.get(address);
    if (worker) {
      worker.terminate();
      PostalService.actors.delete(address);
    }
  }

  //onmessage
  handleMessage = (worker: Worker, message: Message) => {
    const addresses = Array.isArray(message.address)
      ? message.address
      : [message.address];

    addresses.forEach((_address) => {


      // if message type starts with CB
      if (message.type.startsWith("CB")) {
        //console.log("CB message", message);
        message.type = "CB";
      }

      const address: nonArrayAddress = message.address as nonArrayAddress;
      console.log("postalService handleMessage", message.type);
      // redirect message
      switch (address.to) {
        case null:
          throw new Error();
        case System:
          this.systemFunctions(worker, message);
          break;
        default:
          // message address is to another actor
          if (!PostalService.actors.has(address.to)) {
            console.error("No actor found");
            console.log(PostalService.actors)
            // using portal instead
          }
          const targetWorker = PostalService.actors.get(address.to)!;
          targetWorker.postMessage(message);
      }
    });
  };

  systemFunctions(worker: ActorWorker, message: Message): void {
    const functions: ActorFunctions = {
      KEEPALIVE: (_payload) => {
        worker.postMessage({
          address: { fm: System, to: null },
          type: "KEEPALIVE",
          payload: null,
        });
      },

      //create an actor
      CREATE: async (payload) => {
        const id = await this.add(payload as string);
        worker.postMessage({
          address: { fm: System, to: null },
          type: "REGISTER",
          payload: id,
        });
      },

      //actor notified us that it had loaded
      LOADED: (payload) => {
        PostalService.signal.trigger(payload as ToAddress);
      },
      DELETE: (payload) => {
        PostalService.actors.delete(payload as ToAddress);
      },

      //actor murders someone
      MURDER: (payload) => {
        this.murder(payload);
      },
      ADDREMOTE: (payload) => {
        PostalService.remoteActors.push(payload);
      },
    };

    const address = message.address as MessageAddressReal;
    (functions[message.type] as PayloadHandler<typeof message.type>)?.(
      message.payload as Payload[typeof message.type],
      address,
    );
  }

  Post(rMessage: Message): void {
    // if address not valid json, stringify it
    if (typeof rMessage.address === "object") {
      rMessage.address = JSON.stringify(
        rMessage.address,
      ) as unknown as MessageAddressReal;
    }

    const address = JSON.parse(rMessage.address as unknown as string);
    console.log(
      `PostalService processing message:\n${rMessage.address}\nmessage type: ${rMessage.type}\npayload: ${rMessage.payload}\n`,
    );
    if (!notAddressArray(address)) {
      throw new Error("not address array");
    }

    if (address.to !== null && PostalService.actors.has(address.to)) {
      const worker: ActorWorker = PostalService.actors.get(address.to)!;

      worker.postMessage({
        address: { fm: System, to: address.to },
        type: rMessage.type,
        payload: rMessage.payload,
      } as Message);
    } else {
      console.error(`No worker found for address ${address.to}`);
    }
  }
}

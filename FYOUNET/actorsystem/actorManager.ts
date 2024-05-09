import { Actor, Connection, Address, ActorMessage, ActorPayload, isActorId, isActorName, isRemoteActorId } from "./types.ts";
import { Message } from "./message.ts";
import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";

//actor manager actor
export class actorManager extends Actor {
  public actors: Record<string, Actor> = {};
  private localip: string;

  constructor(localip: string) {
    super()
    this.localip = localip;
    this.actorname = "actorManager";
    //this.actors[this.actorid] = this;
  }

  //uuid: string = crypto.randomUUID();
  peers: Record<string, Connection> = {};

  /**
   * Adds an actor to the actor manager.
   * 
   * @param actor The actor to be added.
   * @returns The address of the added actor.
   */
  add<T extends Actor>(actor: T): Address<T> {
    this.actors[actor.actorid] = actor;
    actor.onAdd(this);
    return this.addressOf(actor);
  }

  addressOf<T extends Actor>(actor: T): Address<T> {
    return `${actor.actorid}` as Address<T>;
  }

  remove(addr: Address<unknown>): void {
    const split = (addr as string).split(":");
    const uuid = split[1];

    const actor = this.actors[uuid as string];
    if (actor !== undefined) {
      actor.onRemove();
    }
    delete this.actors[uuid as string];
  }

  listactors() {
    console.log("LISTACTORS:");
    //console.log("LISTACTORS:", JSON.stringify(this.actors));
  }

  getlocalActor(actorname: string) {
    const myip = this.localip
    const localActor = Object.values(this.actors).find(actor => {
      // Check if the actor has a publicIp property
      if (actor.publicIp) {
        // Assuming publicIp is in the format "ip:port"
        const [ip, port] = actor.publicIp.split(':');
        // Compare only the port part with myip
        return ip === myip;
      } else {
        // If the actor does not have a publicIp, you might want to skip the comparison
        // or handle it differently based on your application's logic
        return false;
      }
    });

    // Check if the actorname matches
    if (localActor && localActor.actorname === actorname) {
      return localActor;
    }

    // If no actor matches the criteria, return undefined
    return undefined;
  }

  /**
   * Commands an actor to perform an action.
   * @param addr The address of the actor.
   * @param type The command.
   * @param payload The payload associated with the message.
   * @returns A promise that resolves when the message is sent.
   */
  async command<T, K extends ActorMessage<T>>(
    addr: Address<T>,
    type: K,
    payload: ActorPayload<T, K>
  ): Promise<void> {


    if (isActorId(addr)) {
      console.log("hasactorid, lets find actor")
      if (isRemoteActorId(addr)) {
        console.log("remoteactor")

        const message = new Message(addr, type, payload);

        const split = (addr as string).split("@");
        const actorid = split[0];
        const Fip = split[1];
        const split2 = Fip.split(":");
        const ip = split2[0];
        if (ip === this.localip) {
          const actor = this.actors[actorid as string] as any;
          if (actor === undefined) {
            console.error(`Actor with UUID ${addr as string} not found.`);
          } else {
            await actor[type]?.(this, payload);
          }
          return;

        }


        const conn = this.peers[actorid];
        if (conn === undefined) {
          console.error(`Peer with UUID ${peer} not found.`);
        } else {
          await conn.send(message);
        }
        return;


      }
      else {

        const actor = this.actors[addr as string] as any;
        if (actor === undefined) {
          console.error(`Actor with UUID ${addr as string} not found.`);
        } else {
          await actor[type]?.(this, payload);
        }
        return;
      }

    }
    else if (isActorName(addr)) {
      console.log("address has no UUID, assume local actor. insecure true")
      const actor = this.getlocalActor(addr as string) as any;
      if (actor === undefined) {
        console.error(`Actor with name ${addr as string} not found.`);
      } else {
        await actor[type]?.(this, payload);
      }
      return;
    }




    //
    /* if (peer === this.uuid) {
      // deno-lint-ignore no-explicit-any
      const actor = this.actors[uuid] as any;
      if (actor === undefined) {
        console.error(`Actor with UUID ${uuid} not found.`);
      } else {
        await actor[type]?.(this, payload);
      }
      return;
    } */

    //

  }
}

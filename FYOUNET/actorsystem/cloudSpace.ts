import { Actor, Connection, Address, CloudAddress, createCloudActorAddress, SerializedState, isActorId, isRemoteAddress, isActorName } from "./types.ts";
import { ActorP2P } from "./actorP2P.ts"
import { Message } from "./message.ts";
import { actorManager } from "./actorManager.ts";
import { ActorMessage, ActorPayload } from "./types.ts";


export type cloudPayload = {
  addr: Address<ActorP2P>,
  username: string,
} & ({ msg: string } | { event: "JOIN" | "LEAVE" })

export class cloudSpace extends ActorP2P<cloudSpace> {
  private cloudAddress: Address<cloudSpace> = this.actorid as Address<cloudSpace>;
  private username:string;
  private names: Record <string, string> = {};
  public actors: Record <CloudAddress<cloudSpace>, Actor> = {};
  private peers: Record <string, Connection> = {};

  constructor(localip: string) {
    super("cloudSpace",localip)
    this.actorname = "actorManager";
    this.username = "cloudSpace";
  }
  

  /**
   * Adds an actor to the actor manager.
   * 
   * @param actor The actor to be added.
   * 
   * @returns The cloud address of the added actor.
   */
  add<T extends ActorP2P>(actor: T, state?: SerializedState<T>): CloudAddress<cloudSpace> {
    const addr = createCloudActorAddress(this.cloudAddress, actor.actorid)
    this.actors[addr] = actor;
    actor.onAdd(this);
    actor.onStart(state);
    return this.addressOf(actor);
  }

  //get full address of an actor by passing the id of the actor
  addressOf<T extends ActorP2P>(actor: T): CloudAddress<cloudSpace> {
    // Iterate over the actors object to find the actor by its instance
    for (const [key, value] of Object.entries(this.actors)) {
      if (value === actor) {
        //public actors: Record <CloudAddress<cloudSpace>, Actor> = {};
        return key as CloudAddress<cloudSpace>;
      }
    }
  
    // If the actor is not found, throw an error or handle accordingly
    throw new Error(`Actor not found in the cloud space.`);
  }

  //remove actor from our global actor list?
  remove(addr: CloudAddress<cloudSpace>): void {

    delete this.actors[addr];
  }

  override async onConnect(ctx: actorManager, addr: Address<cloudSpace>): Promise<void> {
    await ctx.command(addr, "h_receive", {
      addr: ctx.addressOf(this),
      username: this.username,
      event: "JOIN",
    });
  }

  override onDisconnect(ctx: actorManager, addr: Address<cloudSpace>): Promise<void> {
    if (addr as string in this.names) {
      this.h_receive(ctx, {
        addr,
        username: this.names[addr as string],
        event: "LEAVE",
      });
    }
    return Promise.resolve();
  }

  h_receive(_: actorManager, msg: cloudPayload) {
    this.names[msg.addr as string] = msg.username;
    if ("event" in msg) {
      switch (msg.event) {
        case "JOIN": {
          console.log(`${msg.username} joined the chat`);
          break;
        }
        case "LEAVE": {
          delete this.names[msg.addr as string];
          console.log(`${msg.username} left the chat`);
          break;
        }
      }
    } else {
      console.log(`<${msg.username}> ${msg.msg}`);
    }
  }

  async h_broadcast(ctx: actorManager, msg: string) {

    //console.log(`<${this.name}> ${msg}`);
    console.log(this.actorid)

    await this.broadcast(ctx, "h_receive", {
      addr: ctx.addressOf(this),
      username: this.username,
      msg,
    } as cloudPayload);
  }

  async command<T, K extends ActorMessage<T>>(
    addr: Address<T>,
    type: K,
    payload: ActorPayload<T, K> | ((...args: any[]) => void),
  ): Promise<void> {
    if (isActorId(addr)) {
      if (isRemoteAddress(addr)) {
        

        const message = new Message(addr, type, payload);

        const split = (addr as string).split("@");
        const actorid = split[0];
        const Fip = split[1];
        const split2 = Fip.split(":");
        const ip = split2[0];
        if (Fip === this.cloudAddress) {
          //deno-lint-ignore no-explicit-any
          const actor = this.actors[addr as string] as any;
          if (actor === undefined) {
            console.error(`Actor with UUID ${addr as string} not found.`);
          } else {
            await actor[type]?.(this, payload);
          }
          return;

        }


        const conn = this.peers[actorid];
        if (conn === undefined) {
          console.error(`Peer with UUID ${actorid} not found.`);
        } else {
          await conn.send(message);
        }
        return;


      }
      else {
        //deno-lint-ignore no-explicit-any
        const actor = this.actors[addr as string] as any;
        if (actor === undefined) {
          console.error(`Actor with UUID ${addr as string} not found.`);
        } else {
          //console.log('Before calling payload:', payload);
          // Check if payload is a function and adjust the arguments accordingly
          if (typeof payload === 'function') {
            // If payload is a function, pass only payload
            await actor[type]?.(payload);
          } else {
            // Otherwise, pass this and payload as before
            await actor[type]?.(this, payload);
          }
          //console.log('After calling payload:', payload);
        }
        return;
      }

    }
    else if (isActorName(addr)) {
      console.log("address has no UUID, assume local actor. insecure true")
      //deno-lint-ignore no-explicit-any
      const actor = this.getlocalActor(addr as string) as any;
      if (actor === undefined) {
        console.error(`Actor with name ${addr as string} not found.`);
      } else {
        await actor[type]?.(this, payload);
      }
      return;
    }
  }

  


}

import { Actor, Connection, Address, ActorMessage, ActorPayload, isActorId, isActorName, isRemoteActorId } from "./types.ts";
import { aPortal } from "../actors/PortalActor.ts";
import { ActorP2P } from "./actorP2P.ts"
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
  public webportals: Record< Address<aPortal>, aPortal > = {};

  /**
   * Adds an actor to the actor manager.
   * 
   * @param actor The actor to be added.
   * 
   * @returns The address of the added actor.
   */
  add<T extends Actor>(actor: T): Address<T> {
    this.actors[actor.actorid] = actor;
    actor.onAdd(this);
    return this.addressOf(actor);
  }

  //get full address of an actor by passing the id of the actor
  addressOf<T extends Actor>(actor: T): Address<T> {
    return `${actor.actorid}` as Address<T>;
  }

  //remove actor from our global actor list?
  remove(addr: Address<unknown>): void {
    const split = (addr as string).split(":");
    const uuid = split[1];

    const actor = this.actors[uuid as string];
    if (actor !== undefined) {
      actor.onRemove();
    }
    delete this.actors[uuid as string];
  }



  //list all actors in actor manager
  listactors() {
  console.log("LISTACTORS:");
  Object.entries(this.actors).forEach(([actorId, actor]) => {
      console.log(`Actor ID: ${actorId}`);
      //;console.log(JSON.stringify(actor));
  });
  Object.entries(this.webportals).forEach(([RemotePortalAddress, Portal]) => {
      if (Portal.actorname == "Portal") {
        console.log("a remote portal: "+ RemotePortalAddress)
        const addr : Address<aPortal> = RemotePortalAddress as Address<aPortal>;
        this.command(addr, "h_listactors", this.getLocalPortal())
      }

  });
  
  }

  getLocalPortal(): Address<aPortal> {
    const portal = Object.values(this.actors).find(actor => actor.actorname === "Portal");
    return portal? portal.actorid : undefined;
  }

  //correct typechecking to use actorp2p as that has a publicip
  getlocalActor(actorname: string) {
    const myip = this.localip
    const localActor = Object.values(this.actors).find((actor: Actor) => {

      if (actor.publicIp) {



        return actor.publicIp === myip;
      } else {

        return false;
      }
    });


    if (localActor && localActor.actorname === actorname) {
      return localActor;
    }

    // If no actor matches the criteria, return undefined
    return undefined;
  }

  /**
   * Tell actor to do something
   * @param addr     :  The address of the actor.
   * @param type     :  The type of the command.
   * @param payload  :  The payload associated with the message.
   * 
   * @returns A promise that resolves when the message is sent.
   */
  async command<T, K extends ActorMessage<T>>(
    addr: Address<T>,
    type: K,
    payload: ActorPayload<T, K>
  ): Promise<void> {


    if (isActorId(addr)) {
      if (isRemoteActorId(addr)) {
        //console.log("remoteactor")

        const message = new Message(addr, type, payload);

        const split = (addr as string).split("@");
        const actorid = split[0];
        const Fip = split[1];
        const split2 = Fip.split(":");
        const ip = split2[0];
        if (Fip === this.localip) {
          //deno-lint-ignore no-explicit-any
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

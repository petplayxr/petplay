import { Actor, Connection, Address, ActorMessage, ActorPayload, isActorId, isActorName, isRemoteAddress, CloudAddress, SerializedState } from "./types.ts";
import { aPortal } from "../actors/PortalActor.ts";
import { ActorP2P } from "./actorP2P.ts"
import { Message } from "./message.ts";
import { cloudSpace } from "./cloudActorManager.ts";

//actor manager actor
export class actorManager extends Actor {
  public actors: Record<string, Actor | ActorP2P> = {};
  private localip: string;
  peers: Record<string, Connection> = {};
  public webportals: Record< Address<aPortal>, aPortal > = {};

  constructor(localip: string) {
    super()
    this.localip = localip;
    this.actorname = "actorManager";
  }
  

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

  //remove actor from our global actor list?
  async remove(addr: Address<unknown>): Promise<void> {
    /* const split = (addr as string).split(":");
    const uuid = split[1]; */
  
    const actor = this.actors[addr];
    if (actor!== undefined) {
      await actor.onRemove();
    }
    delete this.actors[addr];
  }

  // Transfer an actor to the cloudSpace
  async transferToCloudSpace<T extends Address<ActorP2P>>(actor: T, cloudspace: cloudSpace): Promise<CloudAddress<T>> {
    console.log("TRANSEFERRING ACTOR TO CLOUDSPACE")

    const localActor = Object.values(this.actors).find((actor) => actor instanceof ActorP2P);

    if(localActor) {

      const data = localActor?.serialize();

      await this.remove(this.addressOf(localActor));  // Remove from local actor manager

      const cloudAddress = cloudspace.add(localActor as ActorP2P, data as SerializedState<ActorP2P>) as CloudAddress<T>;  // Add to cloudSpace
      return cloudAddress;
    }
    
    else {
      console.error(`Actor with UUID ${actor as string} not found.`);
      throw new Error(`Actor with UUID ${actor as string} not found.`);
    }
  }

  

  

  
  

  //#region extras

  getLocalPortal(): Address<aPortal> {
    const portal = Object.values(this.actors).find(actor => actor.actorname === "Portal");
    return portal? portal.actorid : undefined;
  }

  //get full address of an actor by passing the id of the actor
  addressOf<T extends Actor>(actor: T): Address<T> {
    return `${actor.actorid}` as Address<T>;
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

  getActorPubIp(actorid: string): string {
    const actor = this.actors[actorid];
    return actor? (actor as ActorP2P).publicIp : undefined;
  }

  //list all actors in actor manager
  listactors() {
    console.log("LISTACTORS:");
    Object.entries(this.actors).forEach(([actorId, _actor]) => {
        console.log(`LocalActor: ${actorId}`);
        //;console.log(JSON.stringify(actor));
    });
    Object.entries(this.webportals).forEach(([RemotePortalAddress, Portal]) => {
        if (Portal.actorname == "Portal") {
          console.log("RemotePortal: "+ RemotePortalAddress)
          const addr : Address<aPortal> = RemotePortalAddress as Address<aPortal>;
          this.command(addr, "h_listactors", this.getLocalPortal())
        }

    });
  }


  //#endregion

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
    payload: ActorPayload<T, K> | ((...args: any[]) => void),
  ): Promise<void> {
    if (isActorId(addr)) {
      if (isRemoteAddress(addr)) {
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

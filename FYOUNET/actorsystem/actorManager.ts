import { Actor, Connection, Address, ActorMessage, ActorPayload, ActorId } from "./types.ts";
import { Message } from "./message.ts";

//actor manager actor
export class actorManager extends Actor {
  private actors: Record<string, Actor> = {};
  
  constructor() {
    super()
    this.actorname = "actorManager";
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
    console.log("LISTACTORS:", JSON.stringify(this.actors));
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


    function isLocal(pet: ActorId | Address<T>): pet is ActorId {
      return (<ActorId>pet) !== undefined;
    }
    function isRemote(pet: ActorId | Address<T>): pet is Address<T> {
      return (<Address<T>>pet) !== undefined;
    }
    if (isLocal(addr)) {
      console.log("local")
      const actor = this.actors[addr as string] as any;
      if (actor === undefined) {
        console.error(`Actor with UUID ${addr as string} not found.`);
      } else {
        await actor[type]?.(this, payload);
      }
      return;
    }
    else if (isRemote(addr)) {
      console.log("remote")

    }


    const message = new Message(addr, type, payload);
    console.log(message)

    //relay actor message to remote actor
    if (split.length === 1) {

    }

    const peer = split[0];
    const uuid = split[1];

    //relay actor message to local actor
    if (peer === this.actorid) {
      // deno-lint-ignore no-explicit-any
      const actor = this.actors[uuid] as any;
      if (actor === undefined) {
        console.error(`Actor with UUID ${uuid} not found.`);
      } else {
        await actor[type]?.(this, payload);
      }
      return;
    }

    //???
    const conn = this.peers[peer];
    if (conn === undefined) {
      console.error(`Peer with UUID ${peer} not found.`);
    } else {
      await conn.send(message);
    }
  }
}

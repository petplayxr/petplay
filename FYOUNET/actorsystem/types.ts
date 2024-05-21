import { actorManager } from "./actorManager.ts";
import { cloudSpace } from "./cloudActorManager.ts";
import { Message } from "./message.ts";

// types

//simplest type
export type ActorName = string & { __brand: 'ActorName' };

/**
 * Represents a unique identifier for an actor within the system.
 * It is a combination of the actor's name and a UUID, separated by a colon.
 */
//ActorId an actor name an an uuid:string
export type ActorId =  string & {string: ActorName} & { __brand: 'ActorId' }

/**
 * Represents an address for an actor, including both its name and a unique identifier.
 * This type is used to uniquely identify actors across the network, allowing for direct communication.
 *
 * @template T - The additional data associated with the address.
 */
//Address is an an actorId with the actor instance as a property
export type Address<Actor> = { readonly _: Actor } & ActorId;

/**
 * Represents a remote address for an actor, including its network location.
 * This type is used to uniquely identify and communicate with remote actors.
 *
 * @template T - The additional data associated with the address.
 */
//Remote Address is combination of an ip and an actoraddress
export type RemoteAddress<ActorP2P> = Address<Actor> & { readonly _: ActorP2P } & { readonly isRemote: true };

/**
 * Represents a cloud address for an actor, indicating it is managed by a cloudSpace actor.
 * This type is used to uniquely identify and communicate with actors in the cloud.
 *
 * @template T - The additional data associated with the address.
 */
//CloudAddress is a combination of an Address of the cloudspace and the actors id
export type CloudAddress<ActorP2P> = Address<cloudSpace> & { readonly _: ActorP2P } & ActorId & { readonly isCloud: true };




// create types

function createActorId(actorname: ActorName, uuid: string): ActorId {
  return `${actorname}:${uuid}` as ActorId;
}

export function createRemoteAddress<ActorP2P>(ip:string, actorid:ActorId): RemoteAddress<ActorP2P> {
  return `${ip}@${actorid}` as RemoteAddress<ActorP2P>;
}

export function createCloudActorAddress<ActorP2P>(cloudAddress : Address<cloudSpace>, ActorAddress: ActorId): CloudAddress<ActorP2P> {

  return `${ActorAddress}@${cloudAddress}` as CloudAddress<ActorP2P>;
}

//manual type guards?

export function isActorName(value: string): value is ActorName {
  return !value.includes(":");
}

export function isActorId(value: string): value is ActorId {
  return value.includes(":");
}

export function isAddress(value: string): value is Address<Actor> {
  return isActorId(value);
}

export function isRemoteAddress(value: string): value is Address<Actor> {
  return value.includes("@");
}

export function isCloudActorAddress(value: string): value is CloudAddress<Actor> {
  return value.includes("@") && isActorId(value);
}

export type ActorState<T> = Record<string, unknown> & { readonly _: T };

export type SerializedState<T> = {
  actorid: ActorId;
  actorname: ActorName;
  uuid: string;
  state: ActorState<T>;
};

export class Actor {
  protected _uuid: string = crypto.randomUUID();
  protected _actorname: ActorName = "BaseActor" as ActorName;
  protected _actorid: ActorId;
  protected _state: ActorState<Actor>; // Internal state

  constructor(state?: SerializedState<Actor>) {
    this._actorid = createActorId(this._actorname, this._uuid);
    if (state) {
      this.deserialize(state);
    }
    this._state = { _: this } as ActorState<Actor>;
  }

  public set actorname(actorName: string) {
    this._actorname = actorName as ActorName;
    // Update the combined ID property when the actorName changes
    this._actorid = createActorId(this._actorname, this._uuid);
  }
  public get actorname(): string {
    return this._actorname;
  }

  public get actorid(): ActorId {
    return this._actorid;
  }

  public get state(): ActorState<Actor> {
    return this._state;
  }

  public set state(newState: ActorState<Actor>) {
    this._state = newState;
  }

  // Serialize the actor's state
  serialize(): SerializedState<Actor> {
    return {
      actorid: this._actorid,
      actorname: this._actorname,
      uuid: this._uuid,
      state: this._state
    };
  }

  // Deserialize the actor's state
  deserialize(data: SerializedState<Actor>): ActorState<Actor> {
    this._actorid = data.actorid;
    this._actorname = data.actorname;
    this._uuid = data.uuid;
    this._state = data.state;
  
    // Return the deserialized state
    return this._state;
  }

  onAdd(_: actorManager | cloudSpace) {}

  onRemove() {}
}

export interface Connection {
  send<T>(message: Message<T>): Promise<void>;
}







/**
 * Extracts the keys of the given type `T` that match the pattern `h_${string}`.
 * 
 * @template T - The type containing keys to be filtered.
 * 
 * @example
 * type MyActorMessages = {
 *   h_doSomething: () => void;
 *   h_anotherAction: (ctx: actorManager, payload: string) => void;
 *   notIncluded: number;
 * };
 * 
 * type MyMessages = ActorMessage<MyActorMessages>; 
 * /Result: "h_doSomething" | "h_anotherAction"
 */
export type ActorMessage<T> = keyof T & `h_${string}`;

/**
 * Extracts the payload type from a method in the given type `T` that matches the key `K`.
 * If the method does not have a payload, returns `null`.
 * 
 * @template T - The type containing the method.
 * @template K - The key of the method in type `T`.
 * 
 * @example
 * type MyActorMessages = {
 *   h_doSomething: (ctx: actorManager, payload: { value: number }) => void;
 *   h_noPayload: (ctx: actorManager) => void;
 * };
 * 
 * type DoSomethingPayload = ActorPayload<MyActorMessages, "h_doSomething">;
 * / Result: { value: number } | null
 * 
 * type NoPayload = ActorPayload<MyActorMessages, "h_noPayload">;
 * / Result: null
 */

export type ActorPayload<T, K extends ActorMessage<T>> = T[K] extends (ctx: actorManager, payload: infer P) => unknown? OrNull<P> : never;

/* type OrNull<T> = T | null; */

export type OrNull<T> = T extends NonNullable<unknown> ? T : null



import { actorManager } from "./actorManager.ts";
import { cloudSpace } from "./cloudSpace.ts";
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

  return `${ActorAddress}@${cloudAddress}` as CloudAddress<T>;
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




export type OrNull<T> = T extends NonNullable<unknown> ? T : null

/**
 * Represents a message key for actors, prefixed with 'h_'.
 *
 * This type is used to define keys for messages sent between actors in the system.
 * Each key must start with 'h_', ensuring uniqueness and consistency across the system.
 * It leverages TypeScript's conditional types to ensure that only valid message keys,
 * derived from the properties of the specified type `T`, are allowed.
 *
 * @template T - The type of the actor or system defining the message keys.
 */
export type ActorMessage<T> = keyof T & `h_${string}`;

/**
 * Defines the payload structure for messages sent between actors.
 *
 * This generic type allows specifying the type of the message being sent,
 * along with the specific message key. It infers the payload type from the
 * function signature expected by the message handler, optionally allowing
 * for the payload to be nullable.
 *
 * @template T - The type of the actor or system sending/receiving the message.
 * @template K - The specific message key, extending `ActorMessage<T>`. This ensures
 *               that only valid message keys are used.
 *
 * @example
 * * Example usage
 * type MyActorMessages = {
 *   h_myFunction: (ctx: actorManager, payload: string) => void;
 * };
 *
 * * Define a payload type for a specific message
 * type MyFunctionPayload = ActorPayload<MyActorMessages, 'myFunction'>;
 *
 * * Now, MyFunctionPayload would be equivalent to `string | null`, assuming
 * * the actual function signature matches `(ctx: actorManager, payload: string) => void`.
 */

export type ActorPayload<T, K extends ActorMessage<T>> = T[K] extends (ctx: actorManager, payload: infer P) => unknown? OrNull<P> : never;





import { actorManager } from "./actorManager.ts";
import { Message } from "./message.ts";



export type ActorName = string

function createActorId(actorname: string, uuid: string): ActorId {
  return `${actorname}:${uuid}` as ActorId;
}

export function isActorId(value: string): value is ActorId {
  return value.includes(":");
}

export function isRemoteActorId(value: string): value is Address<any> {
  return value.includes("@");
}

export function isActorName(value: string): value is ActorName {
  return !value.includes(":");
}

export class Actor {
  protected _uuid: string = crypto.randomUUID();
  protected _actorname: ActorName = "BaseActor";
  protected _actorid: ActorId;

  constructor() {
    this._actorid = createActorId(this._actorname, this._uuid);
  }

  public set actorname(actorName: string) {
    this._actorname = actorName;
    // Update the combined ID property when the actorName changes
    this._actorid = createActorId(this._actorname, this._uuid);
  }
  public get actorname(): string {
    return this._actorname;
  }

  public get actorid(): ActorId {
    return this._actorid;
  }

  onAdd(_: actorManager) {}

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

/**
 * Represents a unique identifier for an actor within the system.
 * It is a combination of the actor's name and a UUID, separated by a colon.
 */
export type ActorId = string & { __brand: 'ActorId' };

/**
 * Represents an address for an actor, including both its name and a unique identifier.
 * This type is used to uniquely identify actors across the network, allowing for direct communication.
 *
 * @template T - The additional data associated with the address.
 */
export type Address<T> = string & { readonly _: T } & ActorId;

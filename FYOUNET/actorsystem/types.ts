import { actorManager } from "./actorManager.ts";
import { Message } from "./message.ts";

export type ActorId = string & { __brand: 'ActorId' };

function createActorId(actorname: string, uuid: string): ActorId {
  return `${actorname}:${uuid}` as ActorId;
}


export class Actor {
  protected _uuid: string = crypto.randomUUID();
  protected _actoname: string = "BaseActor";
  protected _actorid: ActorId;

  constructor() {
    this._actorid = createActorId(this._actoname, this._uuid);
  }

  public set actorname(actorName: string) {
    this._actoname = actorName;
    // Update the combined ID property when the actorName changes
    this._actorid = createActorId(this._actoname, this._uuid);
  }
  public get actorname(): string {
    return this._actoname;
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

export type ActorMessage<T> = keyof T & `h_${string}`;
export type ActorPayload<T, K extends ActorMessage<T>> = T[K] extends (ctx: actorManager, payload: infer P) => unknown ? OrNull<P> : never;

export type Address<T> = string & { readonly _: T } & ActorId

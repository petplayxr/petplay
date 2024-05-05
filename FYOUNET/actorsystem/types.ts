import { actorManager } from "./actorManager.ts";
import { Message } from "./message.ts";

export class Actor {
  protected _uuid: string = crypto.randomUUID();
  
  public get uuid(): string {
    return this._uuid;
  }
  public set uuid(uuid: string) {
    this._uuid = uuid;
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

export type Address<T> = string & { readonly _: T }

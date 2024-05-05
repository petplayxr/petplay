import { Actor, Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { Message } from "../actorsystem/message.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";

type BallPosition = {
  x: number;
  y: number;
  z: number;
};

export class BallActor extends ActorP2P  {
  private position: BallPosition;
  private name: string;

  constructor(publicIp: string, name: string, initialPosition: BallPosition) {
    super("ball", publicIp);
    this.name = name;
    this.position = initialPosition;
  }

  getPosition(): BallPosition {
    return this.position;
  }

  setPosition(position: BallPosition) {
    this.position = position;
  }

  async broadcastPosition(ctx: actorManager) {
    const addr = ctx.addressOf(this);
    const message = new Message(addr, "updatePosition", this.position);
    await ctx.broadcast(message);
  }

  async handleUpdatePosition(ctx: actorManager, position: BallPosition) {
    this.setPosition(position);
    await this.broadcastPosition(ctx);
  }

  async handleGetPosition(ctx: actorManager) {
    const addr = ctx.addressOf(this);
    const message = new Message(addr, "positionResponse", this.position);
    await ctx.send(message);
  }
}
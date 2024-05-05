import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { ReceivePayload } from "../main.ts";

//why should we extend networked version of actor instead of normal actor?
export class ChatApp extends ActorP2P<ChatApp> {
  private name: string;
  private messages: string[] = [];
  private names: Record<string, string> = {};

  constructor(publicIp: string, name: string) {
    super("chat", publicIp);
    this.name = name;
  }

  override async onConnect(ctx: actorManager, addr: Address<ChatApp>): Promise<void> {
    await ctx.command(addr, "h_receive", {
      addr: ctx.addressOf(this),
      name: this.name,
      event: "JOIN",
    });
  }

  override onDisconnect(ctx: actorManager, addr: Address<ChatApp>): Promise<void> {
    if (addr as string in this.names) {
      this.h_receive(ctx, {
        addr,
        name: this.names[addr as string],
        event: "LEAVE",
      });
    }
    return Promise.resolve();
  }

  h_receive(_: actorManager, msg: ReceivePayload) {
    this.names[msg.addr as string] = msg.name;
    if ("event" in msg) {
      switch (msg.event) {
        case "JOIN": {
          console.log(`${msg.name} joined the chat`);
          break;
        }
        case "LEAVE": {
          delete this.names[msg.addr as string];
          console.log(`${msg.name} left the chat`);
          break;
        }
      }
    } else {
      this.messages.push(`<${msg.name}> ${msg.msg}`);
      console.log(`<${msg.name}> ${msg.msg}`);
    }
  }

  async h_broadcast(ctx: actorManager, msg: string) {
    this.messages.push(`<${this.name}> ${msg}`);
    console.log(`<${this.name}> ${msg}`);

    await this.broadcast(ctx, "h_receive", {
      addr: ctx.addressOf(this),
      name: this.name,
      msg,
    });
  }
}

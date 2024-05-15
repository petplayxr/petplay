import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { ReceivePayload } from "../main.ts";


export class Portal extends ActorP2P<Portal> {
  private username: string;
  private addressbook: Record<string, string> = {};

  
  constructor(publicIp: string, username: string) {
    const actorname = "Portal";
    super(actorname, publicIp);
    console.log("created actor: " + this.actorid)
    this.username = username;
  }

  override async onConnect(actormanager: actorManager, addr: Address<Portal>): Promise<void> {
    //when an actor connects to the portal, we tell the portal itself
    const message: ReceivePayload = {
        addr: actormanager.addressOf(this),
        name: this.username,
        event: "JOIN",
    }
    await actormanager.command(addr, "h_receive", message );
  }

  override onDisconnect(actormanager: actorManager, addr: Address<Portal>): Promise<void> {
    if (addr as string in this.addressbook) {
      this.h_receive(actormanager, {
        addr,
        name: this.addressbook[addr as string],
        event: "LEAVE",
      });
    }
    return Promise.resolve();
  }

  h_receive(_: actorManager, msg: ReceivePayload) {

    //we add the connecting actor to the addressbook as address:name
    this.addressbook[msg.addr as string] = msg.name;
    
    
    if ("event" in msg) {
      switch (msg.event) {
        //if the event is a join, we log the name of the actor that joined
        case "JOIN": {
          console.log(`${msg.name} joined the chat`);
          break;
        }
        //if the event is a leave, we log the name of the actor that left
        case "LEAVE": {
          delete this.addressbook[msg.addr as string];
          console.log(`${msg.name} left the chat`);
          break;
        }
      }
    } else {
      
      //console.log(`<${msg.name}> ${msg.msg}`);
    }
  }

  async h_broadcast(ctx: actorManager, msg: string) {

    //console.log(`<${this.name}> ${msg}`);
    console.log(this.actorid)

    await this.broadcast(ctx, "h_receive", {
      addr: ctx.addressOf(this),
      name: this.username,
      msg,
    });
  }
}

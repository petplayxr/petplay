import { actorManager} from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { ReceivePayload } from "../../petplayApp/petplay.ts";
import { Actor, Address, isRemoteAddress } from "../actorsystem/types.ts";

/*
* Portal Actor
* You can create this actor 
* TODO: this docstring
*/
export class aPortal extends ActorP2P<aPortal> {
  private username: string;
  private addressbook: Record<string, string> = {};
  private publicIp2: string;

  
  constructor(publicIp: string, username: string) {
    const actorname = "Portal";
    super(actorname, publicIp);
    this.publicIp2 = publicIp;
    console.log("created actor: " + this.actorid)
    this.username = username;
  }

  
  override async onConnect(actormanager: actorManager, addr: Address<aPortal>): Promise<void> {
    //when an actor connects to the portal, we tell the portal itself
    //were actually telling the opposing portal?

    const netaddr = `${actormanager.addressOf(this)}@${this.publicIp2}`;

    const message: ReceivePayload = {
        addr: netaddr as Address<aPortal>,
        name: this.username,
        event: "JOIN",
    }
    await actormanager.command(addr, "h_receive", message );
  }

  override onDisconnect(actormanager: actorManager, addr: Address<aPortal>): Promise<void> {
    if (addr as string in this.addressbook) {
      this.h_receive(actormanager, {
        addr,
        name: this.addressbook[addr as string],
        event: "LEAVE",
      });
    }
    return Promise.resolve();
  }
  
  async h_listactors(ctx : actorManager, addr: Address<aPortal>) {
    console.log("HLISTACTORS:");
    if (addr = this.actorid as Address<aPortal>) {
      await Object.entries(this.addressbook).forEach(([actorId, actor]) => {
      console.log(`Actor ID: ${actorId}`);
      console.log(JSON.stringify(actor));
    });
    }
    await Object.entries(this.addressbook).forEach(([actorId, actor]) => {
        this.broadcast(ctx, "h_receive", 
        {
        addr: addr,
        name: this.username,
        msg: JSON.stringify(actor)
        });

      /* console.log(`Actor ID: ${actorId}`);
      console.log(JSON.stringify(actor)); */
    });

    
  }

  /**
   * Adds an actor to the actor portal.
   * 
   * @param actor The actor to be added.
   * 
   * @returns The address of the added actor.
   */
  h_recordAddress(ctx : actorManager, actorAddress: Address<Actor>): void {
    if (isRemoteAddress(actorAddress)) {
      const split = (actorAddress as string).split("@");
      const actorid = split[0];
      const Fip = split[1];
      this.addressbook[Fip] = actorid;
      console.log("added to addressbook " + actorid)
    }
    //really dirty code
    else this.addressbook[ctx.getActorPubIp(actorAddress)] = actorAddress;
    console.log("added to addressbook " + actorAddress)
  }

  h_receive(ctx: actorManager, msg: ReceivePayload) {

    if (isRemoteAddress(msg.addr)) {
      const split = (msg.addr as string).split("@");
      const actorid = split[0];
      const Fip = split[1];
      this.addressbook[Fip] = actorid;
      console.log("added to addressbook " + actorid)
    }
    
    //this.addressbook[msg.addr as string] = msg.name;
    
    
    if ("event" in msg) {
      switch (msg.event) {
        //if the event is a join, we log the name of the actor that joined
        case "JOIN": {
          ctx.webportals[msg.addr as Address<aPortal>] = this;
          console.log(`${msg.name}: portal opened!`);
          break;
        }
        //if the event is a leave, we log the name of the actor that left
        case "LEAVE": {
          delete this.addressbook[msg.addr as string];
          console.log(`${msg.name}: portal closed`);
          break;
        }
      }
    } else {
      
      console.log(`<${msg.name}> ${msg.msg}`);
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

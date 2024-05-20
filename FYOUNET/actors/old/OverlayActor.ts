import { Address } from "../../actorsystem/types.ts";
import { actorManager } from "../../actorsystem/actorManager.ts";
import { ActorP2P } from "../../actorsystem/actorP2P.ts";
import { ReceiveCoord } from "../../../petplayApp/bruh/OLDmain.ts";

// Import the IPCOVRConnector if it's part of another module
import { IPCOVRConnector } from "../helpermodules/IPCOVRConnector.ts";

export class OverlayActor extends ActorP2P<OverlayActor> {
    private name: string;
    private names: Record<string, string> = {};
    private ovrConnector: IPCOVRConnector;
    private connected: boolean = false;
    private latestCoord: string = "";
    private ipcconnected: boolean = false;
    private mode: string;


    // Constructor for the OverlayActor actor.
    constructor(publicIp: string, name: string, ipcport: number,mode: string) {
        super("overlay", publicIp);

        this.name = name;
        this.mode = mode;
        if (mode!=="mirror")
            {
                this.ovrConnector = new IPCOVRConnector();
                this.setupIPCConnector(ipcport);
            }

        
    }

    // when a connection between actors is made
    override async onConnect(ctx: actorManager, addr: Address<OverlayActor>): Promise<void> {
        await ctx.command(addr, "h_receive", {
            addr: ctx.addressOf(this),
            name: this.name,
            event: "JOIN",
        });
        this.connected = true;
    }

    // when a connection between actors is broken
    override onDisconnect(ctx: actorManager, addr: Address<OverlayActor>): Promise<void> {
        if (addr as string in this.names) {
            this.h_receive(ctx, {
                addr,
                name: this.names[addr as string],
                event: "LEAVE",
            });
        }
        this.connected = false;
        return Promise.resolve();
    }

    async isConnected(callback: (connected: boolean) => void) {
        if (this.ipcconnected) {
            callback(true);
        } else {
            callback(false);
        }
    }
    
    // start ipc
    setupIPCConnector(ipcport:number) {
        this.ovrConnector.connect(ipcport);
        
        //write overlay coord to latestCoord
        this.ovrConnector.subscribe(async (data) => {
            this.ipcconnected = true;
            try {
                this.latestCoord = data;
            } catch (error) {
                console.error(`Error in subscription callback: ${error}`);
            }
        });

    }

    //receive a coordinate from friend
    h_receive(_: actorManager, coord: ReceiveCoord) {
        
        this.names[coord.addr as string] = coord.name;
        if ("event" in coord) {
            switch (coord.event) {
                case "JOIN": {
                    console.log(`${coord.name} joined the chat`);
                    break;
                }
                case "LEAVE": {
                    delete this.names[coord.addr as string];
                    console.log(`${coord.name} left the chat`);
                    break;
                }
            }
        } else {
            if (this.mode == "mirror")
            {
                this.latestCoord = coord.data;
            }
            else
            {
                this.ovrConnector.updateCoord(coord.data);
                //console.log(`<${coord.name}> ${coord.data}`);
            }
        }
    }

    //begin broadcasting coord to all friends
    async h_broadcast(ctx: actorManager) {
        //console.log("Broadcasting to all friends");

        if(this.mode == "mirror")
        {
            await this.broadcast(ctx, "h_receive", {
                addr: ctx.addressOf(this),
                name: this.name,
                data: this.latestCoord,
            });
        }
        else
        {
    
            if (this.connected) {
                //console.log("Connected is true");
                //console.log(`<${this.name}> ${this.latestCoord}`);

                await this.broadcast(ctx, "h_receive", {
                addr: ctx.addressOf(this),
                name: this.name,
                data: this.latestCoord,
                });
            } else {
                //console.log(this.latestCoord);
                //this.ovrConnector.updateCoord(this.latestCoord);
            }
        }
    }



    // More methods related to overlay management could be added here
}


import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { ReceiveCoord } from "../main.ts";

// Import the IPCOVRConnector if it's part of another module
import { IPCOVRConnector } from "../IPCOVRConnector.ts";

export class OverlayActor extends ActorP2P<OverlayActor> {
    private name: string;
    private names: Record<string, string> = {};
    private ovrConnector: IPCOVRConnector;
    private connected: boolean = false;


    // Constructor for the OverlayActor actor.
    constructor(publicIp: string, name: string) {
        super("overlay", publicIp);
        this.ovrConnector = new IPCOVRConnector();
        this.name = name;

        // Setup connection and data handling from IPC
        this.setupIPCConnector();
    }

    override async onConnect(ctx: actorManager, addr: Address<OverlayActor>): Promise<void> {
        await ctx.command(addr, "h_receive", {
            addr: ctx.addressOf(this),
            name: this.name,
            event: "JOIN",
        });
        this.connected = true;
    }

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

    setupIPCConnector() {
        this.ovrConnector.connect();
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
            this.ovrConnector.updateCoord(coord.data);
            console.log(`<${coord.name}> ${coord.data}`);
        }
    }

    async h_broadcast(ctx: actorManager) {
        console.log(`<${this.name}>`);
    
        if (this.connected) {
            this.ovrConnector.subscribe(async (data) => { // Mark the callback as async
                while (this.connected) {
                    await this.broadcast(ctx, "h_receive", {
                        addr: ctx.addressOf(this),
                        name: this.name,
                        data,
                    });
                }
            });
        }
    }



    // More methods related to overlay management could be added here
}


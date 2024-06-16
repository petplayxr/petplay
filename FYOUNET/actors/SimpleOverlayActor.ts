// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../helper/helpermodules/OVRInterface.ts";

interface OverlayPayload {
    addr: Address<OverlayPayload>;
    data: string;
}

export interface OverlayCommand {
    type: string;
    payload?: CreateBasicOverlayPayload | DelOverlayPayload | MoveOverlayPayload;
}

export interface CreateBasicOverlayPayload {
    overlayName: string;
    pathToTexture: string;
}

interface DelOverlayPayload {
    // Define properties specific to deleting an overlay
    overlayName: string;
}

interface MoveOverlayPayload {
    // Define properties specific to moving an overlay
    m34: string;
}

function format(command: OverlayCommand): string {
    let result = command.type;
    if (command.payload) {
        Object.entries(command.payload).forEach(([_key, value]) => {
            result += `;${value}`;
        });
    }
    return`${result};`;
}

export class SimpleOverlayActor extends ActorP2P<SimpleOverlayActor> {
    private name: string; //name of overlay
    private ovrConnector: OVRInterface | undefined = undefined; //ovr interface
    private ovrData: string = "" //ovr data
    
    constructor(publicIp: string, name: string) {
        super(name, publicIp);
        this.name = name;
        
    }

    async onStart() {
        await this.ovrConnector.connect();
        this.ovrConnector.subscribe(this.onOverlayMessage.bind(this));
    }

    async onStop() {
        await this.ovrConnector.disconnect();
    }

    async h_startOverlayProcess(_ctx: actorManager, executablePath: string) {
        this.ovrConnector = new OVRInterface(this.name, executablePath);
        this.onStart();
    }

    async h_commandOverlay(_ctx: actorManager, data: string | OverlayCommand) {

        if (typeof data !== "string") {
            data = format(data);
        }

        //format(data)
        await this.ovrConnector.send(data);
    }

    async h_setOverlayState(_ctx: actorManager, data: string) {
        this.ovrData = data
    }

    async h_getOVRData(callback: (data : string) => void) { 
        if (!this.ovrData) {
            callback("this.ovrData is empty")
        }
        callback(this.ovrData) 
    };

    private onOverlayMessage(data: string) {
        /* console.log(`Received overlay message: ${data}`); */
        const splitData = data.split(";")
        
        this.ovrData = splitData[splitData.length - 1];
        // Notify other actors or handle the message accordingly
    }

    async receive(ctx: actorManager, msg: OverlayPayload) {


        console.log(`OverlayActor received message: ${msg.data}`);
        await this.h_commandOverlay(ctx,msg.data);
    }
}

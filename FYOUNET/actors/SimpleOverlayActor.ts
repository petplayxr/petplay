// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../actorsystem/helpermodules/OVRInterface.ts";

interface OverlayPayload {
    addr: Address<OverlayPayload>;
    data: string;
}

export class SimpleOverlayActor extends ActorP2P<SimpleOverlayActor> {
    private name: string; //name of overlay
    private ovrConnector: OVRInterface; //ovr interface
    


    constructor(publicIp: string, name: string, executablePath: string) {
        super(name, publicIp);
        this.name = name;
        this.ovrConnector = new OVRInterface(this.name, executablePath);
    }

    async onStart() {
        await this.ovrConnector.connect();
        this.ovrConnector.subscribe(this.onOverlayMessage.bind(this));
    }

    async onStop() {
        await this.ovrConnector.disconnect();
    }

    async sendToOverlay(data: string) {
        await this.ovrConnector.send(data);
    }

    private onOverlayMessage(data: string) {
        console.log(`Received overlay message: ${data}`);
        // Notify other actors or handle the message accordingly
    }

    async receive(ctx: actorManager, msg: OverlayPayload) {
        console.log(`OverlayActor received message: ${msg.data}`);
        await this.sendToOverlay(msg.data);
    }
}

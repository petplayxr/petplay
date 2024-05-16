// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../OVRInterface.ts";

interface OverlayPayload {
    addr: Address<OverlayPayload>;
    data: string;
}
/*
* OVR Input Interface
* You can create this actor 
* You can query this actor
* The subscription data is is the status of all vr devices and their inputs
*/
export class aOVRInput extends ActorP2P<aOVRInput> {
    private name: string; //name of overlay
    private ovrConnector: OVRInterface; //ovr interface
    private ovrData: string = "" //ovr data
    
    constructor(publicIp: string, executablePath: string) {
        const name = "OpenVrInputInterface";
        super(name, publicIp);
        this.name = name;
        this.ovrConnector = new OVRInterface(this.name, executablePath);
        this.onStart();
    }

    async onStart() {
        await this.ovrConnector.connect();
        this.ovrConnector.subscribe(this.onOVRData.bind(this));
    }

    async onStop() {
        await this.ovrConnector.disconnect();
    }

    private onOVRData(data: string) {
        //console.log(`Received overlay message: ${data}`);
        this.ovrData = data;
        
    }

    async h_getOVRData(callback: (data : string) => void) { 
        callback(this.ovrData) 
    };
}

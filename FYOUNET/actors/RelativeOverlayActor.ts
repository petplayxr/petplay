// deno-lint-ignore-file require-await
// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "./helpermodules/OVRInterface.ts";
import { RelativePositionService } from "./vrc/relativeposition.ts";
import { aOVRInput } from "./OVRInput.ts";

//#region msg types

interface OverlayPayload {
    addr: Address<OverlayPayload>;
    data: string;
}

export interface OverlayCommand {
    type: string;
    payload?: CreateBasicOverlayPayload | DelOverlayPayload | MoveOverlayPayload;
}

interface CreateBasicOverlayPayload {
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

type PositionData = [number, number, number];

function format2(data: PositionData, hmdpos: PositionData): string {

    const scaleX = 6; // Adjust this factor as needed for the x component
    const scaleY = 1.2; // Adjust this factor as needed for the y component
    const scaleZ = 3; // Adjust this factor as needed for the z component

    // Apply individual scaling factors to each component
    const scaledData = data.map((value, index) => {
        switch(index) {
            case 0: // x component
                return value * scaleX;
            case 1: // y component
                return value * scaleY;
            case 2: // z component
                return value * scaleZ;
            default:
                throw new Error("Invalid component index");
        }
    });

    const staticValue = 1; // Adjust this value to move the overlay up
    scaledData[1] += staticValue;



    // Combine the base HMD position with the scaled position data
    const finalPosition = [
        hmdpos[0] + scaledData[0],
        hmdpos[1] + scaledData[1],
        hmdpos[2] + scaledData[2]
    ];
    

    const move = {
        type: "SetOverlayPosition",
        payload: {
            m34: `1 0 0 ${scaledData[0]} 0 1 0 ${scaledData[1]} 0 0 1 ${scaledData[2]}`
        }
    };

    const data2 = format(move);

    return data2;
}


//#endregion

export class RelativeOverlayActor extends ActorP2P<RelativeOverlayActor> {
    private name: string; //name of overlay
    private ovrConnector: OVRInterface; //ovr interface
    private hmdAddr: Address<aOVRInput> | null = null; //hmd address
    private actorManager: actorManager | null = null; 
    private ballNum = 0;
    private posService: RelativePositionService;
    
    

    constructor(publicIp: string, name: string, ballNum: number, posServ:RelativePositionService, executablePath: string) {
        super(name, publicIp);
        this.name = name;
        this.posService = posServ;
        this.ballNum = ballNum;
        this.ovrConnector = new OVRInterface(this.name, executablePath);
        this.onStart();
    }

    async onStart() {
        await this.ovrConnector.connect();
        this.ovrConnector.subscribe(this.onOverlayMessage.bind(this));
        this.posUpdate(this.posService);
        
    }

    async posUpdate(relativePositionService: RelativePositionService){


        relativePositionService.subscribe( async(position) => {
            if (!this.actorManager || !this.hmdAddr) {
                return;
            }
            const hmdpos = await this.getHmdPos(this.actorManager as actorManager, this.hmdAddr!);
            

            //position of one of the balls
            const posf = format2(position[this.ballNum], hmdpos);
            await this.ovrConnector.send(posf);
        });
    }

    async getHmdPos(ctx: actorManager, hmdAddr: Address<aOVRInput>): Promise<PositionData> {
        let data = "";
        await ctx.command(hmdAddr, "h_getOVRData", (data1: string) => {
            //console.log(data1);
            data = data1;
        });
    
        // Extract the HMD position values from the string using a regular expression
        const regex = /HMD Position:\s*\(([^)]+)\)/;
        const match = data.match(regex);
    
        let hmdposParts: number[] = [];
    
        if (match && match[1]) {
            hmdposParts = match[1].split(',').map(Number);
        }
    
        // Ensure the array has at least 3 elements
        while (hmdposParts.length < 3) {
            hmdposParts.push(0); // Or use another default value if 0 is not appropriate
        }
    
        return [hmdposParts[0], hmdposParts[1], hmdposParts[2]];
    }

    async onStop() {
        await this.ovrConnector.disconnect();
    }

    async h_bindToHMD(ctx: actorManager, ovrInput: Address<aOVRInput>) {
        this.actorManager = ctx;// how do we do this smarter lmao
        this.hmdAddr = ovrInput;
    }

    async h_sendToOverlay(_ctx: actorManager, data: string | OverlayCommand) {

        if (typeof data !== "string") {
            data = format(data);
        }

        //format(data)
        await this.ovrConnector.send(data);
    }

    private onOverlayMessage(data: string) {
        //console.log(`Received overlay message: ${data}`);
        // Notify other actors or handle the message accordingly
    }

    async receive(ctx: actorManager, msg: OverlayPayload) {


        console.log(`OverlayActor received message: ${msg.data}`);
        await this.h_sendToOverlay(ctx,msg.data);
    }
}

// deno-lint-ignore-file require-await
// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../helper/helpermodules/OVRInterface.ts";
import { RelativePositionService } from "../helper/vrc/relativeposition.ts";
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

//#endregion

//#region functions

//type X Y Z
type PositionData = [number, number, number];

//type openvrmatrix
type HMDMatrix = [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number
];

//turn command into format that can be sent
function format(command: OverlayCommand): string {
    let result = command.type;
    if (command.payload) {
        Object.entries(command.payload).forEach(([_key, value]) => {
            result += `;${value}`;
        });
    }
    return`${result};`;
}



function offset(data: PositionData, hmdpos: number[][]): string {

    //scale data
    const scaleX = 6; 
    const scaleY = 6; 
    const scaleZ = 6; 

    //static offset
    const offsetX = 0;  
    const offsetY = 0;  
    const offsetZ = -0.2; // Offset in z-direction to move overlay forward


    //#region hmdoffset

    const hmdOffset = [
        hmdpos[0][0] * offsetX + hmdpos[0][1] * offsetY + hmdpos[0][2] * offsetZ + hmdpos[0][3],
        hmdpos[1][0] * offsetX + hmdpos[1][1] * offsetY + hmdpos[1][2] * offsetZ + hmdpos[1][3],
        hmdpos[2][0] * offsetX + hmdpos[2][1] * offsetY + hmdpos[2][2] * offsetZ + hmdpos[2][3]
    ];

    // Construct the transformation matrix for the overlay
    const trsfMtx: HMDMatrix = [
        hmdpos[0][0], hmdpos[0][1], hmdpos[0][2], hmdOffset[0],
        hmdpos[1][0], hmdpos[1][1], hmdpos[1][2], hmdOffset[1],
        hmdpos[2][0], hmdpos[2][1], hmdpos[2][2], hmdOffset[2]
    ];

    //#endregion
    
    //#region applyvrc offset

    //this part is still broken

    data[0] *= scaleX + offsetX;
    data[1] *= scaleY + offsetY;
    data[2] *= scaleZ + offsetZ;

    const hmdOffsett = [
        trsfMtx[0] * data[0] + trsfMtx[1] * data[1] + trsfMtx[2] * data[2]+ trsfMtx[3],
        trsfMtx[4] * data[0] + trsfMtx[5] * data[1] + trsfMtx[6] * data[2]+ trsfMtx[7],
        trsfMtx[8] * data[0] + trsfMtx[9] * data[1] + trsfMtx[10]* data[2]+ trsfMtx[1]
    ];

    const finalPosition: HMDMatrix = [
        trsfMtx[0], trsfMtx[1], trsfMtx[2], hmdOffsett[0],
        trsfMtx[4], trsfMtx[5], trsfMtx[6], hmdOffsett[1],
        trsfMtx[8], trsfMtx[9], trsfMtx[10], hmdOffsett[2]
    ];
    

    //#endregion

    
    //construct message
    const move = {
        type: "SetOverlayPosition",
        payload: {
            m34: finalPosition.join(' ') // or trsfMtx.join(' ')
        }
    };

    //format message
    const data2 = format(move);

    return data2;
}


//#endregion

/*
* RelativeOverlayActor
* You can create this actor 
* TODO: THIS docstring
*/
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
            const posf = offset(position[this.ballNum], hmdpos);
            await this.ovrConnector.send(posf);
        });
    }

    async getHmdPos(ctx: actorManager, hmdAddr: Address<aOVRInput>): Promise<number[][]> {
        let data = "";
    
        await ctx.command(hmdAddr, "h_getOVRData", (data1: string) => {
            data = data1;
        });
    
        // Extract the HMD transformation matrix from the string using a regular expression
        const regex = /HMD Transformation Matrix:\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/;
        const match = data.match(regex);
    
        let matrix: number[][] = [
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [0, 0, 0, 0]
        ];
    
        if (match && match[1] && match[2] && match[3]) {
            matrix[0] = match[1].trim().split(/\s+/).map(Number);
            matrix[1] = match[2].trim().split(/\s+/).map(Number);
            matrix[2] = match[3].trim().split(/\s+/).map(Number);
        }
    
        // Return the transformation matrix
        return matrix;
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

// deno-lint-ignore-file require-await
// OverlayActor.ts
import { Address } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../helper/helpermodules/OVRInterface.ts";
import { RelativePositionService } from "../helper/vrc/relativeposition.ts";
import { aOVRInput } from "./OVRInput.ts";
import { clearLine } from "node:readline";
import { constrainedMemory } from "node:process";

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
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number]
];

type HMDMatrix11 = [
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
    return `${result};`;
}

function remapPosition(value:number, oldMin:number, oldMax:number, newMin:number, newMax:number) {
    // Apply the scaling transformation
    const scaledValue = (value - oldMin) / (oldMax - oldMin);
    
    // Nonlinear scaling (e.g., exponential scaling)
    const nonlinearValue = Math.pow(scaledValue, 0.1); // Using square for example, adjust as needed
    
    // Map to new range
    let val = nonlinearValue * (newMax - newMin) + newMin;
    
    // If the original value was negative, invert the result
    if (value < 0) {
        val = -Math.abs(val);
    }

    /* console.log(value, val); */
    return val;
}

function remapPosition2(value:number, oldMin:number, oldMax:number, newMin:number, newMax:number) {
    // Apply the scaling transformation
    const scaledValue = (value - oldMin) / (oldMax - oldMin);
    
    // Nonlinear scaling (e.g., exponential scaling)
    const nonlinearValue = Math.pow(scaledValue, 4); // Using square for example, adjust as needed
    
    // Map to new range
    let val = nonlinearValue * (newMax - newMin) + newMin;
    
    // If the original value was negative, invert the result
    if (value < 0) {
        val = -Math.abs(val);
    }

    /* console.log(value, val); */
    return val;
}

async function offset(data: HMDMatrix11, hmdpos: HMDMatrix): Promise<string> {
    // Scale data


    // Static offset
    const offsetX = 0;
    const offsetY = 0;
    const offsetZ = 0; // Offset in z-direction to move overlay forward

    //#region hmdoffset
    const hmdOffset = [
        hmdpos[0][0] * offsetX + hmdpos[0][1] * offsetY + hmdpos[0][2] * offsetZ + hmdpos[0][3],
        hmdpos[1][0] * offsetX + hmdpos[1][1] * offsetY + hmdpos[1][2] * offsetZ + hmdpos[1][3],
        hmdpos[2][0] * offsetX + hmdpos[2][1] * offsetY + hmdpos[2][2] * offsetZ + hmdpos[2][3]
    ];


    // Construct the transformation matrix for the overlay

    //data[11] -0,5 = 1, 0.5 = 0
    

    const scaleFactorYaw = 2; 
    const scaleFactorPitch = 2; 
    const scaleFactorRoll = 2; 
    const scaleX = -160
    const scaleY = -2
    const scaleZ = 0.1

    


    const sData = [
        data[0] * scaleFactorYaw, data[1] * scaleFactorPitch, data[2] * scaleFactorRoll, data[3] * scaleX,
        data[4] * scaleFactorYaw, data[5] * scaleFactorPitch, data[6] * scaleFactorRoll, data[7] * scaleY,
        data[8] * scaleFactorYaw, data[9] * scaleFactorPitch, data[10]* scaleFactorRoll, remapPosition2(data[11], 0, 0.6, 2, 0),
    ];

    const trsfMtx: HMDMatrix = [
        [hmdpos[0][0], hmdpos[0][1], hmdpos[0][2], hmdOffset[0]],
        [hmdpos[1][0], hmdpos[1][1], hmdpos[1][2], hmdOffset[1]  ],
        [hmdpos[2][0], hmdpos[2][1], hmdpos[2][2], hmdOffset[2] - sData[11]]
    ];


    const finalMtrx: HMDMatrix11 = [
        trsfMtx[0][0] , sData[1],      sData[2],      trsfMtx[0][3] ,
        sData[4],       trsfMtx[1][1], sData[6],      trsfMtx[1][3] ,
        sData[8],       sData[9],      trsfMtx[2][2] ,trsfMtx[2][3] 

    ];
/*     console.log(finalMtrx[0], finalMtrx[1], finalMtrx[2],  hmdOffset[0],"-", sData[3], data[3], "=", finalMtrx[3]    )
    console.log(finalMtrx[4], finalMtrx[5], finalMtrx[8],  hmdOffset[1],"-", sData[7], data[7], "=",finalMtrx[9]    )
    console.log(finalMtrx[8], finalMtrx[9], finalMtrx[10] ,hmdOffset[2],"-", sData[11],data[11], "=",finalMtrx[11]  )
    await new Promise(resolve => setTimeout(resolve, 150))
    await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"))
    await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"))
    await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K")) */


    //#endregion

    // Construct message
    const move = {
        type: "SetOverlayPosition",
        payload: {
            m34: finalMtrx.join(' ')
        }
    };

    // Format message
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



    constructor(publicIp: string, name: string, ballNum: number, posServ: RelativePositionService, executablePath: string) {
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

    async posUpdate(relativePositionService: RelativePositionService) {

        let pos

        relativePositionService.subscribe(async (position) => {
            if (!this.actorManager || !this.hmdAddr) {
                return;
            }
            pos = position;



        });
        while (true) {
            
            //position of one of the balls
            if (pos) {
                const hmdpos: HMDMatrix = await this.getHmdPos(this.actorManager as actorManager, this.hmdAddr!);
                const posf = await offset(pos.rotation, hmdpos);
                await this.ovrConnector.send(posf);
            }
            await new Promise(resolve => setTimeout(resolve, 10));

        }



    }

    async getHmdPos(ctx: actorManager, hmdAddr: Address<aOVRInput>): Promise<HMDMatrix> {
        let data = "";

        await ctx.command(hmdAddr, "h_getOVRData", (data1: string) => {
            data = data1;
        });

        // Extract the HMD transformation matrix from the string using a regular expression
        const regex = /HMD Transformation Matrix:\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/;
        const match = data.match(regex);

        let matrix: HMDMatrix = [
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
        await this.h_sendToOverlay(ctx, msg.data);
    }
}

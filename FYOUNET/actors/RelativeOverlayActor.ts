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

function format3(data: PositionData, hmdpos: number[][]): string {

    const scaleX = 1; // Adjust this factor as needed for the x component
    const scaleY = 1; // Adjust this factor as needed for the y component
    const scaleZ = 1; // Adjust this factor as needed for the z component

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

    const staticValue1 = 1; // Adjust this value to move the overlay 
    scaledData[0] += staticValue1;
    const staticValue2 = 1.2; // Adjust this value to move the overlay
    scaledData[1] += staticValue2;
    const staticValue3 = -2.2; // Adjust this value to move the overlay 
    scaledData[2] += staticValue3;



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

function format2(data: PositionData, hmdpos: number[][]): string {

    const scaleX = 6; // Adjust this factor as needed for the x component
    const scaleY = 6; // Adjust this factor as needed for the y component
    const scaleZ = 6; // Adjust this factor as needed for the z component

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

    // Set the static offset values for the overlay position
    const offsetX = 0;  // No offset in x-direction
    const offsetY = 0;  // No offset in y-direction
    const offsetZ = -0.2; // Offset in z-direction to move overlay forward

    scaledData[0] += offsetX;
    scaledData[1] += offsetY;
    scaledData[2] += offsetZ;

    // Combine the base HMD position with the scaled position data
    const finalPosition = [
        hmdpos[0][0] * offsetX + hmdpos[0][1] * offsetY + hmdpos[0][2] * offsetZ + hmdpos[0][3],
        hmdpos[1][0] * offsetX + hmdpos[1][1] * offsetY + hmdpos[1][2] * offsetZ + hmdpos[1][3],
        hmdpos[2][0] * offsetX + hmdpos[2][1] * offsetY + hmdpos[2][2] * offsetZ + hmdpos[2][3]
    ];


    // Construct the transformation matrix for the overlay
    const tMx = [
        hmdpos[0][0], hmdpos[0][1], hmdpos[0][2], finalPosition[0],
        hmdpos[1][0], hmdpos[1][1], hmdpos[1][2], finalPosition[1],
        hmdpos[2][0], hmdpos[2][1], hmdpos[2][2], finalPosition[2]
    ];

    const move = {
        type: "SetOverlayPosition",
        payload: {
            m34: tMx.join(' ')
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

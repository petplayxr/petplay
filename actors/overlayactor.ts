import {
    ActorFunctions,
    BaseState,
    worker,
    MessageAddressReal,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { OVRInterface } from "../classes/OVRInterface.ts";
import { wait } from "../actorsystem/utils.ts";

interface coord {
    [key: string]: number;
}

type State = {
    vrc: string;
    ovrConnector: OVRInterface | undefined
    ovrData: string

    [key: string]: unknown;
};

const state: State & BaseState = {
    id: "",
    ovrConnector: undefined,
    name: "vroverlay",
    ovrData: "",
    socket: null,
    vrc: ""
};

const functions: ActorFunctions = {
    CUSTOMINIT: (_payload) => {
        main();
    },
    LOG: (_payload) => {
        console.log(state.id);
    },
    ASSIGNVRC: (payload) => {
        state.vrc = payload;
    }
};

function onOverlayMessage(data: string) {
    /* console.log(`Received overlay message: ${data}`); */
    const splitData = data.split(";")

    state.ovrData = splitData[splitData.length - 1];
    // Notify other actors or handle the message accordingly
}

interface LastKnownPosition {
    x: number;
    y: number;
    z: number;
}

interface LastKnownRotation {

    y: number;

}

function transformCoordinate(value: number): number {

    return (value - 0.5) * 220;
}

function transformRotation(value: number): number {
    // Transform rotation from 0-1 range to 0-2π radians
    return value * 2 * Math.PI;
}



//neg values seem to always be 0
const PositionX: string = "/avatar/parameters/CustomObjectSync/PositionX";
const PositionXNeg: string = "/avatar/parameters/CustomObjectSync/PositionXNeg";
const PositionXPos: string = "/avatar/parameters/CustomObjectSync/PositionXPos";
const RotationX: string = "/avatar/parameters/CustomObjectSync/RotationX";
const AngleMagX_Angle = "/avatar/parameters/CustomObjectSync/AngleMagX_Angle";
const AngleSignX_Angle = "/avatar/parameters/CustomObjectSync/AngleSignX_Angle"

const PositionY: string = "/avatar/parameters/CustomObjectSync/PositionY";
const PositionYNeg: string = "/avatar/parameters/CustomObjectSync/PositionYNeg";
const PositionYPos: string = "/avatar/parameters/CustomObjectSync/PositionYPos";
const RotationY: string = "/avatar/parameters/CustomObjectSync/RotationY";
const AngleMagY_Angle = "/avatar/parameters/CustomObjectSync/AngleMagY_Angle";
const AngleSignY_Angle = "/avatar/parameters/CustomObjectSync/AngleSignY_Angle"

const PositionZ: string = "/avatar/parameters/CustomObjectSync/PositionZ";
const PositionZNeg: string = "/avatar/parameters/CustomObjectSync/PositionZNeg";
const PositionZPos: string = "/avatar/parameters/CustomObjectSync/PositionZPos";
const RotationZ: string = "/avatar/parameters/CustomObjectSync/RotationZ";
const AngleMagZ_Angle = "/avatar/parameters/CustomObjectSync/AngleMagZ_Angle";
const AngleSignZ_Angle = "/avatar/parameters/CustomObjectSync/AngleSignZ_Angle"

const lastKnownPosition: LastKnownPosition = { x: 0, y: 0, z: 0 };
const lastKnownRotation: LastKnownRotation = { y: 0 };

async function main() {
    console.log("OVERLAYMAIN")
    const ovrPath = "c:/GIT/petplay2/OVRINTERFACE/out/build/user/Debug/petplay.exe"
    //`${Deno.cwd()}/../${"../OVRINTERFACE/out/build/user/Debug/petplay.exe"}`;
    const absImgPath = "c:/GIT/petplay2/resources/P1.png"
    //`${Deno.cwd()}/../${"../resources/PetPlay.png"}`;
    state.ovrConnector = new OVRInterface("overlay", ovrPath);
    await wait(1000)
    console.log("its", state.ovrConnector)
    await state.ovrConnector?.connect()
    await wait(1000)
    state.ovrConnector?.subscribe(onOverlayMessage.bind(state));
    const message = `CreateBasicOverlay;exampleOverlay1;${absImgPath};`;
    //create overlay
    await state.ovrConnector?.send(message)



    while (true) {


        if (state.vrc != "") {
            interface coord {
                [key: string]: number;
            }
            const coordinate = await Postman.PostMessage(worker, {
                address: { fm: state.id, to: state.vrc },
                type: "GETCOORDINATE",
                payload: null,
            }, true) as coord;

            if (coordinate[PositionX] !== undefined) lastKnownPosition.x = coordinate[PositionX];
            if (coordinate[PositionY] !== undefined) lastKnownPosition.y = coordinate[PositionY];
            if (coordinate[PositionZ] !== undefined) lastKnownPosition.z = coordinate[PositionZ];
            
            if (coordinate[RotationY] !== undefined) lastKnownRotation.y = coordinate[RotationY];

            const transformedX = transformCoordinate(lastKnownPosition.x);
            const transformedY = transformCoordinate(lastKnownPosition.y);
            const transformedZ = transformCoordinate(lastKnownPosition.z);
            const rotY = transformRotation(lastKnownRotation.y);

            // Create rotation matrix for Y rotation
            const cosY = Math.cos(rotY);
            const sinY = Math.sin(rotY);

            // Rotate the position vector
            const rotatedX = transformedX * cosY - transformedZ * sinY;
            const rotatedZ = transformedX * sinY + transformedZ * cosY;

            // Create the transformation matrix
            // This combines rotation and rotated position
            const matrix: number[] = [
                cosY, 0, sinY, rotatedX,
                0, 1, 0, -transformedY+1.2, // Keep Y position at 0
                -sinY, 0, cosY, -rotatedZ // Add offset to move in front
            ];

            // Construct the message
            const message = `SetOverlayPosition;TRUE;${matrix.join(' ')}`;

            // Send the message
            await state.ovrConnector?.send(message);
        }
        await wait(1)
    }


}

new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

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

const lastKnownPosition: LastKnownPosition = { x: 0, y: 0, z: 0 };

async function main() {
    console.log("OVERLAYMAIN")
    const ovrPath = "c:/GIT/petplay2/OVRINTERFACE/out/build/user/Debug/petplay.exe"
    //`${Deno.cwd()}/../${"../OVRINTERFACE/out/build/user/Debug/petplay.exe"}`;
    const absImgPath = "c:/GIT/petplay2/resources/P2.png"
    //`${Deno.cwd()}/../${"../resources/PetPlay.png"}`;
    state.ovrConnector = new OVRInterface("overlay2", ovrPath);
    await wait(1000)
    console.log("its", state.ovrConnector)
    await state.ovrConnector?.connect()
    await wait(1000)
    state.ovrConnector?.subscribe(onOverlayMessage.bind(state));
    const message = `CreateBasicOverlay;exampleOverlay2;${absImgPath};`;
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

            // Update lastKnownPosition with new values, if available
            if (coordinate["/avatar/parameters/CustomObjectSync/PositionX"] !== undefined) {
                lastKnownPosition.x = coordinate["/avatar/parameters/CustomObjectSync/PositionX"];
            }
            if (coordinate["/avatar/parameters/CustomObjectSync/PositionY"] !== undefined) {
                lastKnownPosition.y = coordinate["/avatar/parameters/CustomObjectSync/PositionY"];
            }
            if (coordinate["/avatar/parameters/CustomObjectSync/PositionZ"] !== undefined) {
                lastKnownPosition.z = coordinate["/avatar/parameters/CustomObjectSync/PositionZ"];
            }

            // Angle of rotation (in radians)
            const angle = -Math.PI / 2; // -90 degrees, pointing straight down

            // Sin and cos of the angle
            const s = Math.sin(angle);
            const c = Math.cos(angle);

            const matrix: number[] = [
                1, 0, 0, 0,    // First column: No change in X
                0, c, -s, 0.1,  // Second column: Rotate around X, slight elevation
                0, -s, -c, 0     // Third column: Rotate around X, inverted
            ];



            // Construct the message
            const message = `SetOverlayPosition;FALSE;${matrix.join(' ')}`;

            // Send the message
            await state.ovrConnector?.send(message);
        }
        await wait(1000)
    }


}

new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

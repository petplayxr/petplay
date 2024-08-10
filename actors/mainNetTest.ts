import {
    ActorFunctions,
    BaseState,
    Payload,
    ToAddress,
    worker,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { wait } from "../actorsystem/utils.ts";
import { OpenVRType } from "../OpenVR_TS/utils.ts";
import * as OpenVR from "../OpenVR_TS/openvr_bindings.ts";

//main process

type State = {
    id: string;
    db: Record<string, unknown>;
    [key: string]: unknown;
};

const state: State & BaseState = {
    name: "main",
    id: "",
    db: {},
    overlayactor1: null,
    inputactor: null,
    socket: null,
    numbah: 0,
    addressbook: [],
};

const functions: ActorFunctions = {
    MAIN: (payload) => {
        main(payload);
    },
    LOG: (_payload) => {
        console.log(state.id);
    },
    STDIN: (payload) => {
        if (payload.startsWith("connect")) {
            payload = payload.replace("connect", "");
            Postman.PostMessage({
                address: { fm: state.id, to: state.overlayactor1 },
                type: "CONNECT",
                payload: payload,
            })
        }
        if (payload.startsWith("addaddress")) {
            payload = payload.replace("addaddress", "");
            Postman.PostMessage({
                address: { fm: state.id, to: state.overlayactor1 },
                type: "ADDADDRESS",
                payload: payload,
            })
        }
        if (payload.startsWith("start")) {
            inputloop(state.inputactor, state.overlayactor1);
        }


        console.log("stdin:", payload);
    },
};

async function main(_payload: Payload["MAIN"]) {
    console.log("main!");

    const net1actor = await Postman.create("netTestActor.ts");
    const net2actor = await Postman.create("netTestActor.ts");

    Postman.PostMessage({
        address: { fm: state.id, to: [net1actor, net2actor] },
        type: "SET_CHANNEL",
        payload: "muffin",
    })

    await wait(8000);

    Postman.PostMessage({
        address: { fm: state.id, to: net2actor },
        type: "MESSAGE",
        payload: net1actor,
    })




}

async function inputloop(inputactor: ToAddress, overlayactor: ToAddress) {
    while (true) {
        const inputstate: [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData] = await Postman.PostMessage({
            address: { fm: state.id, to: inputactor },
            type: "GETCONTROLLERDATA",
            payload: null,
        }, true) as [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData];
        console.log("inputstate:", inputstate[1].bState);



        if (inputstate[1].bState == 1) {
            Postman.PostMessage({
                address: { fm: state.id, to: overlayactor },
                type: "SETOVERLAYLOCATION",
                payload: inputstate[0].pose.mDeviceToAbsoluteTracking,
            });

        }
    }
}


new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

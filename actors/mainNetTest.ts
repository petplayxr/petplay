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
        console.log("stdin:", payload);
    },
};

async function main(_payload: Payload["MAIN"]) {
    console.log("main!");



/*     const net1actor = await Postman.create(worker, "netTestActor.ts", state);
    const net2actor = await Postman.create(worker, "netTestActor.ts", state); */

    const overlayactor1 = await Postman.create(worker, "overlayactor.ts", state);
    const overlayactor2 = await Postman.create(worker, "overlayactor2.ts", state);
    const inputactor = await Postman.create(worker, "inputactor.ts", state);


    await wait(5000);
/* 
    Postman.PostMessage(worker, {
        address: { fm: state.id, to: net1actor },
        type: "CONNECT",
        payload: net2actor,
    }) */

    Postman.PostMessage(worker, {
        address: { fm: state.id, to: overlayactor1 },
        type: "CONNECT",
        payload: overlayactor2,
    })

    await wait(6000);

    Postman.PostMessage(worker, {
        address: { fm: state.id, to: overlayactor1 },
        type: "ADDADDRESS",
        payload: overlayactor2,
    })

    Postman.PostMessage(worker, {
        address: { fm: state.id, to: overlayactor2 },
        type: "ADDADDRESS",
        payload: overlayactor1,
    })

    inputloop(inputactor, overlayactor1);

/* 

    Postman.PostMessage(worker, {
        address: { fm: state.id, to: net1actor },
        type: "MESSAGE",
        payload: net2actor,
    }) */
}

async function inputloop(inputactor: ToAddress, overlayactor: ToAddress) {
    while (true) {
      const inputstate: [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData] = await Postman.PostMessage(worker, {
        address: { fm: state.id, to: inputactor },
        type: "GETCONTROLLERDATA",
        payload: null,
      }, true) as [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData];
      console.log("inputstate:", inputstate[1].bState);
  
  
  
      if (inputstate[1].bState == 1) {
        Postman.PostMessage(worker, {
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

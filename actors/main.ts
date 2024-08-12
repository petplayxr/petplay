import {
  ActorFunctions,
  BaseState,
  Payload,
  ToAddress,
  worker,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { wait } from "../actorsystem/utils.ts";
import { OpenVRType } from "../OpenVR_TS_Bindings_Deno/utils.ts";
import * as OpenVR from "../OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { CustomLogger } from "../classes/customlogger.ts";

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
  addressBook: new Array<string>(),
};

const functions: ActorFunctions = {
  MAIN: (payload) => {
    main(payload);
  },
  LOG: (_payload) => {
    CustomLogger.log("actor", state.id);
  },
  STDIN: (payload) => {
    CustomLogger.log("actor", "stdin:", payload);
  },
};

async function main(_payload: Payload["MAIN"]) {
  CustomLogger.setChannel("syncloop")

  CustomLogger.log("actor", "main!");

  const overlayactor = await Postman.create("overlayactor.ts");
  const overlayactor2 = await Postman.create("overlayactor.ts");

  Postman.PostMessage({
    address: { fm: state.id, to: overlayactor },
    type: "ADDADDRESS",
    payload: overlayactor2,
  });

  Postman.PostMessage({
    address: { fm: state.id, to: overlayactor },
    type: "STARTOVERLAY",
    payload: {
      name: "overlay1",
      texture: "./resources/P1.png",
      sync: true,
    },
  });

  Postman.PostMessage({
    address: { fm: state.id, to: overlayactor2 },
    type: "STARTOVERLAY",
    payload: {
      name: "overlay2",
      texture: "./resources/P2.png",
      sync: false,
    },
  });

  const inputactor = await Postman.create("inputactor.ts");




  /* Postman.PostMessage({
    address: { fm: state.id, to: [overlayactor, overlayactor2] },
    type: "SET_CHANNEL",
    payload: "muffin",
  }) */


  inputloop(inputactor, overlayactor);



}

async function inputloop(inputactor: ToAddress, overlayactor: ToAddress) {
  while (true) {
    const inputstate: [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData] = await Postman.PostMessage({
      address: { fm: state.id, to: inputactor },
      type: "GETCONTROLLERDATA",
      payload: null,
    }, true) as [OpenVR.InputPoseActionData, OpenVR.InputDigitalActionData];



    if (inputstate[1].bState == 1) {
      Postman.PostMessage({
        address: { fm: state.id, to: overlayactor },
        type: "SETOVERLAYLOCATION",
        payload: inputstate[0].pose.mDeviceToAbsoluteTracking,
      });

    }
    await wait(1);
  }
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

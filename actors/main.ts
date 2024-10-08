import { ActorFunctions, BaseState, Payload, ToAddress, worker } from "../actorsystem/types.ts";
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
  addressBook: new Set()
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
  CustomLogger.log("default", "main actor started");

  const overlayactor = await Postman.create("overlayactor.ts");
  const overlay2 = await Postman.create("overlayactorVRCground.ts");

  Postman.PostMessage({
    address: { fm: state.id, to: overlay2 },
    type: "STARTOVERLAY",
    payload: {
      name: "overlayXX",
      texture: "./resources/P1.png",
      sync: false,
    },
  });


  await Postman.PostMessage({
    address: { fm: state.id, to: overlayactor },
    type: "SET_TOPIC",
    payload: "muffin",
  }, true);

  Postman.PostMessage({
    address: { fm: state.id, to: overlayactor },
    type: "STARTOVERLAY",
    payload: {
      name: "overlay1",
      texture: "./resources/PetPlay.png",
      sync: true,
    },
  });



  await wait(1000);
  const inputactor = await Postman.create("inputactor.ts");

  await wait(5000);

  inputloop(inputactor, overlayactor);
}

async function inputloop(inputactor: ToAddress, overlayactor: ToAddress) {
  CustomLogger.log("default", "inputloop started");
  while (true) {
    const inputstate = await Postman.PostMessage({
      address: { fm: state.id, to: inputactor },
      type: "GETCONTROLLERDATA",
      payload: null,
    }, true) as [
        OpenVR.InputPoseActionData,
        OpenVR.InputPoseActionData,
        OpenVR.InputDigitalActionData,
        OpenVR.InputDigitalActionData,
      ];

    if (inputstate[2].bState == 1) {
      Postman.PostMessage({
        address: { fm: state.id, to: overlayactor },
        type: "SETOVERLAYLOCATION",
        payload: inputstate[0].pose.mDeviceToAbsoluteTracking,
      });
    } else if (inputstate[3].bState == 1) {
      Postman.PostMessage({
        address: { fm: state.id, to: overlayactor },
        type: "SETOVERLAYLOCATION",
        payload: inputstate[1].pose.mDeviceToAbsoluteTracking,
      });
    }

    await wait(10);
  }
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

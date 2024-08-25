import {
  ActorFunctions,
  BaseState,
  ToAddress,
  worker,
  System,
  MessageAddressReal,
} from "../actorsystem/types.ts";

import { wait } from "../actorsystem/utils.ts";

import { OnMessage, Postman } from "../classes/PostMan.ts";
import { CustomLogger } from "../classes/customlogger.ts";

type State = {
  id: string;
  channel: string | null;

  [key: string]: unknown;
};

const state: State & BaseState = {
  id: "",
  channel: null,
  name: "sub",
  socket: null,
  addressBook: new Array<string>(),
};

const functions: ActorFunctions = {
  CUSTOMINIT: (_payload) => {
    NET()
  },
  LOG: (_payload) => {
    CustomLogger.log("actor", state.id);
    CustomLogger.log("actor", state.addressBook);
  },
  MESSAGE: (payload, _address) => {
    const addr = payload as ToAddress;

    CustomLogger.log("actor", "trying")



    Postman.PostMessage({
      address: { fm: state.id, to: addr },
      type: "LOG",
      payload: null,
    });
  },
  GETID: (_payload, address) => {
    // use a check here
    const addr = address as MessageAddressReal;
    Postman.PostMessage({
      address: { fm: state.id, to: addr.fm },
      type: "CB:GETID",
      payload: state.id,
    }, false);
  },
};


async function NET() {
  Postman.functions?.HYPERSWARM?.(null, state.id);
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

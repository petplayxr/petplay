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
    console.log(state.id);
    console.log(state.addressBook);
  },
  MESSAGE: (payload, _address) => {
    const addr = payload as ToAddress;

    console.log("trying")



    Postman.PostMessage(worker, {
      address: { fm: state.id, to: addr },
      type: "LOG",
      payload: null,
    });
  },
  GETID: (_payload, address) => {
    // use a check here
    const addr = address as MessageAddressReal;
    Postman.PostMessage(worker, {
      address: { fm: state.id, to: addr.fm },
      type: "CB:GETID",
      payload: state.id,
    }, false);
  },
};


async function NET() {
  Postman.functions?.RTC?.(null, state.id);
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

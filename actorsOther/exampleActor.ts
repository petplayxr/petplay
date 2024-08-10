import {
  ActorFunctions,
  BaseState,

  worker,
  MessageAddressReal,
} from "../actorsystem/types.ts";

import { OnMessage, Postman } from "../classes/PostMan.ts";



type State = {
  id: string;
  db: Record<string, unknown>;
  [key: string]: unknown;
};

const state: State & BaseState = {
  id: "",
  db: {},
  name: "sub",
  socket: null,
  numbah: 0,
  addressbook: [],
};

const functions: ActorFunctions = {
  CUSTOMINIT: (_payload) => {
    rtc()
  },
  LOG: (_payload) => {
    console.log(state.id);
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
function rtc() {
  Postman.functions?.RTC?.(null, state.id);
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

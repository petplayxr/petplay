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
  addressBook: Set<string>;
  [key: string]: unknown;
};

const state: State & BaseState = {
  id: "",
  channel: null,
  name: "sub",
  socket: null,
  addressBook: new Set(),
};

const functions: ActorFunctions = {
  CUSTOMINIT: (_payload) => {
    NET()
  },
  LOG: (_payload) => {
    console.log(state.id);
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
  ASSIGNCHANNEL: (payload, _address) => {
    state.channel = payload as string;
  },
  RECEIVEADDRESS: (payload, _address) => {
    const peerAddress = payload as string;
    if (peerAddress !== state.id) {
      state.addressBook.add(peerAddress);

      
      connectToPeer(peerAddress);
    }
  },
};


async function NET() {
  Postman.functions?.RTC?.(null, state.id);

  while (true) {
    if (state.channel !== null) {
      Postman.PostMessage(worker, {
        address: { fm: state.id, to: System },
        type: "BROADCAST",
        payload: `${state.channel}:${state.id}`
      });
    }
    await wait(1000);
  }
}

async function connectToPeer(peerAddress: string) {
  // Implement WebRTC connection logic here
  console.log(`Connecting to peer: ${peerAddress}`);

  //connect to peer
  const error = await Postman.PostMessage(worker, {
    address: { fm: state.id, to: state.id },
    type: "CONNECT",
    payload: peerAddress,
  }, true)
  if (!error) throw new Error("connect failed");

  //send them our address
  Postman.PostMessage(worker, {
    address: { fm: state.id, to: peerAddress },
    type: "RECEIVEADDRESS",
    payload: state.id,
  })
}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

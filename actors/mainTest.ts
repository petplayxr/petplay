import {
  ActorFunctions,
  BaseState,
  Payload,
  PayloadHandler,
  worker,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { wait } from "../actorsystem/utils.ts";

type State = {
  id: string;
  db: Record<string, unknown>;
  portal: string;
  [key: string]: unknown;
};

const state: State & BaseState = {
  name: "main",
  id: "",
  db: {},
  portal: "",
  socket: null,
  numbah: 0,
  addressbook: [],
};

const functions: ActorFunctions = {
  CUSTOMINIT: (_payload) => {
  },
  MAIN: (payload) => {
    main(payload);
  },
  LOG: (_payload) => {
    console.log(state.id);
  },
  STDIN: (payload) => {
    console.log("stdin:", payload);
    if (payload.startsWith("/")) {
      const vmessage = payload.split(":");
      const address = vmessage[0].slice(1);
      // deno-lint-ignore no-explicit-any
      const type = vmessage[1] as any;
      const payload2 = vmessage[2];

      Postman.PostMessage(worker, {
        address: { fm: state.id, to: address },
        type: type,
        payload: payload2,
      });
    } else {
      const vmessage = payload.split(":");
      const type = vmessage[0] as keyof ActorFunctions;
      const payload2 = vmessage[1];

      if (!(Postman.functions?.[type] as PayloadHandler<typeof type>)) {
        console.error(`No handler found for type ${type}`);
      } else {
        (Postman.functions[type] as PayloadHandler<typeof type>)(
          payload2,
          state.id,
        );
      }
    }
  },
  LOOKUP: async (payload) => {
    const result = await Postman.PostMessage(worker, {
      address: { fm: state.id, to: state.portal },
      type: "LOOKUP",
      payload: payload,
    }, true);
    console.log("result", result);
  },
};

async function main(_payload: Payload["MAIN"]) {
  console.log("main!");

  // create rtc socket on self
  Postman.functions?.RTC?.(null, state.id);


  


}

new Postman(worker, functions, state);

OnMessage((message) => {
  Postman.runFunctions(message);
});

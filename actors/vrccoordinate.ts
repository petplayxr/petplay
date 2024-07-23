import {
    ActorFunctions,
    BaseState,
    worker,
    MessageAddressReal,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { OscSubscriber } from "../classes/getvrcpos.ts";

interface coord {
    [key: string]: number;
}

type State = {
    oscSubscriber: OscSubscriber | null
    coordinate: coord
    [key: string]: unknown;
};

const state: State & BaseState = {
    id: "",
    name: "vrccoordinate",
    socket: null,
    coordinate: {},
    oscSubscriber: null
};

const functions: ActorFunctions = {
    CUSTOMINIT: (_payload) => {
        main();
    },
    LOG: (_payload) => {
        console.log(state.id);
    },
    GETCOORDINATE: (_payload, address) => {
        const addr = address as MessageAddressReal;
        Postman.PostMessage(worker, {
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETCOORDINATE",
            payload: state.coordinate
        });
    }
};

function handleOscMessage(address: string, value: number) {
    state.coordinate[address] = value;
}

function main() {
    const PositionX: string = "/avatar/parameters/CustomObjectSync/PositionX"; //float out
    const PositionY: string = "/avatar/parameters/CustomObjectSync/PositionY"; //float out
    const PositionZ: string = "/avatar/parameters/CustomObjectSync/PositionZ"; //float out
    state.oscSubscriber = new OscSubscriber([PositionX, PositionY, PositionZ]);
    if (state.oscSubscriber) {
        state.oscSubscriber.subscribe(handleOscMessage.bind(state));
        state.oscSubscriber.listenForOscMessages().then(() => {
            console.log("Finished listening for OSC messages.");
        });
    }

}

new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

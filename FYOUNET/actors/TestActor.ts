// OverlayActor.ts
import { Address, ActorState, Actor, SerializedState } from "../actorsystem/types.ts";
import { actorManager } from "../actorsystem/actorManager.ts";
import { ActorP2P } from "../actorsystem/actorP2P.ts";
import { OVRInterface } from "../OVRInterface.ts";

interface OverlayPayload {
    addr: Address<OverlayPayload>;
    data: string;
}
/*
* OVR Input Interface
* You can create this actor 
* You can query this actor
* The subscription data is is the status of all vr devices and their inputs
*/
export class aTest extends ActorP2P<aTest> {
    

    
    constructor(actorname: string, publicIp: string, state?: SerializedState<Actor>) {
        super(actorname, publicIp, state);
    }

    onStart(state?: SerializedState<Actor>) {

        if (state) {
            const newstate = this.deserialize(state);
            this.state = newstate;
            console.log("actor state reloaded!");
        }
    }

    h_test(_ctx: actorManager) {
        console.log("test");
        this.state.test = "persistence test";
    }

    h_logstate(_ctx: actorManager) {
        console.log(this.state.test);
    }

    async onStop() {

    }
}

// OverlayActor.ts
import { Address, Actor, SerializedState } from "../../actorsystem/types.ts";
import { actorManager } from "../../actorsystem/actorManager.ts";
import { ActorP2P } from "../../actorsystem/actorP2P.ts";



export class aDebugBall extends ActorP2P<aDebugBall> {

    
    constructor(actorname: string, publicIp: string, state?: SerializedState<Actor>) {
        super(actorname, publicIp, state);
    }

    override onStart(state?: SerializedState<Actor>) {

        if (state) {
            const newstate = this.deserialize(state);
            this.state = newstate;
            console.log("actor state reloaded!");
        }
    }

    h_setState(_ctx: actorManager, data: string) {
        this.state.position = data;
    }

    h_getState(_ctx: actorManager) {
        return this.state.position;
    }

    async onStop() {

    }
}

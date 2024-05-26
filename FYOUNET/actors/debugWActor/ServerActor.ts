// OverlayActor.ts
import { serveFile } from "jsr:@std/http/file-server";
import { Actor, SerializedState } from "../../actorsystem/types.ts";
import { actorManager } from "../../actorsystem/actorManager.ts";
import { ActorP2P } from "../../actorsystem/actorP2P.ts";
import { RelativePositionService } from "../../helper/vrc/relativeposition.ts";

export class ServerActor extends ActorP2P<ServerActor> {
    
    private overlayPosition: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    private posService: RelativePositionService;
    private handler = async (req: Request): Promise<Response> => {
        const path = await new URL(req.url).pathname;
        console.log("req.url:", req.url);   
    
        if (req.url === 'http://localhost:8080/ws') {
            //connect to index html websocket, sub osc, calculate, send result to index html that takes values as coordinates in threejs
            console.log("WebSocket connection requested");
            const { socket, response } = Deno.upgradeWebSocket(req);
            socket.onopen = () => {
                console.log("WebSocket connection opened");
            };
            if (socket.readyState === WebSocket.OPEN) {
                if (this.overlayPosition !== undefined) {
                    const result2 = this.overlayPosition;
                    console.log("Sending result:", JSON.stringify(result2));
                    socket.send(JSON.stringify(result2));
                } else {
                    console.log("No valid position calculated.");
                }
            }
            return response;
        }
    
        if (path === "/") {
            return serveFile(req, "./index.html");
        }
        return new Response(null, {status: 404});
    };

    constructor(actorname: string, publicIp: string, posServ:RelativePositionService, state?: SerializedState<Actor>) {
        super(actorname, publicIp, state);
        this.posService = posServ;
    }
    
    h_startServer(_ctx: actorManager) {
        console.log("Starting Server");
        Deno.serve({port: 8080}, this.handler);
        this.posUpdate(this.posService);
    }
    
    posUpdate(relativePositionService: RelativePositionService){
        relativePositionService.subscribe((position) => {
            //position of one of the balls
            this.overlayPosition = position;
        });
    }

    override onStart(state?: SerializedState<Actor>) {
        // if (state) {
        //     const newstate = this.deserialize(state);
        //     this.state = newstate;
        //     console.log("actor state reloaded!");
        // }
    }

    h_logstate(_ctx: actorManager) {
        console.log(this.state.test);
    }

    async onStop() {

    }
}

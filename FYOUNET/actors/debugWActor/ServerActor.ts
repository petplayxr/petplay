// OverlayActor.ts
import { serveFile } from "jsr:@std/http/file-server";
import { Actor, SerializedState } from "../../actorsystem/types.ts";
import { actorManager } from "../../actorsystem/actorManager.ts";
import { ActorP2P } from "../../actorsystem/actorP2P.ts";
import { RelativePositionService } from "../../helper/vrc/relativeposition.ts";

export class ServerActor extends ActorP2P<ServerActor> {
    
    private posService: RelativePositionService;
    private socket: WebSocket | unknown;
    private handler = async (req: Request): Promise<Response> => {
        const path = await new URL(req.url).pathname;
        console.log("req.url:", req.url);   
    
        if (req.url === 'http://localhost:8080/ws') {
            console.log("WebSocket connection requested");
            const { socket, response } = Deno.upgradeWebSocket(req);
            const openSocket = new Promise((resolve: (value: void) => void , reject) => {
                socket.onopen = () => {
                  console.log("WebSocket connection opened");
                  resolve();
                };
              
                socket.onerror = (error) => {
                  console.error("WebSocket error:", error);
                  reject(error);
                };
            });
            await openSocket;
            this.socket = socket;
            return response;
        }
        

        const absPath = `${Deno.cwd()}/../${"../FYOUNET/actors/debugWActor/index.html"}`;
    
        if (path === "/") {
            return serveFile(req, absPath);
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
    
    async posUpdate(relativePositionService: RelativePositionService){
        let pos: number[]

        relativePositionService.subscribe(async (position) => {
            pos = position;
        });
        while (true) {
            
            //position of one of the balls
            if (pos && typeof this.socket !== "undefined") {


                const socket = this.socket as WebSocket;
                const tran = pos.translation;
                socket.send(JSON.stringify(pos));
            }
            await new Promise(resolve => setTimeout(resolve, 100));

        }
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

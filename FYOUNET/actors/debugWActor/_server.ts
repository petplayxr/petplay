import { serveFile } from "jsr:@std/http/file-server";
import { Tetrahedron3D } from "./tetrahedron.ts";
import { OscSubscriber } from './getvrcpos.ts';

//osc params
const PetPlay1: string = "/avatar/parameters/PetPlayPole1"; //float out
const PetPlay2: string = "/avatar/parameters/PetPlayPole2"; //float out
const PetPlay3: string = "/avatar/parameters/PetPlayPole3"; //float out
const PetPlay4: string = "/avatar/parameters/PetPlayPole4"; //float out

const distances: { [key: string]: number } = {};

const handler = async (req: Request): Promise<Response> => {
    const path = await new URL(req.url).pathname;
    console.log("req.url:", req.url);   

    if (req.url === 'http://localhost:8080/ws') {

        //connect to index html websocket, sub osc, calculate, send result to index html that takes values as coordinates in threejs

        console.log("WebSocket connection requested");
        const { socket, response } = Deno.upgradeWebSocket(req);
        socket.onopen = () => {
            console.log("WebSocket connection opened");
        };

        const oscSubscriber = new OscSubscriber([PetPlay1, PetPlay2, PetPlay3, PetPlay4]);

        //define the object
        const tetrahedron = new Tetrahedron3D([
            [0.1, 0, 0],
            [0, 0.1, 0],
            [0, 0, 0.1],
            [0, 0, 0]
        ]);
          
        oscSubscriber.subscribe((address, value) => {
            distances[address] = value;

            if (Object.keys(distances).length === 4) {
                const redDistance = distances[PetPlay1];
                const blueDistance = distances[PetPlay2];
                const greenDistance = distances[PetPlay3];
                const whiteDistance = distances[PetPlay4];

                const secondTetrahedron = tetrahedron.findSecondTetrahedron([redDistance, blueDistance, greenDistance, whiteDistance]);

                if (socket.readyState === WebSocket.OPEN) {
                    if (secondTetrahedron !== undefined) {
                        const result2 = secondTetrahedron
                        console.log("Sending result:", JSON.stringify(result2));
                        socket.send(JSON.stringify(result2));
                    } else {
                        console.log("No valid position calculated.");
                    }
                }
            }
        });

        oscSubscriber.listenForOscMessages().then(() => {
            console.log('Finished listening for OSC messages.');
        });
        return response;
    }

    if (path === "/") {
        return serveFile(req, "./index.html");
    }
    return new Response(null, {status: 404});
};

Deno.serve({port: 8080}, handler);
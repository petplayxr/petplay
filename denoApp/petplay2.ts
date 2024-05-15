import { Address } from "../FYOUNET/actorsystem/types.ts";
import { actorManager } from "../FYOUNET/actorsystem/actorManager.ts";
import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";
import * as mod from "jsr:@mys1024/worker-fn@2";
import { ChatApp } from "../FYOUNET/actors/ChatApp.ts";
import { OverlayActor } from "../FYOUNET/actors/OverlayActor.ts";
import { SimpleOverlayActor } from "../FYOUNET/actors/SimpleOverlayActor.ts";
import { aPortal } from "../FYOUNET/actors/PortalActor.ts";
import { getAvailablePort } from "https://deno.land/x/port/mod.ts"

//#region ovrinterface

class ExecRunner {
    constructor(private executablePath: string) { }

    async run(args: string[]) {
        const command = new Deno.Command(this.executablePath, {
            args: args,
            stdout: "piped",
            stderr: "piped"
        });

        const child = command.spawn();
        console.log(`Spawned child pid: ${child.pid}`);

        // Function to handle continuous stream reading and logging
        const continuouslyLogStream = async (stream: ReadableStream<Uint8Array>, label: string) => {
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = new TextDecoder().decode(value);
                    console.log(`${label}: ${text}`);
                }
            } catch (err) {
                console.error(`Error reading from ${label}:`, err);
            } finally {
                reader.releaseLock();
            }
        };

        // Start reading and logging stdout and stderr without waiting for them to finish
        continuouslyLogStream(child.stdout, "Standard Output");
        continuouslyLogStream(child.stderr, "Standard Error");

        // Monitor the process exit status in the background
        const status = await child.status;
        if (status.code !== 0) {
            console.error(`Process exited with code ${status.code}`);
        }

        // Ensure resources are cleaned up
        child.stdout.cancel(); // Cancel the stream to prevent memory leaks
        child.stderr.cancel();
        console.log("Resources have been cleaned up.");
    }
}



//#endregion

//#region petplay stuff

export type ReceivePayload = {
    addr: Address<ChatApp>,
    name: string,
} & ({ msg: string } | { event: "JOIN" | "LEAVE" })

export type ReceiveCoord = {
    addr: Address<OverlayActor>,
    name: string,
} & ({ data: string } | { event: "JOIN" | "LEAVE" })


const stream = Deno.stdin.readable.values()

async function asyncPrompt(): Promise<string> {
    const next = await stream.next()
    if ('done' in next && next.done) {
        return ""
    } else {
        return new TextDecoder().decode(next.value).slice(0, -1)
    }
}

//PROCESS USER COMMAND
async function processcommand(msgD: string) {

    const msg = msgD.replace(/\r/g, '');

    const cmd = msg.substring(1).split(" ");
    switch (cmd[0]) {
        case "c": {
            //initial connection

            if (!cmd[1]) {
                console.log(`Connecting to ${friendip}...`)
                //actormanager.command(aChatApp, "h_connect", friendip)
                //here were technically sharing our portal with friendip
                actormanager.command(portalActor, "h_connect", friendip)
            }
            else
            {
            console.log(`Connecting to ${cmd[1]}...`)
            //actormanager.command(aChatApp, "h_connect", cmd[1])
            actormanager.command(portalActor, "h_connect", cmd[1])
            break;
            }
            break
        }
        case "listactors": {  
            actormanager.listactors()
            break;
        }
        case "hlistractors": {
            const remoteportal = cmd[1] as Address<aPortal>
            actormanager.command(remoteportal, "h_listactors", portalActor)
            break;
        }
        case "hlistactors": {  
            actormanager.command(portalActor, "h_listactors", portalActor)
            break;
        }
        case "vr": {
            execRunner.run(["true", `${ipcport}`]);
            break
        }
        case "addoverlay": {
            const aOverlay: Address<SimpleOverlayActor> = actormanager.add(
                new SimpleOverlayActor(`${localip}:${await getAvailablePort()}`, "aSimpleOverlay", "./dependencies/petplay.exe")
            );

            //make overlay public?
            actormanager.command(portalActor, "h_addActor", aOverlay)
            break
        }

        default: {
            console.log(`Unknown command '/${cmd}'.`)
            break;
        }
    }
}

async function beginOverlaystream() {
    while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        actormanager.command(aOverlay, "h_broadcast", null)
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function checkOverlayConnection() {
    return new Promise((resolve) => {
        actormanager.command(aOverlay, "isConnected", (connected) => {
            if (connected) {
                console.log("OverlayActor is connected.");
                resolve(true);
            } else {
                console.log("OverlayActor is not connected.");
                setTimeout(() => resolve(false), 3000); // Retry after 1 second
            }
        });
    });
}

//#endregion

//#region start petplay



//#region consts

console.log("runtime args: " + Deno.args); // ['one, 'two', 'three']
const username = Deno.args[0]
const ownip = Deno.args[1]
const friendip = Deno.args[2]
const mode = Deno.args[3]
const release = Deno.args[4]

const execRunner = new ExecRunner("./dependencies/petplay.exe");

let ipcport = 27015
if (mode == "p1") {
    console.log("p1")
    ipcport = 27015
}
else if (mode == "p2") {
    console.log("p2")
    ipcport = 27016
}

//username and ip
const localfullip = ownip
const localip = localfullip.split(":")[0]

////why do i pass localip here instead of localfullip?
//15.05 🤦‍♀️
const actormanager = new actorManager(localfullip)

//we create a new chatapp actor on the localip with the actor type "chat"
//specifying type here is dumb should be changed
/* const aChatApp: Address<ChatApp> = actormanager.add(new ChatApp(localfullip, username, "chat")) */

//we create a new portal actor on the localip
const portalActor: Address<aPortal> = actormanager.add(new aPortal(ownip, username))

// here were technically sharing our portal with friendip
// actormanager.command(aPortal, "h_connect", friendip)


//we create a new overlay actor on the localip







/* const functionData = "CreateBasicOverlay";
const overlayName = "exampleOverlay";
const pathToTexture = "c:/GIT/petplay/denoApp/resources/P1.png";


const message = `${functionData};${overlayName};${pathToTexture};`

actormanager.command(aOverlay, "sendToOverlay", message) */


//#endregion


if (import.meta.main) {
   

    //actual start of the program

    //true?
    /* if (release == "true") {
        execRunner.run(["true", `${ipcport}`]);
    } */


    console.log(`Your IP is ${localfullip}`)

    

    //this func should be improved a bit
    actormanager.listactors()

    /* while (!(await checkOverlayConnection())) {
        console.log("Waiting for overlay to connect...");
    }
    beginOverlaystream(); */

    while (true) {

        //await new Promise((resolve) => setTimeout(resolve, 5000));

        //fix type
        

        const msg = await asyncPrompt() ?? ""

        if (msg.startsWith("/")) {
            console.log("Command")
            await processcommand(msg)
        } else {
            // clear line
            await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"))

            //tell chat app to broadcast message
            //actormanager.command(aChatApp, "h_broadcast", msg)
        }
    }
}

// Instantiate the runner with the path to the executable


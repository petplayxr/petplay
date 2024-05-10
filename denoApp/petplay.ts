import { Address } from "../FYOUNET/actorsystem/types.ts";
import { actorManager } from "../FYOUNET/actorsystem/actorManager.ts";
import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";
import * as mod from "jsr:@mys1024/worker-fn@2";
import { ChatApp } from "../FYOUNET/actors/ChatApp.ts";
import { OverlayActor } from "../FYOUNET/actors/OverlayActor.ts";

//#region ovrinterface

class ExecRunner {
    constructor(private executablePath: string) { }

    async run(args: string[]) {
        const command = new Deno.Command(this.executablePath, {
            args: args,
            stdout: "piped",
            stderr: "piped",
        });

        // Wait for the command to finish and collect its output
        const { code, stdout, stderr } = await command.output();

        // Log stdout and stderr separately
        console.log("Standard Output:");
        console.log(new TextDecoder().decode(stdout));
        console.log("Standard Error:");
        console.log(new TextDecoder().decode(stderr));

        if (code !== 0) {
            console.log("ovrcrashed with", code);
            //throw new Error(`Command failed with exit code ${code}: ${new TextDecoder().decode(stderr)}`);
        }
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

function processcommand(msgD: string) {

    const msg = msgD.replace(/\r/g, '');

    const cmd = msg.substring(1).split(" ");
    switch (cmd[0]) {
        case "c": {
            //initial connection

            if (!cmd[1]) {
                console.log(`Connecting to ${friendip}...`)
                actormanager.command(aChatApp, "h_connect", friendip)
                actormanager.command(aOverlay, "h_connect", friendip)
            }
            else
            {
            console.log(`Connecting to ${cmd[1]}...`)
            actormanager.command(aChatApp, "h_connect", cmd[1])
            actormanager.command(aOverlay, "h_connect", cmd[1])
            break;
            }
            break
        }
        case "listactors": {  
            actormanager.listactors()
            break;
        }
        case "vr": {
            execRunner.run(["true", `${ipcport}`]);
            break
        }


        default: {
            console.log(`Unknown command '/${cmd}'.`)
            break;
        }
    }
}

function beginOverlaystream() {
    while (true) {
        actormanager.command(aOverlay, "h_broadcast", null)
    }
    
}

//#endregion

//#region start petplay



//#region consts

console.log("runtime args: " + Deno.args); // ['one, 'two', 'three']
const username = Deno.args[0]
const ownip = Deno.args[1]
const friendip = Deno.args[2]
const mode = Deno.args[3]

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
const localip = ownip.split(":")[0]

//why do i pass localip here instead of localfullip?
const actormanager = new actorManager(localip)

//we create a new chatapp actor on the localip with the actor type "chat"
//specifying type here is dumb should be changed
const aChatApp: Address<ChatApp> = actormanager.add(new ChatApp(localfullip, username, "chat"))

//we create a new overlay actor on the localip
const aOverlay: Address<OverlayActor> = actormanager.add(new OverlayActor(`${localip}:25568`, username, ipcport))


//#endregion


if (import.meta.main) {
   

    //actual start of the program

    //true?
    execRunner.run(["true", `${ipcport}`]);


    console.log(`Your IP is ${localfullip}`)

    

    //this func should be improved a bit
    actormanager.listactors()

    while (true) {

        //fix type
        actormanager.command(aOverlay, "isConnected", (connected:boolean) => {
            if (connected) {
                console.log("OverlayActor is connected.");
                beginOverlaystream()
                
            } else {
                console.log("OverlayActor is not connected.");
            }
        });

        const msg = await asyncPrompt() ?? ""

        if (msg.startsWith("/")) {
            console.log("Command")
            processcommand(msg)
        } else {
            // clear line
            await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"))

            //tell chat app to broadcast message
            actormanager.command(aChatApp, "h_broadcast", msg)
        }
    }
}

// Instantiate the runner with the path to the executable


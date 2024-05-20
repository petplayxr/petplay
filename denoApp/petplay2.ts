import { Address, CloudAddress } from "../FYOUNET/actorsystem/types.ts";
import { actorManager } from "../FYOUNET/actorsystem/actorManager.ts";
import { ChatApp } from "../FYOUNET/actors/ChatApp.ts";
import { OverlayActor } from "../FYOUNET/actors/old/OverlayActor.ts";
import { SimpleOverlayActor } from "../FYOUNET/actors/SimpleOverlayActor.ts";
import { aPortal } from "../FYOUNET/actors/PortalActor.ts";
import { getAvailablePort } from "https://deno.land/x/port@1.0.0/mod.ts"
import { aOVRInput } from "../FYOUNET/actors/OVRInput.ts";
import { aTest } from "../FYOUNET/actors/TestActor.ts";
import { cloudSpace } from "../FYOUNET/actorsystem/cloudActorManager.ts";

//#region why are these here
export type ReceivePayload = {
    addr: Address<ChatApp>,
    name: string,
} & ({ msg: string } | { event: "JOIN" | "LEAVE" })

export type ReceiveCoord = {
    addr: Address<OverlayActor>,
    name: string,
} & ({ data: string } | { event: "JOIN" | "LEAVE" })
//#endregion

//#region consts

const stream = Deno.stdin.readable.values()

console.log("runtime args: " + Deno.args); // ['one, 'two', 'three']
const username = Deno.args[0]
const ownip = Deno.args[1]
const friendip = Deno.args[2]
const mode = Deno.args[3]

// do const value = thing ? 1 : 2
const ipcport = mode === "p1"? 27015 : mode === "p2"? 27016 : undefined;
if (ipcport!== undefined) {
    console.log(mode);
}

//username and ip
const localfullip = ownip
const localip = localfullip.split(":")[0]




//#endregion


//PROGRAM STARTS HERE

async function asyncPrompt(): Promise<string> {
    const next = await stream.next()
    if ('done' in next && next.done) {
        return ""
    } else {
        return new TextDecoder().decode(next.value).slice(0, -1)
    }
}


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
            //control a remote actor 🤯
            const remoteportal = cmd[1] as Address<aPortal>
            actormanager.command(remoteportal, "h_listactors", portalActor)
            break;
        }
        case "hlistactors": {  
            actormanager.command(portalActor, "h_listactors", portalActor)
            break;
        }
        case "addoverlay": {
            const aOverlay: Address<SimpleOverlayActor> = actormanager.add(
                new SimpleOverlayActor(await IP(), "aSimpleOverlay", "./dependencies/petplay.exe")
            );

            //make overlay public?
            actormanager.command(portalActor, "h_recordAddress", aOverlay)
            break
        }

        default: {
            console.log(`Unknown command '/${cmd}'.`)
            break;
        }
    }
}

async function IP() {

    return `${localip}:${await getAvailablePort()}`

}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//create actormanager
const actormanager = new actorManager(localfullip)
const cloud : cloudSpace = new cloudSpace(localfullip)

const testactor: Address<aTest> = actormanager.add(new aTest("testactor",await IP()))

actormanager.command(testactor, "h_logstate", null)

actormanager.command(testactor, "h_test", null)

actormanager.command(testactor, "h_logstate", null)

const testactor2 : CloudAddress<Address<aTest>> = await actormanager.transferToCloudSpace(testactor, cloud)

cloud.command(testactor2, "h_logstate", null)

const portal = actormanager.add(new aPortal(localfullip, username))

//create a portal actor, essentially a public endpoint of an user, contains an addressbook where actor addresses can be added
/* const portalActor: Address<aPortal> = actormanager.add(new aPortal(ownip, username))

//create a more functional actor, in this case the actor connects to the vr system and can be queried for data
const ovrInput  = actormanager.add(new aOVRInput(await IP(), "c:/GIT/petplay/OVRINTERFACE/out/build/user/Debug/ovrinput.exe"))

//query some vr data
actormanager.command(ovrInput, "h_getOVRData", (data:string) => {console.log(data)});

//record the address of the vr actor
actormanager.command(portalActor, "h_recordAddress", ovrInput) */


if (import.meta.main) {

    /* console.log(`Your IP is ${localfullip}`) */

    while (true) {


        const msg = await asyncPrompt() ?? ""

        if (msg.startsWith("/")) {
            console.log("Command")
            await processcommand(msg)
        } else {
            // clear line
            await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"))
        }



    }
}
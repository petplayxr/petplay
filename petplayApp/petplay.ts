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

//#region actor payload types
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


//username and ip
const localfullip = ownip
const localip = localfullip.split(":")[0]


//#endregion
//#region helper funcs
async function IP() {return `${localip}:${await getAvailablePort()}`}
async function wait(ms: number) {return await new Promise(resolve => setTimeout(resolve, ms));}
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

// command processor for petplay terminal commands
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


//create actormanager
const actormanager = new actorManager(localfullip)
const cloud : cloudSpace = new cloudSpace(localfullip)

//create test actor
const testactor: Address<aTest> = actormanager.add(new aTest("testactor",await IP()))

//command test actor to log its internal state
actormanager.command(testactor, "h_logstate", null)

//change test actors internal state
actormanager.command(testactor, "h_test", null)

//check test actors internal state again
actormanager.command(testactor, "h_logstate", null)

//transfer test actor to cloud space
const cloudtestactor : CloudAddress<Address<aTest>> = await actormanager.transferToCloudSpace(testactor, cloud)

//check test actors internal state in the cloud
cloud.command(cloudtestactor, "h_logstate", null)

//create a portal actor, essentially a public endpoint of an user, contains an addressbook where actor addresses can be added
const portalActor: Address<aPortal> = actormanager.add(new aPortal(ownip, username))

//record the address of the vr actor to our portals address book for external access
actormanager.command(portalActor, "h_recordAddress", cloudtestactor)


//this should probably list actors in cloudspace
actormanager.listactors()


//do same with a vr actor
/* const ovrInput  = actormanager.add(new aOVRInput(await IP(), "c:/GIT/petplay/OVRINTERFACE/out/build/user/Debug/ovrinput.exe"))
actormanager.command(ovrInput, "h_getOVRData", (data:string) => {console.log(data)});
actormanager.command(portalActor, "h_recordAddress", ovrInput) */



if (import.meta.main) {

    console.log(`Your IP is ${await IP()}`)

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
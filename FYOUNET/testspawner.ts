import { OverlayInterface } from "./OVRInterface.ts";


async function spawn() {
    const overlayId = "Overlay1";
    const executablePath = "c:/GIT/petplay/OVRINTERFACE/out/build/user/Debug/ovrinput.exe";
    const OVR = new OverlayInterface(overlayId, executablePath);
    await OVR.connect();

    const functionData = "CreateBasicOverlay";
    const overlayName = "exampleOverlay";
    const pathToTexture = "c:/GIT/petplay/denoApp/resources/P1.png";
    
    // Construct the message as a single string
    const message = `${functionData};${overlayName};${pathToTexture};`

    await OVR.send(message);

    await OVR.receive();

    await new Promise(resolve => setTimeout(resolve, 12000))

    await OVR.disconnect();
}

if (import.meta.main) {
    console.log("Running main");
    spawn();
}
import { OverlayInterface } from "./OverlayInterface.ts";


async function spawn() {
    const overlayId = "Overlay1";
    const executablePath = "c:/GIT/petplay/OVRINTERFACE/out/build/user/Debug/ovrinput.exe";
    const ovrConnector = new OverlayInterface(overlayId, executablePath);
    await ovrConnector.connect();

    const functionData = "CreateBasicOverlay";
    const overlayName = "exampleOverlay";
    const pathToTexture = "c:/GIT/petplay/denoApp/resources/P1.png";
    
    // Construct the message as a single string
    const message = `${functionData};${overlayName};${pathToTexture};`;

    await ovrConnector.receive();

    await new Promise(resolve => setTimeout(resolve, 12000))

    await ovrConnector.disconnect();
}

if (import.meta.main) {
    console.log("Running main");
    spawn();
}
import {
    ActorFunctions,
    BaseState,
    worker,
    MessageAddressReal,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import * as OpenVR from "../OpenVR_TS/openvr_bindings.ts";
import { P } from "../OpenVR_TS/pointers.ts";
import { stringToPointer } from "../OpenVR_TS/utils.ts";


type State = {
    id: string;
    db: Record<string, unknown>;
    overlayClass: OpenVR.IVROverlay|null;
    overlayHandle: OpenVR.OverlayHandle;
    overlayerror: OpenVR.OverlayError;
    [key: string]: unknown;
};

const state: State & BaseState = {
    id: "",
    db: {},
    name: "sub",
    socket: null,
    overlayClass: null,
    numbah: 0,
    addressbook: [],
    overlayHandle: 0n,
    TrackingUniverseOriginPTR: null,
    overlayerror: OpenVR.OverlayError.VROverlayError_None,
};

const functions: ActorFunctions = {
    CUSTOMINIT: (_payload) => {
        main()
    },
    LOG: (_payload) => {
        console.log(state.id);
    },
    GETID: (_payload, address) => {
        // use a check here
        const addr = address as MessageAddressReal;
        Postman.PostMessage(worker, {
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETID",
            payload: state.id,
        }, false);
    },
    GETOVERLAYLOCATION: (_payload, address) => {
        const addr = address as MessageAddressReal;
        const overlay = state.overlayClass!
        const overlayHandle = state.overlayHandle
        let error = state.overlayerror

        console.log("overlay handle:", overlayHandle);

        const TrackingUniverseOriginPTR = P.Int32P<OpenVR.TrackingUniverseOrigin>();
        const hmd34size = OpenVR.HmdMatrix34Struct.byteSize;
        const hmd34buf = new ArrayBuffer(hmd34size);
        const hmd34view = new DataView(hmd34buf);
        const m34ptr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(hmd34buf)!;


        error = overlay.GetOverlayTransformAbsolute(overlayHandle, TrackingUniverseOriginPTR, m34ptr);
        if (error !== OpenVR.OverlayError.VROverlayError_None) {
            console.error(`Failed to get overlay transform: ${OpenVR.OverlayError[error]}`);
            throw new Error("Failed to get overlay transform");
        }
        const m34 = OpenVR.HmdMatrix34Struct.read(hmd34view);


        Postman.PostMessage(worker, {
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETOVERLAYLOCATION",
            payload: m34,
        });
    },
    SETOVERLAYLOCATION: (payload, _address) => {
        const transform = payload as OpenVR.HmdMatrix34;
        setOverlayTransformAbsolute(transform);
    }
};

function setOverlayTransformAbsolute(transform: OpenVR.HmdMatrix34)
{
    const overlay = state.overlayClass!;
    const transformBuffer = new ArrayBuffer(OpenVR.HmdMatrix34Struct.byteSize);
    const transformView = new DataView(transformBuffer);
    OpenVR.HmdMatrix34Struct.write(transform, transformView);
    const transformPtr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(transformBuffer)!;

    overlay.SetOverlayTransformAbsolute(state.overlayHandle, OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding, transformPtr);
}




function main() {

    //#region init
    let error;


    const initerrorptr = Deno.UnsafePointer.of<OpenVR.InitError>(new Int32Array(1))!
    const TypeSafeINITERRPTR: OpenVR.InitErrorPTRType = initerrorptr


    const errorX = Deno.UnsafePointer.of(new Int32Array(1))!;
    OpenVR.VR_InitInternal(errorX, OpenVR.ApplicationType.VRApplication_Overlay);
    error = new Deno.UnsafePointerView(errorX).getInt32();
    console.log(error)


    const overlayPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVROverlay_Version), TypeSafeINITERRPTR);


    state.overlayClass = new OpenVR.IVROverlay(overlayPtr);
    const overlay = state.overlayClass as OpenVR.IVROverlay;
    //#endregion


    const overlayHandlePTR = P.BigUint64P<OpenVR.OverlayHandle>();
    error = overlay.CreateOverlay("image", "image", overlayHandlePTR);
    const overlayHandle = new Deno.UnsafePointerView(overlayHandlePTR).getBigUint64();
    state.overlayHandle = overlayHandle;

    console.log(`Overlay created with handle: ${overlayHandle}`);

    const imgpath = Deno.realPathSync("./resources/PetPlay.png");
    overlay.SetOverlayFromFile(overlayHandle, imgpath);
    overlay.SetOverlayWidthInMeters(overlayHandle, 0.1);
    overlay.ShowOverlay(overlayHandle);

    
    const initialTransformSize = OpenVR.HmdMatrix34Struct.byteSize;
    const initialTransformBuf = new ArrayBuffer(initialTransformSize);
    const initialTransformView = new DataView(initialTransformBuf);

    const initialTransform: OpenVR.HmdMatrix34 = {
        m: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, -2.0]
        ]
    };
    OpenVR.HmdMatrix34Struct.write(initialTransform, initialTransformView);
  

    state.trackingUniverseOriginPTR = Deno.UnsafePointer.of<OpenVR.TrackingUniverseOrigin>(new Int32Array(1))!;
   
    setOverlayTransformAbsolute(initialTransform)



    console.log("Overlay created and shown. Press Ctrl+C to exit.");
    //Postman.functions?.RTC?.(null, state.id);
}



new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

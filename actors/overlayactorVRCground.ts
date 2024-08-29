import {
    ActorFunctions,
    BaseState,
    worker,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { wait } from "../actorsystem/utils.ts";
import * as OpenVR from "../OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { P } from "../OpenVR_TS_Bindings_Deno/pointers.ts";
import { stringToPointer } from "../OpenVR_TS_Bindings_Deno/utils.ts";
import { CustomLogger } from "../classes/customlogger.ts";
import { getId } from "../classes/actorUtils.ts";
import { CoordState, getOverlayLocation, getOverlayTransformAbsolute, setOverlayLocation, setOverlayTransformAbsolute } from "../classes/actorCoords.ts";

//a steamvr overlay

interface State extends CoordState, BaseState {
    id: string;
    vrc: string;
    db: Record<string, unknown>;
    [key: string]: unknown;
};

const state: State = {
    id: "",
    db: {},
    name: "overlay1",
    vrc: "",
    socket: null,
    sync: false,
    overlayClass: null,
    OverlayTransform: null,
    numbah: 0,
    addressBook: new Set(),
    overlayHandle: 0n,
    TrackingUniverseOriginPTR: null,
    overlayError: OpenVR.OverlayError.VROverlayError_None,
};


const functions: ActorFunctions = {
    CUSTOMINIT: (_payload) => {
        Postman.functions?.HYPERSWARM?.(null, state.id);
        //main()
    },
    LOG: (_payload) => {
        CustomLogger.log("actor", state.id);
    },
    GETID: (_payload, _address) => getId(_address, state.id), 
    STARTOVERLAY: (payload, _address) => startOverlay(payload.name, payload.texture, payload.sync),
    SETOVERLAYLOCATION: (payload, _address) => setOverlayLocation(state, payload, _address),
    GETOVERLAYLOCATION: (payload, _address) => getOverlayLocation(state, payload, _address),
    ASSIGNVRC: (payload) => {
        state.vrc = payload;
    },
};



async function startOverlay(overlaymame: string, overlaytexture: string, sync: boolean) {


    state.sync = sync;


    //#region init openvr
    let error;


    const initerrorptr = Deno.UnsafePointer.of<OpenVR.InitError>(new Int32Array(1))!
    const TypeSafeINITERRPTR: OpenVR.InitErrorPTRType = initerrorptr


    const errorX = Deno.UnsafePointer.of(new Int32Array(1))!;
    OpenVR.VR_InitInternal(errorX, OpenVR.ApplicationType.VRApplication_Overlay);
    error = new Deno.UnsafePointerView(errorX).getInt32();
    CustomLogger.log("actor", error)


    const overlayPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVROverlay_Version), TypeSafeINITERRPTR);


    state.overlayClass = new OpenVR.IVROverlay(overlayPtr);
    const overlay = state.overlayClass as OpenVR.IVROverlay;
    //#endregion

    //#region overlay
    const overlayHandlePTR = P.BigUint64P<OpenVR.OverlayHandle>();
    error = overlay.CreateOverlay(overlaymame, overlaymame, overlayHandlePTR);
    const overlayHandle = new Deno.UnsafePointerView(overlayHandlePTR).getBigUint64();
    state.overlayHandle = overlayHandle;

    CustomLogger.log("actor", `Overlay created with handle: ${overlayHandle}`);

    const imgpath = Deno.realPathSync(overlaytexture);
    overlay.SetOverlayFromFile(overlayHandle, imgpath);
    overlay.SetOverlayWidthInMeters(overlayHandle, 0.2);
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
    setOverlayTransformAbsolute(state, initialTransform)

    CustomLogger.log("default", "Overlay created and shown.");
    //#endregion

    interface LastKnownPosition {
        x: number;
        y: number;
        z: number;
    }
    const lastKnownPosition: LastKnownPosition = { x: 0, y: 0, z: 0 };

    await wait(7000)

    await wait(10)

    // Angle of rotation (in radians)
    const angle = -Math.PI / 2; // -90 degrees, pointing straight down

    // Sin and cos of the angle
    const s = Math.sin(angle);
    const c = Math.cos(angle);

    const matrix: OpenVR.HmdMatrix34 = {
        m: [
            [1, 0, 0, 0],    // First column: No change in X
            [0, c, -s, 0.1],  // Second column: Rotate around X, slight elevation
            [0, -s, -c, 0]    // Third column: Rotate around X, inverted
        ]
    };

    setOverlayTransformAbsolute(state, matrix)


}





new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

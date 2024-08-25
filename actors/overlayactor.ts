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
import { CoordState, getOverlayLocation, getOverlayTransformAbsolute, setOverlayLocation, setOverlayTransformAbsolute } from "../classes/actorCoords.ts";
import { getId } from "../classes/actorUtils.ts";

//a steamvr overlay

interface State extends CoordState, BaseState {
    db: Record<string, unknown>;
    OverlayTransform: OpenVR.HmdMatrix34 | null;
    [key: string]: unknown;
};

const state: State = {
    id: "",
    db: {},
    name: "overlay1",
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
    GETOVERLAYLOCATION: (payload, _address) => getOverlayLocation(state, payload, _address)
};

async function startOverlay(overlaymame: string, overlaytexture: string, sync: boolean) {
    state.sync = sync;

    //#region init openvr
    let error;

    const initerrorptr = Deno.UnsafePointer.of<OpenVR.InitError>(new Int32Array(1))!;
    const TypeSafeINITERRPTR: OpenVR.InitErrorPTRType = initerrorptr;

    const errorX = Deno.UnsafePointer.of(new Int32Array(1))!;
    OpenVR.VR_InitInternal(errorX, OpenVR.ApplicationType.VRApplication_Overlay);
    error = new Deno.UnsafePointerView(errorX).getInt32();
    CustomLogger.log("actor", error);

    const overlayPtr = OpenVR.VR_GetGenericInterface(
        stringToPointer(OpenVR.IVROverlay_Version),
        TypeSafeINITERRPTR,
    );

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
            [0.0, 0.0, 1.0, -2.0],
        ],
    };
    OpenVR.HmdMatrix34Struct.write(initialTransform, initialTransformView);
    state.trackingUniverseOriginPTR = Deno.UnsafePointer.of<OpenVR.TrackingUniverseOrigin>(
        new Int32Array(1),
    )!;
    setOverlayTransformAbsolute(state, initialTransform);

    CustomLogger.log("default", "Overlay created and shown.");
    //#endregion

    await wait(7000);

    if (sync) {
        syncloop();
    }
}

async function syncloop() {
    CustomLogger.log("default", "syncloop started");
    while (true) {
        const m34 = getOverlayTransformAbsolute(state);
        state.addressBook.forEach((address) => {
            Postman.PostMessage({
                address: { fm: state.id, to: address },
                type: "SETOVERLAYLOCATION",
                payload: m34,
            });
        });

        await wait(50);
    }
}


new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

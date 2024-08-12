import {
    ActorFunctions,
    BaseState,
    worker,
    ToAddress,
    MessageAddressReal,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import { wait } from "../actorsystem/utils.ts";
import * as OpenVR from "../OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { P } from "../OpenVR_TS_Bindings_Deno/pointers.ts";
import { stringToPointer } from "../OpenVR_TS_Bindings_Deno/utils.ts";
import { CustomLogger } from "../classes/customlogger.ts";

//a steamvr overlay

type State = {
    id: string;
    vrc: string;
    db: Record<string, unknown>;
    overlayClass: OpenVR.IVROverlay | null;
    overlayHandle: OpenVR.OverlayHandle;
    overlayerror: OpenVR.OverlayError;
    OverlayTransform: OpenVR.HmdMatrix34 | null;
    [key: string]: unknown;
};

const state: State & BaseState = {
    id: "",
    db: {},
    name: "overlay1",
    vrc: "",
    socket: null,
    sync: false,
    overlayClass: null,
    OverlayTransform: null,
    numbah: 0,
    addressBook: new Array<string>(),
    overlayHandle: 0n,
    TrackingUniverseOriginPTR: null,
    overlayerror: OpenVR.OverlayError.VROverlayError_None,
};

const functions: ActorFunctions = {
    CUSTOMINIT: (_payload) => {
        Postman.functions?.RTC?.(null, state.id);
        //main()
    },
    LOG: (_payload) => {
        CustomLogger.log("actor", state.id);
    },
    GETID: (_payload, address) => {
        // use a check here
        const addr = address as MessageAddressReal;
        Postman.PostMessage({
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETID",
            payload: state.id,
        }, false);
    },
    ASSIGNVRC: (payload) => {
        state.vrc = payload;
    },
    STARTOVERLAY: (payload, _address) => {

        mainX(payload.name, payload.texture, payload.sync);

    },
    ADDADDRESS: (payload, _address) => {
        state.addressBook.push(payload);
    },
    GETOVERLAYLOCATION: (_payload, address) => {
        const addr = address as MessageAddressReal;

        const m34 = GetOverlayTransformAbsolute();

        Postman.PostMessage({
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETOVERLAYLOCATION",
            payload: m34,
        });
    },
    SETOVERLAYLOCATION: (payload, _address) => {
        const transform = payload as OpenVR.HmdMatrix34;
        if (state.sync == false) {
            CustomLogger.log("syncloop", "set transform ");
        }
        setOverlayTransformAbsolute(transform);
    }
};

function setOverlayTransformAbsolute(transform: OpenVR.HmdMatrix34) {



    const overlay = state.overlayClass!;
    const transformBuffer = new ArrayBuffer(OpenVR.HmdMatrix34Struct.byteSize);
    const transformView = new DataView(transformBuffer);
    OpenVR.HmdMatrix34Struct.write(transform, transformView);
    const transformPtr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(transformBuffer)!;

    overlay.SetOverlayTransformAbsolute(state.overlayHandle, OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding, transformPtr);
}

function GetOverlayTransformAbsolute(): OpenVR.HmdMatrix34 {

    let error = state.overlayerror
    const overlay = state.overlayClass!
    const overlayHandle = state.overlayHandle


    const TrackingUniverseOriginPTR = P.Int32P<OpenVR.TrackingUniverseOrigin>();
    const hmd34size = OpenVR.HmdMatrix34Struct.byteSize;
    const hmd34buf = new ArrayBuffer(hmd34size);
    const hmd34view = new DataView(hmd34buf);
    const m34ptr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(hmd34buf)!;

    error = overlay.GetOverlayTransformAbsolute(overlayHandle, TrackingUniverseOriginPTR, m34ptr);
    if (error !== OpenVR.OverlayError.VROverlayError_None) {
        CustomLogger.error("actorerr", `Failed to get overlay transform: ${OpenVR.OverlayError[error]}`);
        throw new Error("Failed to get overlay transform");
    }
    const m34 = OpenVR.HmdMatrix34Struct.read(hmd34view) as OpenVR.HmdMatrix34;

    return m34;
}

const PositionX: string = "/avatar/parameters/CustomObjectSync/PositionX";
const PositionXNeg: string = "/avatar/parameters/CustomObjectSync/PositionXNeg";
const PositionXPos: string = "/avatar/parameters/CustomObjectSync/PositionXPos";
const RotationX: string = "/avatar/parameters/CustomObjectSync/RotationX";
const AngleMagX_Angle = "/avatar/parameters/CustomObjectSync/AngleMagX_Angle";
const AngleSignX_Angle = "/avatar/parameters/CustomObjectSync/AngleSignX_Angle"

const PositionY: string = "/avatar/parameters/CustomObjectSync/PositionY";
const PositionYNeg: string = "/avatar/parameters/CustomObjectSync/PositionYNeg";
const PositionYPos: string = "/avatar/parameters/CustomObjectSync/PositionYPos";
const RotationY: string = "/avatar/parameters/CustomObjectSync/RotationY";
const AngleMagY_Angle = "/avatar/parameters/CustomObjectSync/AngleMagY_Angle";
const AngleSignY_Angle = "/avatar/parameters/CustomObjectSync/AngleSignY_Angle"

const PositionZ: string = "/avatar/parameters/CustomObjectSync/PositionZ";
const PositionZNeg: string = "/avatar/parameters/CustomObjectSync/PositionZNeg";
const PositionZPos: string = "/avatar/parameters/CustomObjectSync/PositionZPos";
const RotationZ: string = "/avatar/parameters/CustomObjectSync/RotationZ";
const AngleMagZ_Angle = "/avatar/parameters/CustomObjectSync/AngleMagZ_Angle";
const AngleSignZ_Angle = "/avatar/parameters/CustomObjectSync/AngleSignZ_Angle"

const lastKnownPosition: LastKnownPosition = { x: 0, y: 0, z: 0 };
const lastKnownRotation: LastKnownRotation = { y: 0 };


interface LastKnownPosition {
    x: number;
    y: number;
    z: number;
}

interface LastKnownRotation {

    y: number;

}




async function mainX(overlaymame: string, overlaytexture: string, sync: boolean) {


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
    overlay.SetOverlayWidthInMeters(overlayHandle, 1);
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

    CustomLogger.log("default", "Overlay created and shown.");
    //#endregion


    await wait(7000)

    function transformCoordinate(value: number): number {

        return (value - 0.5) * 220;
    }
    
    function transformRotation(value: number): number {
        return value * 2 * Math.PI;
    }
    

    while (true) {

        if (state.vrc != "") {
            interface coord {
                [key: string]: number;
            }
            const coordinate = await Postman.PostMessage( {
                address: { fm: state.id, to: state.vrc },
                type: "GETCOORDINATE",
                payload: null,
            }, true) as coord;

            if (coordinate[PositionX] !== undefined) lastKnownPosition.x = coordinate[PositionX];
            if (coordinate[PositionY] !== undefined) lastKnownPosition.y = coordinate[PositionY];
            if (coordinate[PositionZ] !== undefined) lastKnownPosition.z = coordinate[PositionZ];
            
            if (coordinate[RotationY] !== undefined) lastKnownRotation.y = coordinate[RotationY];

            const transformedX = transformCoordinate(lastKnownPosition.x);
            const transformedY = transformCoordinate(lastKnownPosition.y);
            const transformedZ = transformCoordinate(lastKnownPosition.z);
            const rotY = transformRotation(lastKnownRotation.y);

            const cosY = Math.cos(rotY);
            const sinY = Math.sin(rotY);

            const rotatedX = transformedX * cosY - transformedZ * sinY;
            const rotatedZ = transformedX * sinY + transformedZ * cosY;

            const matrix: OpenVR.HmdMatrix34 = {
                m: [
                    [cosY, 0, sinY, rotatedX],    // First column: No change in X
                    [0, 1, 0, -transformedY+2.2],  // Second column: Rotate around X, slight elevation
                    [-sinY, 0, cosY, -rotatedZ]    // Third column: Rotate around X, inverted
                ]
            }; 

            CustomLogger.log("default", "a: ", matrix.m[0][0]);

            setOverlayTransformAbsolute(matrix)

        }
        await wait(1)




    }

}



async function syncloop() {
    CustomLogger.log("default", "syncloop started");
    while (true) {


        const m34 = GetOverlayTransformAbsolute();
        Postman.PostMessage({
            address: { fm: state.id, to: state.addressBook },
            type: "SETOVERLAYLOCATION",
            payload: m34,
        });
        await wait(10);
    }
}



new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});

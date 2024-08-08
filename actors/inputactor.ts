
import {
    ActorFunctions,
    BaseState,
    worker,
    MessageAddressReal,
} from "../actorsystem/types.ts";
import { OnMessage, Postman } from "../classes/PostMan.ts";
import * as OpenVR from "../OpenVR_TS/openvr_bindings.ts";
import { fillBuffer, readBufferStructured } from "../OpenVR_TS/utils.ts";
import { P } from "../OpenVR_TS/pointers.ts";

//steamvr input handling

type State = {
    id: string;
    db: Record<string, unknown>;
    [key: string]: unknown;
};

const state: State & BaseState = {
    id: "",
    db: {},

    TrackingUniverseOriginPTR: null,
    name: "sub",
    inputerror: OpenVR.InputError.VRInputError_None,
    socket: null,

    numbah: 0,
    addressbook: [],
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
    GETCONTROLLERDATA: (_payload, address) => {
        const addr = address as MessageAddressReal;

        updateActionState();

        let leftPoseData

        console.log("X", handPoseLeftHandle, posedataleftpointer);

        //pose
        error = vrInput.GetPoseActionDataRelativeToNow(
            handPoseLeftHandle,
            OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding,
            0,
            posedataleftpointer,
            96,
            OpenVR.k_ulInvalidInputValueHandle
        );
        if (error === OpenVR.InputError.VRInputError_None) {
            leftPoseData = OpenVR.InputPoseActionDataStruct.read(poseDataViewL);
        }

        //button
        error = vrInput.GetDigitalActionData(
            triggerLeftHandle,
            triggerLeftPointer,
            24,
            OpenVR.k_ulInvalidInputValueHandle
        );
        const leftTriggerData = OpenVR.InputDigitalActionDataStruct.read(triggerDataViewL);


        Postman.PostMessage(worker, {
            address: { fm: state.id, to: addr.fm },
            type: "CB:GETCONTROLLERDATA",
            payload: [leftPoseData, leftTriggerData]
        });
    }
};


function stringToPointer(str: string): Deno.PointerValue {
    const encoder = new TextEncoder();
    const view = encoder.encode(str + '\0');
    return Deno.UnsafePointer.of(view);
}

//#region input
let error;
const manifestPath = Deno.realPathSync("./OpenVR_TS/actions.json");
const initerrorptr = Deno.UnsafePointer.of<OpenVR.InitError>(new Int32Array(1))!
const TypeSafeINITERRPTR: OpenVR.InitErrorPTRType = initerrorptr
const IVRInputPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVRInput_Version), TypeSafeINITERRPTR);
const vrInput = new OpenVR.IVRInput(IVRInputPtr);
//#endregion

//#region pose
const poseDataSize = OpenVR.InputPoseActionDataStruct.byteSize;
const bufferL = new ArrayBuffer(poseDataSize);

const poseDataViewL = new DataView(bufferL);

const posedataleftpointer = Deno.UnsafePointer.of<OpenVR.InputPoseActionData>(bufferL)!;

const actionSetHandlePTR = P.BigUint64P<OpenVR.ActionSetHandle>();
error = vrInput.GetActionSetHandle("/actions/main", actionSetHandlePTR);
if (error !== OpenVR.InputError.VRInputError_None) {
    console.error(`Failed to get action set handle: ${OpenVR.InputError[error]}`);
    throw new Error("Failed to get action set handle");
}
if (actionSetHandlePTR === null) throw new Error("Invalid pointer");
const actionSetHandle = new Deno.UnsafePointerView(actionSetHandlePTR).getBigUint64();

let handPoseLeftHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
const handPoseLeftHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();
let handPoseRightHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
const handPoseRightHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();
//#endregion

//#region button

let triggerLeftHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
let triggerRightHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
const triggerLeftHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();
const triggerRightHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();

error = vrInput.GetActionHandle("/actions/main/in/TriggerLeft", triggerLeftHandlePTR);
if (error !== OpenVR.InputError.VRInputError_None) {
    console.error(`Failed to get left trigger action handle: ${OpenVR.InputError[error]}`);
    throw new Error("Failed to get left trigger action handle");
}
if (triggerLeftHandlePTR === null) throw new Error("Invalid pointer");
triggerLeftHandle = new Deno.UnsafePointerView(triggerLeftHandlePTR).getBigUint64();

const triggerDataSize = OpenVR.InputDigitalActionDataStruct.byteSize;
const triggerDataBufferL = new ArrayBuffer(triggerDataSize);
const triggerDataBufferR = new ArrayBuffer(triggerDataSize);
const triggerDataViewL = new DataView(triggerDataBufferL);
const triggerDataViewR = new DataView(triggerDataBufferR);
const triggerLeftPointer = Deno.UnsafePointer.of<OpenVR.InputDigitalActionData>(triggerDataBufferL)!;
const triggerRightPointer = Deno.UnsafePointer.of<OpenVR.InputDigitalActionData>(triggerDataBufferR)!;


//#endregion

function main() {
    //Postman.functions?.RTC?.(null, state.id);



    let _
    let leftPoseData
    let rightPoseData




    //set action manifest path
    error = vrInput.SetActionManifestPath(manifestPath);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to set action manifest path: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to set action manifest path");
    }

    //get action set handle



    //#region Get action handles



    error = vrInput.GetActionHandle("/actions/main/in/HandPoseLeft", handPoseLeftHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get action handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get action handle");
    }
    if (handPoseLeftHandlePTR === null) throw new Error("Invalid pointer");
    handPoseLeftHandle = new Deno.UnsafePointerView(handPoseLeftHandlePTR).getBigUint64();
    console.log("handPoseLeftHandle:", handPoseLeftHandle);

    error = vrInput.GetActionHandle("/actions/main/in/HandPoseRight", handPoseRightHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get action handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get action handle");
    }
    if (handPoseRightHandlePTR === null) throw new Error("Invalid pointer");
    handPoseRightHandle = new Deno.UnsafePointerView(handPoseRightHandlePTR).getBigUint64();

    console.log(handPoseLeftHandle, handPoseRightHandle);


    let triggerLeftHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
    let triggerRightHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
    const triggerLeftHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();
    const triggerRightHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();

    error = vrInput.GetActionHandle("/actions/main/in/TriggerLeft", triggerLeftHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get left trigger action handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get left trigger action handle");
    }
    if (triggerLeftHandlePTR === null) throw new Error("Invalid pointer");
    triggerLeftHandle = new Deno.UnsafePointerView(triggerLeftHandlePTR).getBigUint64();

    error = vrInput.GetActionHandle("/actions/main/in/TriggerRight", triggerRightHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get right trigger action handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get right trigger action handle");
    }
    if (triggerRightHandlePTR === null) throw new Error("Invalid pointer");
    triggerRightHandle = new Deno.UnsafePointerView(triggerRightHandlePTR).getBigUint64();



    //#endregion



    //#endregion

}


function updateActionState() {
    const activeActionSet: OpenVR.ActiveActionSet = {
        ulActionSet: actionSetHandle,
        ulRestrictedToDevice: OpenVR.k_ulInvalidInputValueHandle,
        ulSecondaryActionSet: 0n,
        unPadding: 0,
        nPriority: 0
    };
    const activeActionSetSize = OpenVR.ActiveActionSetStruct.byteSize;
    const activeActionSetBuffer = new ArrayBuffer(activeActionSetSize);
    const activeActionSetView = new DataView(activeActionSetBuffer);
    const activeActionSetPtr = Deno.UnsafePointer.of<OpenVR.ActiveActionSet>(activeActionSetBuffer)!;

    OpenVR.ActiveActionSetStruct.write(activeActionSet, activeActionSetView)

    error = vrInput.UpdateActionState(activeActionSetPtr, activeActionSetSize, 1);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to update action state: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to update action state");
    }
}


new Postman(worker, functions, state);

OnMessage((message) => {
    Postman.runFunctions(message);
});
import * as OpenVR from "./openvr_bindings.ts";
import { fillBuffer, readBufferStructured } from "../utils.ts";
import { P } from "../pointers.ts";
import { Struct, calculateTotalSize, SizedStruct, ArrayType, u8, i8, u16, i16, u32, i32, f32, u64, i64, f64 } from "../byte_type/mod.ts";

const manifestPath = Deno.realPathSync("./test/actions.json");

function stringToPointer(str: string): Deno.PointerValue {
    const encoder = new TextEncoder();
    const view = encoder.encode(str + '\0');
    return Deno.UnsafePointer.of(view);
}

async function main() {
    //#region structures
    const EmptyPoseData: OpenVR.InputPoseActionData = {
        bActive: false,
        activeOrigin: 0n,
        pose: {
            mDeviceToAbsoluteTracking: {
                m: [
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0]
                ]
            },
            vVelocity: { v: [0, 0, 0] },
            vAngularVelocity: { v: [0, 0, 0] },
            eTrackingResult: 1,
            bPoseIsValid: false,
            bDeviceIsConnected: false
        }
    }
    const EmptyDigitalActionData: OpenVR.InputDigitalActionData = {
        bActive: false,
        activeOrigin: 0n,
        bState: false,
        bChanged: false,
        fUpdateTime: 0.0
    };


    //#endregion

    //#region init

    let _
    let leftPoseData
    let rightPoseData
    let error;


    const initerrorptr = Deno.UnsafePointer.of<OpenVR.InitError>(new Int32Array(1))!
    const TypeSafeINITERRPTR: OpenVR.InitErrorPTRType = initerrorptr


    const errorX = Deno.UnsafePointer.of(new Int32Array(1))!;
    OpenVR.VR_InitInternal(errorX, OpenVR.ApplicationType.VRApplication_Overlay);
    let a = new Deno.UnsafePointerView(errorX).getInt32();
    console.log(a)


    const overlayPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVROverlay_Version), TypeSafeINITERRPTR);
    a = new Deno.UnsafePointerView(TypeSafeINITERRPTR).getInt32();
    console.log(a)

    //const IVRPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVRSystem_Version), TypeSafeINITERRPTR);
    a = new Deno.UnsafePointerView(TypeSafeINITERRPTR).getInt32();
    console.log(a)
    const IVRInputPtr = OpenVR.VR_GetGenericInterface(stringToPointer(OpenVR.IVRInput_Version), TypeSafeINITERRPTR);
    a = new Deno.UnsafePointerView(TypeSafeINITERRPTR).getInt32();
    console.log(a)

    const overlay = new OpenVR.IVROverlay(overlayPtr);
    //const vrSystem = new OpenVR.IVRSystem(IVRPtr);
    const vrInput = new OpenVR.IVRInput(IVRInputPtr);
    //#endregion


    //#region controller setup


    //set action manifest path
    error = vrInput.SetActionManifestPath(manifestPath);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to set action manifest path: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to set action manifest path");
    }

    //get action set handle
    const actionSetHandlePTR = P.BigUint64P<OpenVR.ActionSetHandle>();
    error = vrInput.GetActionSetHandle("/actions/main", actionSetHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get action set handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get action set handle");
    }
    if (actionSetHandlePTR === null) throw new Error("Invalid pointer");
    const actionSetHandle = new Deno.UnsafePointerView(actionSetHandlePTR).getBigUint64();


    //#region Get action handles
    let handPoseLeftHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
    const handPoseLeftHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();
    let handPoseRightHandle: OpenVR.ActionHandle = OpenVR.k_ulInvalidActionHandle;
    const handPoseRightHandlePTR = P.BigUint64P<OpenVR.ActionHandle>();



    error = vrInput.GetActionHandle("/actions/main/in/HandPoseLeft", handPoseLeftHandlePTR);
    if (error !== OpenVR.InputError.VRInputError_None) {
        console.error(`Failed to get action handle: ${OpenVR.InputError[error]}`);
        throw new Error("Failed to get action handle");
    }
    if (handPoseLeftHandlePTR === null) throw new Error("Invalid pointer");
    handPoseLeftHandle = new Deno.UnsafePointerView(handPoseLeftHandlePTR).getBigUint64();

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

    //overlayhandle
    const overlayHandlePTR = P.BigUint64P<OpenVR.OverlayHandle>();
    error = overlay.CreateOverlay("image", "image", overlayHandlePTR);
    const overlayHandle = new Deno.UnsafePointerView(overlayHandlePTR).getBigUint64();


    console.log(`Overlay created with handle: ${overlayHandle}`);

    const imgpath = Deno.realPathSync("./test/PetPlay.png");
    overlay.SetOverlayFromFile(overlayHandle, imgpath);
    overlay.SetOverlayWidthInMeters(overlayHandle, 0.1);
    overlay.ShowOverlay(overlayHandle);

    const initialTransform: OpenVR.HmdMatrix34 = {
        m: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, -2.0]
        ]
    };
    const initialTransformPTR = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(new Float32Array(initialTransform.m.flat()));
    overlay.SetOverlayTransformAbsolute(overlayHandle, OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding, initialTransformPTR);

    console.log("Overlay created and shown. Press Ctrl+C to exit.");

    const activeActionSet: OpenVR.ActiveActionSet = {
        ulActionSet: actionSetHandle,
        ulRestrictedToDevice: OpenVR.k_ulInvalidInputValueHandle,
        ulSecondaryActionSet: 0n,
        unPadding: 0, //uint32
        nPriority: 0  //int32
    };

    //#region Main loop

    //init pose LR
    const poseDataSize = OpenVR.InputPoseActionDataStruct.byteSize;
    const bufferL = new ArrayBuffer(poseDataSize);
    const bufferR = new ArrayBuffer(poseDataSize);
    const poseDataViewL = new DataView(bufferL);
    const poseDataViewR = new DataView(bufferR);
    const posedataleftpointer = Deno.UnsafePointer.of<OpenVR.InputPoseActionData>(bufferL)!;
    const posedatarightpointer = Deno.UnsafePointer.of<OpenVR.InputPoseActionData>(bufferR)!;


    //init trigger LR
    const triggerDataSize = OpenVR.InputDigitalActionDataStruct.byteSize;
    const triggerDataBufferL = new ArrayBuffer(triggerDataSize);
    const triggerDataBufferR = new ArrayBuffer(triggerDataSize);
    const triggerDataViewL = new DataView(triggerDataBufferL);
    const triggerDataViewR = new DataView(triggerDataBufferR);
    const triggerLeftPointer = Deno.UnsafePointer.of<OpenVR.InputDigitalActionData>(triggerDataBufferL)!;
    const triggerRightPointer = Deno.UnsafePointer.of<OpenVR.InputDigitalActionData>(triggerDataBufferR)!;


    while (true) {


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

        error = vrInput.GetPoseActionDataRelativeToNow(
            handPoseRightHandle,
            OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding,
            0,
            posedatarightpointer,
            96,
            OpenVR.k_ulInvalidInputValueHandle
        );
        if (error === OpenVR.InputError.VRInputError_None) {
            rightPoseData = OpenVR.InputPoseActionDataStruct.read(poseDataViewR);

        }



        error = vrInput.GetDigitalActionData(
            triggerLeftHandle,
            triggerLeftPointer,
            24,
            OpenVR.k_ulInvalidInputValueHandle
        );
        const leftTriggerData = OpenVR.InputDigitalActionDataStruct.read(triggerDataViewL);
        
        error = vrInput.GetDigitalActionData(
            triggerRightHandle,
            triggerRightPointer,
            24,
            OpenVR.k_ulInvalidInputValueHandle
        );
        const rightTriggerData = OpenVR.InputDigitalActionDataStruct.read(triggerDataViewR);


        //update overlay pos if trigger is pressed
        if (error === OpenVR.InputError.VRInputError_None) {


            // Move the overlay if the trigger is pressed
            if (leftTriggerData.bState || rightTriggerData.bState) {
                const activeHandPose = leftTriggerData.bState ? leftPoseData : rightPoseData;
                if (!activeHandPose) throw new Error("Invalid pose data");
                if (activeHandPose.bActive && activeHandPose.pose.bPoseIsValid) {
                    const newTransform = activeHandPose.pose.mDeviceToAbsoluteTracking;
                    const newTransformPtr = Deno.UnsafePointer.of<OpenVR.HmdMatrix34>(new Float32Array(newTransform.m.flat()));
                    overlay.SetOverlayTransformAbsolute(overlayHandle, OpenVR.TrackingUniverseOrigin.TrackingUniverseStanding, newTransformPtr);
                }
            }
        }

        await new Promise(resolve => setTimeout(resolve, 2));
    }
}

main().catch(console.error);
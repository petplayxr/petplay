//====== Copyright Valve Corporation, All rights reserved. =======


#include "overlay.h"
#include <openvr.h>
#include <map>
#include <iostream>
#include <filesystem>  // Make sure this is correctly included

namespace fs = std::filesystem;
using namespace vr;

OverlayInterface *s_pSharedVRController = NULL;

OverlayInterface *OverlayInterface::SharedInstance()
{
	if ( !s_pSharedVRController )
	{
        s_pSharedVRController = new OverlayInterface();
	}
	return s_pSharedVRController;
}

OverlayInterface::OverlayInterface()
	: m_strVRDriver( "No Driver" )
	, m_strVRDisplay( "No Display" )
    , m_eLastHmdError( vr::VRInitError_None )
    , m_eCompositorError( vr::VRInitError_None )
    , m_eOverlayError( vr::VRInitError_None )
	, m_ulOverlayHandle( vr::k_ulOverlayHandleInvalid )
	, m_pWidget( NULL )
{
}

OverlayInterface::~OverlayInterface() 
{
}


std::string GetTrackedDeviceString(vr::IVRSystem *pHmd, vr::TrackedDeviceIndex_t unDevice, vr::TrackedDeviceProperty prop)
{
	char buf[128];
	vr::TrackedPropertyError err;
	pHmd->GetStringTrackedDeviceProperty( unDevice, prop, buf, sizeof( buf ), &err );
	if (err != vr::TrackedProp_Success)
	{
		return std::string("Error Getting String: ") + pHmd->GetPropErrorNameFromEnum(err);
	}
	else
	{
		return buf;
	}
}


vr::VROverlayHandle_t OverlayInterface::Init()
{
	bool bSuccess = true;

    m_strName = "systemoverlay";

    bSuccess = ConnectToVRRuntime();

    bSuccess = bSuccess && vr::VRCompositor() != NULL;

    if( vr::VROverlay() )
	{
       // vr::VROverlayHandle_t m_ulOverlayThumbnailHandle;

        std::string sKey = std::string( "sample." ) + m_strName;
        vr::VROverlayError overlayError = vr::VROverlay()->CreateOverlay( sKey.c_str(), m_strName.c_str(), &m_ulOverlayHandle );
		bSuccess = bSuccess && overlayError == vr::VROverlayError_None;
	}

	if ( bSuccess )
    {
        vr::VROverlay()->SetOverlayWidthInMeters(m_ulOverlayHandle, 0.2f);
		vr::VROverlay()->SetOverlayInputMethod(m_ulOverlayHandle, vr::VROverlayInputMethod_Mouse);
        /* vr::VROverlay()->SetOverlayColor(m_ulOverlayHandle, 1.0f, 0.0f, 1.0f); */


        std::string relativePath = "../resources/PetPlay.png";
        try {
            fs::path absolutePath = fs::absolute(relativePath);

            if (fs::exists(absolutePath)) {
                std::cout << "Absolute path: " << absolutePath << std::endl;
                // Correct usage of SetOverlayFromFile if it takes two arguments
                vr::VROverlay()->SetOverlayFromFile(m_ulOverlayHandle, absolutePath.string().c_str());
            } else {
                std::cout << "File not found at: " << absolutePath << std::endl;
            }
        } catch (const fs::filesystem_error& e) {
            std::cerr << "Filesystem error: " << e.what() << std::endl;
        } catch (const std::exception& e) {
            std::cerr << "General error: " << e.what() << std::endl;
        }


        HmdMatrix34_t transformMatrix;
		//vr::VROverlay()->ShowKeyboardForOverlay(m_ulOverlayHandle, vr::EGamepadTextInputMode::k_EGamepadTextInputModeNormal, vr::EGamepadTextInputLineMode::k_EGamepadTextInputLineModeSingleLine);

        // Set the values of the matrix to represent your desired transformation
        // For example, to set the matrix to the identity matrix (no transformation)
        transformMatrix.m[0][0] = 1.0f; transformMatrix.m[0][1] = 0.0f; transformMatrix.m[0][2] = 0.0f; transformMatrix.m[0][3] = 0.0f;
        transformMatrix.m[1][0] = 0.0f; transformMatrix.m[1][1] = 1.0f; transformMatrix.m[1][2] = 0.0f; transformMatrix.m[1][3] = 0.0f;
        transformMatrix.m[2][0] = 0.0f; transformMatrix.m[2][1] = 0.0f; transformMatrix.m[2][2] = 1.0f; transformMatrix.m[2][3] = 0.0f;
        vr::VROverlay()->SetOverlayTransformTrackedDeviceRelative(m_ulOverlayHandle, vr::TrackedControllerRole_LeftHand, &transformMatrix);
        vr::VROverlay()->ShowOverlay(m_ulOverlayHandle);
	}
	return m_ulOverlayHandle;
}

/** Get the transform in 3d space associated with a specific 2d point in the overlay's coordinate space (where 0,0 is the lower left). -Z points out of the overlay */
/* 		virtual EVROverlayError GetTransformForOverlayCoordinates( VROverlayHandle_t ulOverlayHandle, ETrackingUniverseOrigin eTrackingOrigin, HmdVector2_t coordinatesInOverlay, HmdMatrix34_t *pmatTransform ) = 0; */
/* struct HmdMatrix34_t
{
	float m[3][4];
}; */


vr::HmdMatrix34_t OverlayInterface::GetOverlayPos(VROverlayHandle_t m_ulOverlayHandle, HmdVector2_t *m_vOverlayPosition)
{
    HmdMatrix34_t matTransform;
    vr::ETrackingUniverseOrigin eTrackingOrigin = vr::ETrackingUniverseOrigin::TrackingUniverseStanding;
    vr::EVROverlayError error = vr::VROverlay()->GetTransformForOverlayCoordinates(m_ulOverlayHandle, eTrackingOrigin, *m_vOverlayPosition, &matTransform);

    if (error != vr::VROverlayError_None) {
        // Handle error
    }

    return matTransform;
}

void OverlayInterface::SetOverlayPositionToController(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex) {
    vr::HmdVector3_t controllerPosition = GetGrippingControllerPosition(pVRSystem, overlayHandle, controllerIndex).position;

    // Create a transformation matrix for the new position
    vr::HmdMatrix34_t transformMatrix;
    transformMatrix.m[0][0] = 1.0f; transformMatrix.m[0][1] = 0.0f; transformMatrix.m[0][2] = 0.0f; transformMatrix.m[0][3] = controllerPosition.v[0];
    transformMatrix.m[1][0] = 0.0f; transformMatrix.m[1][1] = 1.0f; transformMatrix.m[1][2] = 0.0f; transformMatrix.m[1][3] = controllerPosition.v[1];
    transformMatrix.m[2][0] = 0.0f; transformMatrix.m[2][1] = 0.0f; transformMatrix.m[2][2] = 1.0f; transformMatrix.m[2][3] = controllerPosition.v[2];

    // Set the overlay's position relative to the controller
    vr::VROverlay()->SetOverlayTransformTrackedDeviceRelative(overlayHandle, controllerIndex, &transformMatrix);
}

void OverlayInterface::UpdateButtonState(vr::IVRSystem* pVRSystem, vr::TrackedDeviceIndex_t controllerIndex, vr::EVRButtonId buttonId) {
    vr::VRControllerState_t controllerState;
    if (pVRSystem->GetControllerState(controllerIndex, &controllerState, sizeof(controllerState))) {
        bool isPressed = controllerState.ulButtonPressed & vr::ButtonMaskFromId(buttonId);
        ButtonState& state = buttonStates[controllerIndex][buttonId];
        state.wasPressed = state.isPressed;
        state.isPressed = isPressed;
    }
}

void OverlayInterface::HandleVRInput(vr::IVRSystem* pVRSystem, VROverlayHandle_t pOverlayToCheckFor) {
    vr::TrackedDeviceIndex_t controller1 = GetControllerIndexes(pVRSystem, pOverlayToCheckFor)[0];
	vr::TrackedDeviceIndex_t controller2 = GetControllerIndexes(pVRSystem, pOverlayToCheckFor)[1];
    // Update the state for each button
    UpdateButtonState(pVRSystem, controller1, vr::k_EButton_SteamVR_Trigger);
    UpdateButtonState(pVRSystem, controller1, vr::k_EButton_Grip);
	UpdateButtonState(pVRSystem, controller2, vr::k_EButton_SteamVR_Trigger);
    UpdateButtonState(pVRSystem, controller2, vr::k_EButton_Grip);

	OverlayInterface::ButtonState controller1ButtonState = buttonStates[controller1][vr::k_EButton_Grip];
	OverlayInterface::ButtonState controller2ButtonState = buttonStates[controller2][vr::k_EButton_Grip];

    if ((!controller1ButtonState.wasPressed && controller1ButtonState.isPressed) 
	|| (!controller2ButtonState.wasPressed && controller2ButtonState.isPressed)) {
        printf("Grip button pressed!\n");
		if (IsGrippingOverlay(pVRSystem, pOverlayToCheckFor, controller1) && !isGripped) {
			isGripped = true;
			currentControllerGrippingOverlay = controller1;
			printf("Controller1 Gripped Overlay!\n");
			return;
		}
		else if(IsGrippingOverlay(pVRSystem, pOverlayToCheckFor, controller2) && !isGripped) {
			isGripped = true;
			currentControllerGrippingOverlay = controller2;
			printf("Controller2 Gripped Overlay!\n");
			return;
		}
    }

    if ((controller1ButtonState.wasPressed && !controller1ButtonState.isPressed) 
	&& (controller2ButtonState.wasPressed && !controller2ButtonState.isPressed)) {
        printf("Grip button released!\n");
		if (isGripped) {
			isGripped = false;
			currentControllerGrippingOverlay = NULL;
		}
    }
}

bool OverlayInterface::IsGrippingOverlay(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex) {
    // Get the controller's pose
    vr::TrackedDevicePose_t controllerPose;
    pVRSystem->GetDeviceToAbsoluteTrackingPose(vr::TrackingUniverseStanding, 0, &controllerPose, 1);

    // Check if the controller is valid
    if (!controllerPose.bPoseIsValid) {
        return false;
    }

    // Convert the controller's pose to a matrix
    vr::HmdMatrix34_t controllerMatrix = controllerPose.mDeviceToAbsoluteTracking;

    // Project a ray from the controller
    vr::HmdVector3_t rayOrigin = {controllerMatrix.m[0][3], controllerMatrix.m[1][3], controllerMatrix.m[2][3]};
    vr::HmdVector3_t rayDirection = {0, 0, -1}; // Assuming the controller is pointing forward

    // Check for intersection with the overlay
    vr::VROverlayIntersectionParams_t params;
    params.eOrigin = vr::TrackingUniverseStanding;
    params.vSource.v[0] = rayOrigin.v[0];
    params.vSource.v[1] = rayOrigin.v[1];
    params.vSource.v[2] = rayOrigin.v[2];
    params.vDirection.v[0] = rayDirection.v[0];
    params.vDirection.v[1] = rayDirection.v[1];
    params.vDirection.v[2] = rayDirection.v[2];

    vr::VROverlayIntersectionResults_t results;

    // If the intersection was successful, the controller is gripping the overlay
    return vr::VROverlay()->ComputeOverlayIntersection(overlayHandle, &params, &results);
}

std::map<int, vr::TrackedDeviceIndex_t> OverlayInterface::GetControllerIndexes(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle) {
	int counter = 0;
    for (vr::TrackedDeviceIndex_t unDevice = 0; unDevice < vr::k_unMaxTrackedDeviceCount; ++unDevice) {
        if (!pVRSystem->IsTrackedDeviceConnected(unDevice)) continue;

        // Check if the device is a controller
        if (pVRSystem->GetTrackedDeviceClass(unDevice) == vr::TrackedDeviceClass_Controller) {
			controllerIndexes[counter] = unDevice;
			counter++;
        }
    }
	return controllerIndexes;
}

OverlayInterface::ControllerPosition OverlayInterface::GetGrippingControllerPosition(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex) {
    ControllerPosition result = {false, {0, 0, 0}};

    // Check if the controller is gripping the overlay
    if (IsGrippingOverlay(pVRSystem, overlayHandle, controllerIndex)) {
        // Get the controller's pose
        vr::TrackedDevicePose_t controllerPose;
        pVRSystem->GetDeviceToAbsoluteTrackingPose(vr::TrackingUniverseStanding, 0, &controllerPose, 1);

        // Check if the controller is valid
        if (controllerPose.bPoseIsValid) {
            // Convert the controller's pose to a matrix
            vr::HmdMatrix34_t controllerMatrix = controllerPose.mDeviceToAbsoluteTracking;

            // Extract the position from the matrix
            result.position.v[0] = controllerMatrix.m[0][3];
            result.position.v[1] = controllerMatrix.m[1][3];
            result.position.v[2] = controllerMatrix.m[2][3];

            result.isGripping = true;
        }
    }

    return result;
}


void OverlayInterface::Shutdown()
{
	DisconnectFromVRRuntime();

	/* delete m_pScene;
	delete m_pFbo;
	delete m_pOffscreenSurface;

	if( m_pOpenGLContext )
	{
		m_pOpenGLContext->destroy();
		delete m_pOpenGLContext;
		m_pOpenGLContext = NULL;
	} */
}

bool OverlayInterface::ConnectToVRRuntime()
{
    m_eLastHmdError = vr::VRInitError_None;
    vr::IVRSystem *pVRSystem = vr::VR_Init( &m_eLastHmdError, vr::VRApplication_Overlay );
    

    if ( m_eLastHmdError != vr::VRInitError_None )
	{
		m_strVRDriver = "No Driver";
		m_strVRDisplay = "No Display";
		return false;
	}
    std::string GetTrackedDeviceString(vr::IVRSystem *pHmd, vr::TrackedDeviceIndex_t unDevice, vr::TrackedDeviceProperty prop);
    m_strVRDriver = GetTrackedDeviceString(pVRSystem, vr::k_unTrackedDeviceIndex_Hmd, vr::Prop_TrackingSystemName_String);
    m_strVRDisplay = GetTrackedDeviceString(pVRSystem, vr::k_unTrackedDeviceIndex_Hmd, vr::Prop_SerialNumber_String);

	return true;
}

void OverlayInterface::DisconnectFromVRRuntime()
{
	vr::VR_Shutdown();
}

std::string OverlayInterface::GetVRDriverString()
{
	return m_strVRDriver;
}

std::string OverlayInterface::GetVRDisplayString()
{
	return m_strVRDisplay;
}

bool OverlayInterface::BHMDAvailable()
{
    return vr::VRSystem() != NULL;
}

vr::HmdError OverlayInterface::GetLastHmdError()
{
	return m_eLastHmdError;
}



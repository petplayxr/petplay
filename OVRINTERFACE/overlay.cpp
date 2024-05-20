//====== Copyright Valve Corporation, All rights reserved. =======


#include "overlay.h"
#include <openvr.h>
#include <map>
#include <iostream>
#include <filesystem>  // Make sure this is correctly included
#include <sstream>
#include <string>

namespace fs = std::filesystem;
using namespace vr;

#pragma region init

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

#pragma endregion

vr::VROverlayHandle_t OverlayInterface::CreateInteractiveOverlay(const std::string& overlayName)
{
	bool bSuccess = true;

    m_strName = overlayName;

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
        vr::VROverlay()->SetOverlayTransformAbsolute(m_ulOverlayHandle, vr::TrackingUniverseStanding, &transformMatrix);
        vr::VROverlay()->ShowOverlay(m_ulOverlayHandle);
	}
	return m_ulOverlayHandle;
}

vr::VROverlayHandle_t OverlayInterface::CreateAlignmentOverlay(bool mode)
{
    if (mode) {
        std::cout << "p1" << std::endl;
    } else {
        std::cout << "p2" << std::endl;
    }
	bool bSuccess = true;

    m_strName = "alignmentoverlay";

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

        std::string relativePath = "";

        if (mode) {
            relativePath = "../resources/P1.png";
        } else {
            relativePath = "../resources/P2.png";
        }
        


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

        // ALIGNMENT MATRIX
        transformMatrix.m[0][0] = 1.0f; transformMatrix.m[0][1] = 0.0f; transformMatrix.m[0][2] = 0.0f; transformMatrix.m[0][3] = 0.0f;
        transformMatrix.m[1][0] = 0.0f; transformMatrix.m[1][1] = 0.0f; transformMatrix.m[1][2] = 0.0f; transformMatrix.m[1][3] = 0.0f;
        transformMatrix.m[2][0] = 0.0f; transformMatrix.m[2][1] = -1.0f; transformMatrix.m[2][2] = 1.0f; transformMatrix.m[2][3] = 0.0f;
        vr::VROverlay()->SetOverlayTransformAbsolute(m_ulOverlayHandle, vr::TrackingUniverseStanding, &transformMatrix);
        vr::VROverlay()->ShowOverlay(m_ulOverlayHandle);
	}
	return m_ulOverlayHandle;
}

vr::VROverlayHandle_t OverlayInterface::CreateBasicOverlay(const std::string& overlayName, const std::string& texpath )
{
	bool bSuccess = true;

    m_strName = overlayName;

    bSuccess = ConnectToVRRuntime();

    bSuccess = bSuccess && vr::VRCompositor() != NULL;

    // Create the overlay
    if( vr::VROverlay() )
	{
       // vr::VROverlayHandle_t m_ulOverlayThumbnailHandle;

        std::string sKey = std::string( "sample." ) + m_strName;
        vr::VROverlayError overlayError = vr::VROverlay()->CreateOverlay( sKey.c_str(), m_strName.c_str(), &m_ulOverlayHandle );
		bSuccess = bSuccess && overlayError == vr::VROverlayError_None;
	}
    // if successful, set overlay properties
	if ( bSuccess )
    {
        vr::VROverlay()->SetOverlayWidthInMeters(m_ulOverlayHandle, 0.2f);
		vr::VROverlay()->SetOverlayInputMethod(m_ulOverlayHandle, vr::VROverlayInputMethod_Mouse);
        /* vr::VROverlay()->SetOverlayColor(m_ulOverlayHandle, 1.0f, 0.0f, 1.0f); */



        fs::path absolutePath = texpath;

        if (fs::exists(absolutePath)) {
            vr::VROverlay()->SetOverlayFromFile(m_ulOverlayHandle, absolutePath.string().c_str());
        } else {
            std::cerr << "File not found at: " << absolutePath << std::endl;
        }


        HmdMatrix34_t transformMatrix;
		
        // Set the values of the matrix to represent your desired transformation
        // For example, to set the matrix to the identity matrix (no transformation)
        transformMatrix.m[0][0] = 1.0f; transformMatrix.m[0][1] = 0.0f; transformMatrix.m[0][2] = 0.0f; transformMatrix.m[0][3] = 0.0f;
        transformMatrix.m[1][0] = 0.0f; transformMatrix.m[1][1] = 1.0f; transformMatrix.m[1][2] = 0.0f; transformMatrix.m[1][3] = 0.0f;
        transformMatrix.m[2][0] = 0.0f; transformMatrix.m[2][1] = 0.0f; transformMatrix.m[2][2] = 1.0f; transformMatrix.m[2][3] = 0.0f;
        vr::VROverlay()->SetOverlayTransformAbsolute(m_ulOverlayHandle, vr::TrackingUniverseStanding, &transformMatrix);
        vr::VROverlay()->ShowOverlay(m_ulOverlayHandle);
	}
	return m_ulOverlayHandle;
}


#pragma region helpers

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

#pragma endregion

#pragma region overlay movement

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
    bool isIntersecting = vr::VROverlay()->ComputeOverlayIntersection(overlayHandle, &params, &results);
    if (!isIntersecting) {
        // Calculate the distance from the controller's ray to the overlay
        float distanceToOverlay = CalculateDistanceToOverlay(rayOrigin, rayDirection, overlayHandle);
        std::cout << "Missed overlay by: " << distanceToOverlay << " units" << std::endl;

        // Check if the distance is within the threshold for a successful grab
        float threshold = 0.8f; // Set the threshold value
        if (distanceToOverlay < threshold) {
            return true; // Consider it a successful grab if the distance is less than the threshold
        }
    }

    return isIntersecting;
}

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

void LogHMDAndControllersPositions(vr::IVRSystem* pVRSystem) {
    // Define the tracking universe origin
    vr::ETrackingUniverseOrigin eTrackingOrigin = vr::TrackingUniverseStanding;

    // Define the prediction time (0 for the most current data)
    float fPredictionTime = 0.0f;

    // Allocate an array to hold the poses
    vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount];

    // Get the poses for all devices
    pVRSystem->GetDeviceToAbsoluteTrackingPose(eTrackingOrigin, fPredictionTime, poses, vr::k_unMaxTrackedDeviceCount);

    // Iterate through all tracked devices
    for (vr::TrackedDeviceIndex_t unDevice = 0; unDevice < vr::k_unMaxTrackedDeviceCount; ++unDevice) {
        // Check if the device is connected
        if (!pVRSystem->IsTrackedDeviceConnected(unDevice)) continue;

        // Get the device class
        vr::ETrackedDeviceClass deviceClass = pVRSystem->GetTrackedDeviceClass(unDevice);

        // Initialize a string to hold the device type
        std::string deviceType = "Unknown";

        // Check if the device is an HMD, left controller, or right controller
        if (deviceClass == vr::TrackedDeviceClass_HMD) {
            deviceType = "HMD";
        } else if (deviceClass == vr::TrackedDeviceClass_Controller) {
            // Check if it's the left or right controller
            vr::ETrackedControllerRole role = pVRSystem->GetControllerRoleForTrackedDeviceIndex(unDevice);
            if (role == vr::TrackedControllerRole_LeftHand) {
                deviceType = "Left Controller";
            } else if (role == vr::TrackedControllerRole_RightHand) {
                deviceType = "Right Controller";
            }
        }

        // Get the pose for the device
        vr::TrackedDevicePose_t& pose = poses[unDevice];

        // Check if the pose is valid
        if (pose.bPoseIsValid) {
            // Extract the position from the pose
            vr::HmdVector3_t position = {pose.mDeviceToAbsoluteTracking.m[0][3], pose.mDeviceToAbsoluteTracking.m[1][3], pose.mDeviceToAbsoluteTracking.m[2][3]};

            // Log the position with the device type
            //std::cout << deviceType << " Position: (" << position.v[0] << ", " << position.v[1] << ", " << position.v[2] << ")" << std::endl;
        }
    }
}

void OverlayInterface::SetOverlayPosition(vr::VROverlayHandle_t overlayHandle, vr::HmdMatrix34_t overlayPosition) {

    //overlayPosition.m[0][3] *= -1;

    // Set the overlay's transform to the controller's transform
    vr::VROverlay()->SetOverlayTransformAbsolute(overlayHandle, vr::TrackingUniverseStanding, &overlayPosition);
}

void OverlayInterface::SetOverlayPositionToController(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex) {
    LogHMDAndControllersPositions(pVRSystem); // Log all device positions (for debugging purposes)
    
    std::cout << "Controller device id : " << controllerIndex << std::endl;

    // Allocate an array of TrackedDevicePose_t to hold the poses
    vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount];

    // Get the poses for all devices
    pVRSystem->GetDeviceToAbsoluteTrackingPose(vr::TrackingUniverseStanding, 0, poses, vr::k_unMaxTrackedDeviceCount);

    // Check if the controller is valid
    if (!poses[controllerIndex].bPoseIsValid) {
        return; // Exit the function if the controller's pose is not valid
    }

    // Convert the controller's pose to a matrix
    vr::HmdMatrix34_t transformMatrix = poses[controllerIndex].mDeviceToAbsoluteTracking;

    // Set the overlay's transform to the controller's transform
    vr::VROverlay()->SetOverlayTransformAbsolute(overlayHandle, vr::TrackingUniverseStanding, &transformMatrix);
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
    // Define the tracking universe origin
    vr::ETrackingUniverseOrigin eTrackingOrigin = vr::ETrackingUniverseOrigin::TrackingUniverseStanding;

    // Define the prediction time (0 for the most current data)
    float fPredictionTime = 0.0f;

    // Allocate an array to hold the poses
    vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount];

    // Get the poses for all devices
    pVRSystem->GetDeviceToAbsoluteTrackingPose(eTrackingOrigin, fPredictionTime, poses, vr::k_unMaxTrackedDeviceCount);

    vr::TrackedDeviceIndex_t leftControllerIndex = vr::k_unTrackedDeviceIndexInvalid;
    vr::TrackedDeviceIndex_t rightControllerIndex = vr::k_unTrackedDeviceIndexInvalid;

    // Iterate through all tracked devices to find the left and right controllers
    for (vr::TrackedDeviceIndex_t unDevice = 0; unDevice < vr::k_unMaxTrackedDeviceCount; ++unDevice) {
        // Check if the device is connected
        if (!pVRSystem->IsTrackedDeviceConnected(unDevice)) continue;

        // Get the device class
        vr::ETrackedDeviceClass deviceClass = pVRSystem->GetTrackedDeviceClass(unDevice);

        // Check if the device is a controller
        if (deviceClass == vr::TrackedDeviceClass_Controller) {
            // Check if it's the left or right controller
            vr::ETrackedControllerRole role = pVRSystem->GetControllerRoleForTrackedDeviceIndex(unDevice);
            if (role == vr::TrackedControllerRole_LeftHand) {
                leftControllerIndex = unDevice;
            } else if (role == vr::TrackedControllerRole_RightHand) {
                rightControllerIndex = unDevice;
            }
        }
    }

    // Update the state for each button
    UpdateButtonState(pVRSystem, leftControllerIndex, vr::k_EButton_Grip);
    UpdateButtonState(pVRSystem, rightControllerIndex, vr::k_EButton_Grip);

    OverlayInterface::ButtonState leftControllerButtonState = buttonStates[leftControllerIndex][vr::k_EButton_Grip];
    OverlayInterface::ButtonState rightControllerButtonState = buttonStates[rightControllerIndex][vr::k_EButton_Grip];

    if (leftControllerButtonState.isPressed)
    {
        printf("Grip button is held!\n");
        if (IsControllerCloseToOverlay(pVRSystem, pOverlayToCheckFor, leftControllerIndex) && !isGripped) {
            isGripped = true;
            currentControllerGrippingOverlay = leftControllerIndex;
            printf("Left Controller Gripped Overlay!\n");
            return;
        }
        
    }
    if (rightControllerButtonState.isPressed)
    {
        printf("Grip button is held!\n");
        if(IsControllerCloseToOverlay(pVRSystem, pOverlayToCheckFor, rightControllerIndex) && !isGripped) {
            isGripped = true;
            currentControllerGrippingOverlay = rightControllerIndex;
            printf("Right Controller Gripped Overlay!\n");
            return;
        }
    }

    if ((!leftControllerButtonState.isPressed) 
    && (!rightControllerButtonState.isPressed)) {
        
        if (isGripped) {
            isGripped = false;
            currentControllerGrippingOverlay = vr::k_unTrackedDeviceIndexInvalid; // Reset to invalid index
        }
    }
}

float OverlayInterface::CalculateDistanceToOverlay(const vr::HmdVector3_t& rayOrigin, const vr::HmdVector3_t& rayDirection, vr::VROverlayHandle_t overlayHandle) {

    if (overlayHandle != vr::k_ulOverlayHandleInvalid) {
    vr::HmdMatrix34_t overlayMatrix;
    vr::ETrackingUniverseOrigin trackingUniverseOrigin = vr::TrackingUniverseStanding;
    vr::EVROverlayError error = vr::VROverlay()->GetOverlayTransformAbsolute(overlayHandle, &trackingUniverseOrigin, &overlayMatrix);
    if (error != vr::VROverlayError_None) {
        std::cerr << "Error getting overlay transform: " << error << std::endl;
        return -1.0f; // Return an error value
    }
        // Proceed with the rest of your code to calculate the distance
    } else {
        std::cerr << "Invalid overlay handle" << std::endl;
        return -1.0f; // Return an error value
    }

    // Assuming the overlay is flat and oriented along the Z-axis
    vr::HmdVector3_t overlayNormal = {0, 0, 1}; // Normal vector of the overlay (assuming it's flat and oriented along the Z-axis)

    // Get the overlay's transformation matrix
    vr::HmdMatrix34_t overlayMatrix;
    vr::ETrackingUniverseOrigin trackingUniverseOrigin = vr::TrackingUniverseStanding;
    vr::EVROverlayError error = vr::VROverlay()->GetOverlayTransformAbsolute(overlayHandle, &trackingUniverseOrigin, &overlayMatrix);
    if (error != vr::VROverlayError_None) {
        std::cerr << "Error getting overlay transform: " << error << std::endl;
        return -1.0f; // Return an error value
    }

    // Calculate the overlay's center
    vr::HmdVector3_t overlayCenter = {overlayMatrix.m[0][3], overlayMatrix.m[1][3], overlayMatrix.m[2][3]}; // Corrected calculation

    // Calculate the distance from the ray origin to the overlay
    vr::HmdVector3_t pointToPlane = {overlayCenter.v[0] - rayOrigin.v[0], overlayCenter.v[1] - rayOrigin.v[1], overlayCenter.v[2] - rayOrigin.v[2]};
    float distance = std::abs(pointToPlane.v[0] * overlayNormal.v[0] + pointToPlane.v[1] * overlayNormal.v[1] + pointToPlane.v[2] * overlayNormal.v[2]) / std::sqrt(overlayNormal.v[0] * overlayNormal.v[0] + overlayNormal.v[1] * overlayNormal.v[1] + overlayNormal.v[2] * overlayNormal.v[2]);

    return distance;
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
            // Directly extract the position from the pose
            result.position.v[0] = controllerPose.mDeviceToAbsoluteTracking.m[0][3];
            result.position.v[1] = controllerPose.mDeviceToAbsoluteTracking.m[1][3];
            result.position.v[2] = controllerPose.mDeviceToAbsoluteTracking.m[2][3];

            result.isGripping = true;
        }
    }

    return result;
}

bool OverlayInterface::IsControllerCloseToOverlay(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex) {
    vr::HmdVector3_t controllerPosition = GetGrippingControllerPosition(pVRSystem, overlayHandle, controllerIndex).position;
    vr::HmdMatrix34_t overlayMatrix;
    vr::ETrackingUniverseOrigin trackingUniverseOrigin = vr::TrackingUniverseStanding;
    vr::EVROverlayError error = vr::VROverlay()->GetOverlayTransformAbsolute(overlayHandle, &trackingUniverseOrigin, &overlayMatrix);
    if (error != vr::VROverlayError_None) {
        std::cerr << "Error getting overlay transform: " << error << std::endl;
        return false; // Return false if there's an error
    }

    // Calculate the overlay's center
    vr::HmdVector3_t overlayCenter = {overlayMatrix.m[0][3], overlayMatrix.m[1][3], overlayMatrix.m[2][3]};

    // Calculate the distance from the controller to the overlay
    float distance = static_cast<float>(std::sqrt(std::pow(controllerPosition.v[0] - overlayCenter.v[0], 2) + std::pow(controllerPosition.v[1] - overlayCenter.v[1], 2) + std::pow(controllerPosition.v[2] - overlayCenter.v[2], 2)));

    // Check if the distance is within the threshold for a successful grab
    float threshold = 0.8f; // Set the threshold value
    return distance < threshold;
}

#pragma endregion overlay movement

#pragma region overlay networking

vr::HmdMatrix34_t OverlayInterface::GetOverlayPositionAbsolute(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle) {
    vr::HmdMatrix34_t transformMatrix;
    vr::ETrackingUniverseOrigin trackingOrigin;


    vr::EVROverlayError error = vr::VROverlay()->GetOverlayTransformAbsolute(overlayHandle, &trackingOrigin, &transformMatrix);
    if (error != vr::VROverlayError_None) {
        std::cerr << "Error getting overlay transform in absolute terms: " << error << std::endl;
        // Initialize the matrix to identity if there is an error
        transformMatrix.m[0][0] = 1.0f; transformMatrix.m[0][1] = 0.0f; transformMatrix.m[0][2] = 0.0f; transformMatrix.m[0][3] = 0.0f;
        transformMatrix.m[1][0] = 0.0f; transformMatrix.m[1][1] = 1.0f; transformMatrix.m[1][2] = 0.0f; transformMatrix.m[1][3] = 0.0f;
        transformMatrix.m[2][0] = 0.0f; transformMatrix.m[2][1] = 0.0f; transformMatrix.m[2][2] = 1.0f; transformMatrix.m[2][3] = 0.0f;
    }

    return transformMatrix;
}

vr::HmdVector3_t OverlayInterface::GetHMDPositionRelativeToTrackingUniverseOrigin(vr::IVRSystem* pVRSystem) {
    // Define the tracking universe origin
    vr::ETrackingUniverseOrigin eTrackingOrigin = vr::ETrackingUniverseOrigin::TrackingUniverseStanding;

    // Define the prediction time (0 for the most current data)
    float fPredictionTime = 0.0f;

    // Allocate an array to hold the poses
    vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount];

    // Get the poses for all devices
    pVRSystem->GetDeviceToAbsoluteTrackingPose(eTrackingOrigin, fPredictionTime, poses, vr::k_unMaxTrackedDeviceCount);

    // Get the HMD index
    vr::TrackedDeviceIndex_t hmdIndex = vr::k_unTrackedDeviceIndex_Hmd;

    // Check if the HMD is valid
    if (!pVRSystem->IsTrackedDeviceConnected(hmdIndex)) {
        std::cerr << "HMD not connected." << std::endl;
        return {0, 0, 0}; // Return a zero vector if the HMD is not connected
    }

    // Get the pose for the HMD
    vr::TrackedDevicePose_t& hmdPose = poses[hmdIndex];

    // Check if the pose is valid
    if (!hmdPose.bPoseIsValid) {
        std::cerr << "HMD pose not valid." << std::endl;
        return {0, 0, 0}; // Return a zero vector if the pose is not valid
    }

    // Extract the position from the pose
    vr::HmdVector3_t position = {hmdPose.mDeviceToAbsoluteTracking.m[0][3], hmdPose.mDeviceToAbsoluteTracking.m[1][3], hmdPose.mDeviceToAbsoluteTracking.m[2][3]};

    return position;
}

std::string OverlayInterface::serializePositions(const vr::HmdMatrix34_t& overlayPosition, const vr::HmdVector3_t& hmdPosition) {
    std::stringstream ss;
    // Serialize overlay position
    for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 4; ++j) {
            ss << overlayPosition.m[i][j] << " ";
        }
    }
    // Serialize HMD position
    for (int i = 0; i < 3; ++i) {
        ss << hmdPosition.v[i] << " ";
    }
    return ss.str();
}

#pragma endregion 

#pragma region init stuff

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

#pragma endregion

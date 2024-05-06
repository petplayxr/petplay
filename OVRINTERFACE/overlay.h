//====== Copyright Valve Corporation, All rights reserved. =======

#ifndef OPENVROVERLAYCONTROLLER_H
#define OPENVROVERLAYCONTROLLER_H

#ifdef _WIN32
#pragma once
#endif

#include "openvr.h"
#include <map>

class OverlayInterface
{


public:
    static OverlayInterface *SharedInstance();
    

public:
    struct ButtonState {
        bool isPressed;
        bool wasPressed;
    };

    bool IsControllerCloseToOverlay(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex);


    struct ControllerPosition {
        bool isGripping;
        vr::HmdVector3_t position;
    };

    ControllerPosition GetGrippingControllerPosition(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex);


    float CalculateDistanceToOverlay(const vr::HmdVector3_t& rayOrigin, const vr::HmdVector3_t& rayDirection, vr::VROverlayHandle_t overlayHandle);

    
    
    bool isGripped = false;
    // Map to store the state of each button
    std::map<int, vr::TrackedDeviceIndex_t> controllerIndexes;
    std::map<vr::TrackedDeviceIndex_t, std::map<vr::EVRButtonId, ButtonState>> buttonStates;

    vr::TrackedDeviceIndex_t currentControllerGrippingOverlay = NULL;

    OverlayInterface();
	virtual ~OverlayInterface();
    
    vr::HmdMatrix34_t GetOverlayPos(vr::VROverlayHandle_t m_ulOverlayHandle, vr::HmdVector2_t *m_vOverlayPosition);
    void SetOverlayPositionToController(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex);

    vr::VROverlayHandle_t Init();
    
	void Shutdown();
	void EnableRestart();
    bool BHMDAvailable();
    void UpdateButtonState(vr::IVRSystem* pVRSystem, vr::TrackedDeviceIndex_t controllerIndex, vr::EVRButtonId buttonId);
    void HandleVRInput(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t pOverlayToCheckFor);
    bool IsGrippingOverlay(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle, vr::TrackedDeviceIndex_t controllerIndex);
    std::map<int, vr::TrackedDeviceIndex_t> GetControllerIndexes(vr::IVRSystem* pVRSystem, vr::VROverlayHandle_t overlayHandle);
    vr::IVRSystem* GetVRSystem();
    vr::HmdError GetLastHmdError();

    std::string GetVRDriverString();
    std::string GetVRDisplayString();
    std::string GetName() { return m_strName; }

    void SetWidget(void* pWidget); 
    

protected:

private:
    bool ConnectToVRRuntime();
    void DisconnectFromVRRuntime();

    vr::TrackedDevicePose_t m_rTrackedDevicePose[vr::k_unMaxTrackedDeviceCount];
    std::string m_strVRDriver;
    std::string m_strVRDisplay;
    std::string m_strName;

    vr::HmdError m_eLastHmdError;

private:
    vr::HmdError m_eCompositorError;
	vr::HmdError m_eOverlayError;
	vr::VROverlayHandle_t m_ulOverlayHandle;
    vr::VROverlayHandle_t m_ulOverlayThumbnailHandle;

    void* m_pWidget; // Changed to void* for generality
};


#endif // OPENVROVERLAYCONTROLLER_H

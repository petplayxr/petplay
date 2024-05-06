#include <iostream>
#include <vector>
#include <string>
#include <openvr.h>
#include <overlay.h>
#include <windows.h>

using namespace std;

class overlay {
    // Existing class definition remains unchanged
};

int main() {
    #pragma region Test
    vector<string> msg {"ARF!", "C++"};

    for (const string& word : msg) {
        cout << word << " ";
    }
    cout << endl;
    #pragma endregion


    #pragma region initvr
    vr::IVRSystem *system = nullptr;
    vr::EVRInitError error = vr::VRInitError_None;
    system = vr::VR_Init(&error, vr::VRApplication_Overlay);
    if (error != vr::VRInitError_None) {
        cout << "Error: " << vr::VR_GetVRInitErrorAsEnglishDescription(error) << endl;
        return 1; // Exit if VR initialization fails
    }

    // Loop until HMD is present
    while (!vr::VR_IsHmdPresent()) {
        cout << "Waiting for HMD..." << endl;
        Sleep(1000); // Wait for 1 second before checking again
    }
    cout << "HMD is present" << endl;
    #pragma endregion

    #pragma region overlay
    OverlayInterface overlayInterface;
    
    //overlayInterface.SetWidget(new QWidget());
    vr::VROverlayHandle_t m_ulOverlayHandle = overlayInterface.Init();
    if (m_ulOverlayHandle) {
        cout << "Overlay initialized" << endl;
    } else {
        cout << "Overlay initialization failed" << endl;
        return 1; // Exit if overlay initialization fails
    }

    vr::HmdVector2_t overlayPosition = {0.0f, 0.0f}; // Initialize overlay position
    while (true) {
        overlayInterface.HandleVRInput(system, m_ulOverlayHandle);
        if (overlayInterface.isGripped) {
            overlayInterface.SetOverlayPositionToController(system, m_ulOverlayHandle, overlayInterface.currentControllerGrippingOverlay);
        }
        vr::HmdMatrix34_t overlayTransform = overlayInterface.GetOverlayPos(m_ulOverlayHandle, &overlayPosition);
        // Extract position from the overlayTransform matrix
        vr::HmdVector3_t position = {overlayTransform.m[0][3], overlayTransform.m[1][3], overlayTransform.m[2][3]};
        cout << "Overlay position: " << position.v[0] << ", " << position.v[1] << ", " << position.v[2] << endl;
        // Add a delay or condition to break the loop if needed
        Sleep(1);
    }

    #pragma endregion

    // Keep the program running until a specific condition is met
    // For example, wait for user input to exit
    cout << "Press any key to exit..." << endl;
    cin.get();

    // Cleanup
    // Uncomment and implement as necessary
    // vr::VR_Shutdown();

    return 0;
}

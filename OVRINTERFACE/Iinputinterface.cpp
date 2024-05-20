#include <iostream>
#include <winsock2.h>
#include <openvr.h>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
#include <thread>
#include "WebSocketServer.h"

#pragma comment(lib, "Ws2_32.lib")

using namespace std;




std::string LogHMDAndControllersPositions(vr::IVRSystem* pVRSystem) {
    vr::ETrackingUniverseOrigin eTrackingOrigin = vr::TrackingUniverseStanding;
    float fPredictionTime = 0.0f;
    vr::TrackedDevicePose_t poses[vr::k_unMaxTrackedDeviceCount];
    pVRSystem->GetDeviceToAbsoluteTrackingPose(eTrackingOrigin, fPredictionTime, poses, vr::k_unMaxTrackedDeviceCount);

    std::ostringstream outputStream;

    for (vr::TrackedDeviceIndex_t unDevice = 0; unDevice < vr::k_unMaxTrackedDeviceCount; ++unDevice) {
        if (!pVRSystem->IsTrackedDeviceConnected(unDevice)) continue;
        vr::ETrackedDeviceClass deviceClass = pVRSystem->GetTrackedDeviceClass(unDevice);
        std::string deviceType = "Unknown";

        if (deviceClass == vr::TrackedDeviceClass_HMD) {
            deviceType = "HMD";
        } else if (deviceClass == vr::TrackedDeviceClass_Controller) {
            vr::ETrackedControllerRole role = pVRSystem->GetControllerRoleForTrackedDeviceIndex(unDevice);
            if (role == vr::TrackedControllerRole_LeftHand) {
                deviceType = "Left Controller";
            } else if (role == vr::TrackedControllerRole_RightHand) {
                deviceType = "Right Controller";
            }
        }

        vr::TrackedDevicePose_t& pose = poses[unDevice];

        if (pose.bPoseIsValid) {
            vr::HmdVector3_t position = {
                pose.mDeviceToAbsoluteTracking.m[0][3],
                pose.mDeviceToAbsoluteTracking.m[1][3],
                pose.mDeviceToAbsoluteTracking.m[2][3]
            };
            outputStream << deviceType << " Position: (" << position.v[0] << ", " << position.v[1] << ", " << position.v[2] << ")\n";
        }

        if (deviceClass == vr::TrackedDeviceClass_Controller) {
            vr::VRControllerState_t state;
            if (pVRSystem->GetControllerState(unDevice, &state, sizeof(state))) {
                outputStream << deviceType << " Button States: ";
                for (int i = 0; i < vr::k_EButton_Max; ++i) {
                    if (state.ulButtonPressed & vr::ButtonMaskFromId((vr::EVRButtonId)i)) {
                        outputStream << "Button " << i << " pressed, ";
                    }
                }
                outputStream << "\n";
            }
        }
    }

    return outputStream.str();
}


int main(int argc, char* argv[]) {
    if (argc < 2) {
        cerr << "Usage: " << argv[0] << " <port>" << endl;
        return 1;
    }

    int port = stoi(argv[1]);
    WebSocketServer server(port);

    if (!server.Initialize() || !server.AcceptConnection()) {
        return 1;
    }

    vr::IVRSystem* system = nullptr;
    vr::EVRInitError error = vr::VRInitError_None;
    system = vr::VR_Init(&error, vr::VRApplication_Background);
    if (error != vr::VRInitError_None) {
        cout << "Error: " << vr::VR_GetVRInitErrorAsEnglishDescription(error) << endl;
        server.Cleanup();
        return 1;
    }

    while (true) {
        string trackingData = LogHMDAndControllersPositions(system);
        server.SendData(trackingData);
        std::this_thread::sleep_for(std::chrono::milliseconds(100)); // Sleep for 100 milliseconds
    }

    vr::VR_Shutdown();
    server.Cleanup();
    return 0;
}

#include <iostream>
#include <winsock2.h>
#include <vector>
#include <string>
#include <openvr.h>
#include <overlay.h>
#include <windows.h>
#include <ws2tcpip.h>
#include <sstream>
#include <cmath>
#include <chrono>
#include "WebSocketServer.h"

#pragma comment(lib, "Ws2_32.lib")


using namespace std;


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
    system = vr::VR_Init(&error, vr::VRApplication_Overlay);
    if (error != vr::VRInitError_None) {
        cout << "Error: " << vr::VR_GetVRInitErrorAsEnglishDescription(error) << endl;
        server.Cleanup();
        return 1;
    }
    OverlayInterface overlayInterface;
    vr::VROverlayHandle_t overlayHandle = vr::k_ulOverlayHandleInvalid;

    while (true) {
        char buffer[1024];
        int bytesRead = server.ReceiveData(buffer, sizeof(buffer) - 1);
        if (bytesRead <= 0) {
            break;
        }

        buffer[bytesRead] = '\0';
        string receivedData(buffer, bytesRead);

        string function;
        string overlayName;
        string pathToTexture;

        string matrix;

        istringstream iss(receivedData);
        getline(iss, function, ';');
        
        stringstream response;

        if (function == "CreateBasicOverlay") {
            getline(iss, overlayName, ';');
            getline(iss, pathToTexture, ';');

            overlayHandle = overlayInterface.CreateBasicOverlay(overlayName, pathToTexture);

            vr::HmdMatrix34_t overlayPositionNET = overlayInterface.GetOverlayPositionAbsolute(system, overlayHandle);
            vr::HmdVector3_t hmdPosition = overlayInterface.GetHMDPositionRelativeToTrackingUniverseOrigin(system);
            std::string serializedPositions = overlayInterface.serializePositions(overlayPositionNET, hmdPosition);

            response << "status=success;message=Overlay created successfully;overlayHandle=" << static_cast<uint64_t>(overlayHandle) << ";";
            response << serializedPositions;
            
            server.SendData(response.str());
        }

        if (function == "SetOverlayPosition") {
            response << "overlaymove!" << ";";
            response << "overlayHandle=" << static_cast<uint64_t>(overlayHandle) << ";";
            getline(iss, matrix, ';');
            std::istringstream iss(matrix);
            std::vector<float> matrixElements;
            float num;
            int count = 0;
            while (iss >> num && count < 12) {  // Read only the first 12 elements
                matrixElements.push_back(num);
                response << num<< " ";
                count++;
            }
            if (matrixElements.size() == 12) { // Ensure we have exactly 12 elements (3x4 matrix)

                vr::HmdMatrix34_t transformMatrix;
                transformMatrix.m[0][0] = matrixElements[0];
                transformMatrix.m[0][1] = matrixElements[1];
                transformMatrix.m[0][2] = matrixElements[2];
                transformMatrix.m[0][3] = matrixElements[3];
                transformMatrix.m[1][0] = matrixElements[4];
                transformMatrix.m[1][1] = matrixElements[5];
                transformMatrix.m[1][2] = matrixElements[6];
                transformMatrix.m[1][3] = matrixElements[7];
                transformMatrix.m[2][0] = matrixElements[8];
                transformMatrix.m[2][1] = matrixElements[9];
                transformMatrix.m[2][2] = matrixElements[10];
                transformMatrix.m[2][3] = matrixElements[11];
                
                overlayInterface.SetOverlayPosition(overlayHandle, transformMatrix);

                server.SendData(response.str());
            }
            
            else {
                cerr << "Drastic change detected, update skipped." << endl;
            }
        }  
    }

    cout << "close" << endl;
    server.Cleanup();
    cout << "Press any key to exit..." << endl;
    cin.get();
    return 0;
}
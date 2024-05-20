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

        istringstream iss(receivedData);
        getline(iss, function, ';');
        getline(iss, overlayName, ';');
        getline(iss, pathToTexture, ';');

        if (function == "CreateBasicOverlay") {
            vr::VROverlayHandle_t m_ulOverlayHandle = overlayInterface.CreateBasicOverlay(overlayName, pathToTexture);

            stringstream response;
            response << "status=success;message=Overlay created successfully;overlayHandle=" << static_cast<uint64_t>(m_ulOverlayHandle) << ";";

            server.SendData(response.str());
        }
    }

    cout << "close" << endl;
    server.Cleanup();
    cout << "Press any key to exit..." << endl;
    cin.get();
    return 0;
}
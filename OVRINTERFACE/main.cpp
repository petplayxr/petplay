#include <iostream>
#include <winsock2.h>
#include <vector>
#include <string>
#include <openvr.h>
#include <overlay.h>
#include <windows.h>
#include <ws2tcpip.h>

#pragma comment(lib, "Ws2_32.lib")

using namespace std;

class overlay {
    // Existing class definition remains unchanged
};

void sendPositions(const std::string& serializedData) {
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);

    SOCKET ConnectSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (ConnectSocket == INVALID_SOCKET) {
        std::cerr << "Error at socket(): " << WSAGetLastError() << std::endl;
        WSACleanup();
        return;
    }

    sockaddr_in clientService;
    clientService.sin_family = AF_INET;
    inet_pton(AF_INET, "127.0.0.1", &(clientService.sin_addr)); 
    clientService.sin_port = htons(27015); // Port number

    if (connect(ConnectSocket, (SOCKADDR*)&clientService, sizeof(clientService)) == SOCKET_ERROR) {
        std::cerr << "Failed to connect: " << WSAGetLastError() << std::endl;
        closesocket(ConnectSocket);
        WSACleanup();
        return;
    }

    // Send the serialized data
    send(ConnectSocket, serializedData.c_str(), static_cast<int>(serializedData.size()), 0);

    closesocket(ConnectSocket);
    WSACleanup();
}

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

   // Example usage of GetOverlayPositionRelativeToHMD
    vr::HmdMatrix34_t overlayPositionNET = overlayInterface.GetOverlayPositionRelativeToHMD(system, m_ulOverlayHandle);

    // Example usage of GetHMDPositionRelativeToTrackingUniverseOrigin
    vr::HmdVector3_t hmdPosition = overlayInterface.GetHMDPositionRelativeToTrackingUniverseOrigin(system);

    // Example usage of serializePositions
    std::string serializedPositions = overlayInterface.serializePositions(overlayPositionNET, hmdPosition);

    // Send the serialized data
    sendPositions(serializedPositions);

    while (true) {

        #pragma region overlay

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
        #pragma endregion

        


    }



    #pragma endregion

    #pragma region socket
    // Initialize Winsock
    WSADATA wsaData;
    int iResult = WSAStartup(MAKEWORD(2, 2), &wsaData);
    if (iResult != 0) {
        std::cerr << "WSAStartup failed: " << iResult << std::endl;
        return 1;
    }

    // Create a socket
    SOCKET ListenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (ListenSocket == INVALID_SOCKET) {
        std::cerr << "Error at socket(): " << WSAGetLastError() << std::endl;
        WSACleanup();
        return 1;
    }

    // Bind the socket
    sockaddr_in service;
    service.sin_family = AF_INET;
    service.sin_addr.s_addr = INADDR_ANY;
    service.sin_port = htons(27015); // Port number

    if (bind(ListenSocket, (SOCKADDR*)&service, sizeof(service)) == SOCKET_ERROR) {
        std::cerr << "bind failed with error: " << WSAGetLastError() << std::endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }

    // Listen on the socket
    if (listen(ListenSocket, 1) == SOCKET_ERROR) {
        std::cerr << "listen failed with error: " << WSAGetLastError() << std::endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }

    // Accept a client connection
    SOCKET ClientSocket;
    ClientSocket = accept(ListenSocket, NULL, NULL);
    if (ClientSocket == INVALID_SOCKET) {
        std::cerr << "accept failed with error: " << WSAGetLastError() << std::endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }
    #pragma endregion

    #pragma region END
    // Cleanup
    closesocket(ClientSocket);
    closesocket(ListenSocket);
    WSACleanup();

    // Keep the program running until a specific condition is met
    // For example, wait for user input to exit
    cout << "Press any key to exit..." << endl;
    cin.get();

    // Cleanup
    // Uncomment and implement as necessary
    // vr::VR_Shutdown();

    return 0;
    #pragma endregion
}

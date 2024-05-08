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

void sendPositions(SOCKET socket, const std::string& serializedData) {
    int sendResult = send(socket, serializedData.c_str(), serializedData.size(), 0);
    if (sendResult == SOCKET_ERROR) {
        cerr << "send failed with error: " << WSAGetLastError() << endl;
    }
}

// Function to receive data from the client
void receiveData(SOCKET socket) {
    char recvbuf[512];
    int recvbuflen = 512;
    int iResult;

    iResult = recv(socket, recvbuf, recvbuflen, 0);
    if (iResult > 0) {
        recvbuf[iResult] = '\0'; // Null-terminate the buffer to make it a valid string
        //cout << "Received data: " << recvbuf << endl;
    } else if (iResult == 0) {
        cout << "Connection closing..." << endl;
    } else {
        cerr << "recv failed with error: " << WSAGetLastError() << endl;
    }
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


    #pragma region socket

    WSADATA wsaData;
    int iResult = WSAStartup(MAKEWORD(2, 2), &wsaData);
    if (iResult != 0) {
        cerr << "WSAStartup failed: " << iResult << endl;
        return 1;
    }

    SOCKET ListenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (ListenSocket == INVALID_SOCKET) {
        cerr << "Error at socket(): " << WSAGetLastError() << endl;
        WSACleanup();
        return 1;
    }

    sockaddr_in service;
    service.sin_family = AF_INET;
    service.sin_addr.s_addr = INADDR_ANY;
    service.sin_port = htons(27015);

    if (bind(ListenSocket, (SOCKADDR*)&service, sizeof(service)) == SOCKET_ERROR) {
        cerr << "bind failed with error: " << WSAGetLastError() << endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }

    if (listen(ListenSocket, 1) == SOCKET_ERROR) {
        cerr << "listen failed with error: " << WSAGetLastError() << endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }

    SOCKET ClientSocket = accept(ListenSocket, NULL, NULL);
    if (ClientSocket == INVALID_SOCKET) {
        cerr << "accept failed with error: " << WSAGetLastError() << endl;
        closesocket(ListenSocket);
        WSACleanup();
        return 1;
    }

    #pragma endregion


    #pragma region overlay

    #pragma region create interactive overlay
    OverlayInterface overlayInterface;
    vr::VROverlayHandle_t m_ulOverlayHandle = overlayInterface.CreateInteractiveOverlay();
    if (m_ulOverlayHandle) {
        cout << "Overlay initialized" << endl;
    } else {
        cout << "Overlay initialization failed" << endl;
        return 1; // Exit if overlay initialization fails
    }
    vr::HmdVector2_t overlayPosition = {0.0f, 0.0f}; // Initialize overlay position
    #pragma endregion

    #pragma region create alignment overlay
    OverlayInterface overlayInterface2;
    vr::VROverlayHandle_t m_ulOverlayHandle2 = overlayInterface2.CreateAlignmentOverlay();
    if (m_ulOverlayHandle2) {
        cout << "ALIGN initialized" << endl;
    } else {
        cout << "Overlay initialization failed" << endl;
        return 1; // Exit if overlay initialization fails
    }

    vr::HmdVector2_t overlayPosition2 = {0.0f, 0.0f}; // Initialize overlay position
    #pragma endregion

    while (true) {

        #pragma region overlay

        overlayInterface.HandleVRInput(system, m_ulOverlayHandle);
        if (overlayInterface.isGripped) {
            overlayInterface.SetOverlayPositionToController(system, m_ulOverlayHandle, overlayInterface.currentControllerGrippingOverlay);
        }
        vr::HmdMatrix34_t overlayTransform = overlayInterface.GetOverlayPos(m_ulOverlayHandle, &overlayPosition);
        // Extract position from the overlayTransform matrix
        vr::HmdVector3_t position = {overlayTransform.m[0][3], overlayTransform.m[1][3], overlayTransform.m[2][3]};

        //cout << "Overlay position: " << position.v[0] << ", " << position.v[1] << ", " << position.v[2] << endl;
        // Add a delay or condition to break the loop if needed
        Sleep(5);

        
        #pragma endregion




        #pragma region do networking

        vr::HmdMatrix34_t overlayPositionNET = overlayInterface.GetOverlayPositionAbsolute(system, m_ulOverlayHandle);
        // Example usage of GetHMDPositionRelativeToTrackingUniverseOrigin
        vr::HmdVector3_t hmdPosition = overlayInterface.GetHMDPositionRelativeToTrackingUniverseOrigin(system);
        // Example usage of serializePositions
        std::string serializedPositions = overlayInterface.serializePositions(overlayPositionNET, hmdPosition);
        // Send the serialized data
        //cout << "Sending serialized data: " << serializedPositions << endl;
        sendPositions(ClientSocket, serializedPositions);
        receiveData(ClientSocket);
        #pragma endregion

        
        // Add a delay or condition to break the loop if needed
        Sleep(100);
        

        


    }



    #pragma endregion

    

    #pragma region END

    cout << "close" << endl;

    WSACleanup();

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

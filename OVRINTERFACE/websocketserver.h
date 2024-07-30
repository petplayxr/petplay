#include <iostream>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <string>

#pragma comment(lib, "Ws2_32.lib")

class WebSocketServer
{
public:
    WebSocketServer(int port) : port(port), ListenSocket(INVALID_SOCKET), ClientSocket(INVALID_SOCKET) {}

    ~WebSocketServer()
    {
        Cleanup();
    }

    bool Initialize()
    {
        WSADATA wsaData;
        int iResult = WSAStartup(MAKEWORD(2, 2), &wsaData);
        if (iResult != 0)
        {
            std::cerr << "WSAStartup failed: " << iResult << std::endl;
            return false;
        }

        ListenSocket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (ListenSocket == INVALID_SOCKET)
        {
            std::cerr << "Error at socket(): " << WSAGetLastError() << std::endl;
            WSACleanup();
            return false;
        }

        sockaddr_in service;
        service.sin_family = AF_INET;
        service.sin_addr.s_addr = INADDR_ANY;
        service.sin_port = htons(port);

        if (bind(ListenSocket, (SOCKADDR *)&service, sizeof(service)) == SOCKET_ERROR)
        {
            std::cerr << "bind failed with error: " << WSAGetLastError() << std::endl;
            closesocket(ListenSocket);
            WSACleanup();
            return false;
        }

        if (listen(ListenSocket, 1) == SOCKET_ERROR)
        {
            std::cerr << "listen failed with error: " << WSAGetLastError() << std::endl;
            closesocket(ListenSocket);
            WSACleanup();
            return false;
        }

        std::cout << "Waiting for client to connect on port " << port << "..." << std::endl;
        return true;
    }

    bool AcceptConnection()
    {
        ClientSocket = accept(ListenSocket, NULL, NULL);
        if (ClientSocket == INVALID_SOCKET)
        {
            std::cerr << "accept failed with error: " << WSAGetLastError() << std::endl;
            closesocket(ListenSocket);
            WSACleanup();
            return false;
        }

        std::cout << "IPC connection established successfully." << std::endl;
        return true;
    }

    int ReceiveData(char *buffer, int bufferSize)
    {
        int bytesRead = recv(ClientSocket, buffer, bufferSize, 0);
        if (bytesRead == SOCKET_ERROR)
        {
            std::cerr << "recv failed with error: " << WSAGetLastError() << std::endl;
        }
        return bytesRead;
    }

    void SendData(const std::string &data)
    {
        uint32_t length = data.size();
        std::string message = ":L:" + std::to_string(length) + ":D:" + data;
        send(ClientSocket, message.c_str(), message.length(), 0);
    }

    void Cleanup()
    {
        if (ClientSocket != INVALID_SOCKET)
        {
            closesocket(ClientSocket);
        }
        if (ListenSocket != INVALID_SOCKET)
        {
            closesocket(ListenSocket);
        }
        WSACleanup();
    }

private:
    int port;
    SOCKET ListenSocket;
    SOCKET ClientSocket;
};

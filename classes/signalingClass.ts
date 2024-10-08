// deno_server.ts
import { CustomLogger } from "../classes/customlogger.ts";

export class SignalingServer {
  private clients = new Map();

  constructor(private port: number) { }

  start() {
    this.startSignalingServer();
  }
  // SERVER
  private startSignalingServer() {
    Deno.serve({ hostname: "0.0.0.0", port: this.port }, (req) => {
      if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
      }

      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.addEventListener("open", () => {
        CustomLogger.log("class", "Signaling client connected!");
        this.clients.set(socket, {});
      });

      socket.addEventListener("close", () => {
        CustomLogger.log("class", "WebSocket connection closed");
        this.clients.delete(socket);
      });

      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.type !== "candidate") {
          CustomLogger.log("class", "Signaling server received data:", data.type);
        }

        this.handleWebSocketMessage(socket, data);
      });

      socket.addEventListener("close", () => {
        CustomLogger.log("class", "Signaling client disconnected");
      });

      return response;
    });
    CustomLogger.log("class",
      `Signaling server is running on ws://localhost:${this.port}`,
    );
  }

  private handleWebSocketMessage = (socket: WebSocket, message: unknown) => {
    this.broadcastMessage(socket, message);
  };

  private broadcastMessage = (senderSocket: WebSocket, message: unknown) => {
    this.clients.forEach((_, socket) => {
      if (socket !== senderSocket && socket.readyState === WebSocket.OPEN) {
        //throw new Error(`${JSON.stringify(message)}`);
        socket.send(JSON.stringify(message));
      }
    });
  };
}

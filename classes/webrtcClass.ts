import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";

export class WebRTCServer {
  private nodeSocket: WebSocket | null = null;

  private ipcPort: number;
  private ddnsIp: string;
  private id: string;
  private ipcSockets: Map<string, WebSocket> = new Map();

  constructor(id: string, ipcPort: number) {
    this.ipcPort = ipcPort;
    this.ddnsIp = "";
    this.id = id;
  }

  private async getddnsIP(): Promise<string> {
    const publicIp = await getIP();
    const resolved = await Deno.resolveDns("petplay.ddns.net", "A", {
      nameServer: { ipAddr: "8.8.8.8", port: 53 },
    });
    if (publicIp == resolved) {
      return "ws://192.168.1.178:8081";
    } else {
      return "ws://petplay.ddns.net:8081";
    }
  }

  async start() {
    this.ddnsIp = await this.getddnsIP();
    await this.startNodeProcesses();
    this.startIPCServer();
    const sock = await this.createWebSocket(this.ipcPort);
    return sock;
  }

  private async startNodeProcesses() {
    await this.startNodeProcess(this.id);
  }

  private createWebSocket(ipcPort: number) {
    return new WebSocket(`ws://localhost:${ipcPort}`);
  }
  private startNodeProcess(id: string) {
    const command = new Deno.Command("node", {
      args: [
        "-e",
        `require('child_process').execSync('npx ts-node nodeWebRTC/webrtc.ts ${id} ${this.ipcPort} ${this.ddnsIp}', {stdio: 'inherit'})`,
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const nodeProcess = command.spawn();

    const decoder = new TextDecoder();
    const output = nodeProcess.stdout.getReader();
    const errorOutput = nodeProcess.stderr.getReader();

    const readStream = async (
      stream: ReadableStreamDefaultReader<Uint8Array>,
    ) => {
      while (true) {
        const { value, done } = await stream.read();
        if (done) break;
        const decodedValue = decoder.decode(value);
        const lines = decodedValue.split("\n");
        const nonEmptyLines = lines.filter((line) => line.trim() !== "");
        const idPartBeforeAt = id.split("@")[0];
        const prefixedLines = nonEmptyLines.map((line) =>
          `[RTC NODE: ${idPartBeforeAt}]: ${line}`
        );
        const formattedOutput = prefixedLines.join("\n");
        console.log(formattedOutput);
      }
    };

    readStream(output);
    readStream(errorOutput);
  }
  private startIPCServer() {
    Deno.serve({ port: this.ipcPort }, (req) => {
      if (req.headers.get("upgrade") != "websocket") {
        return new Response(null, { status: 501 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);

      socket.addEventListener("open", () => {
        console.log("IPC client connected!");
      });

      socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);

        console.log("msg from ipc", data);
        if (data.peerIdSet) {
          if (data.peerIdSet === this.id) {
            this.nodeSocket = socket;
          }
        } else if (data.type === "portalSet") {
          this.ipcSockets.set(data.payload, socket);
        } else if (data.type === "query_dataPeersReturn") {
          if (typeof data.rtcmessage === "boolean") {
            try {
              this.ipcSockets.get(data.targetPeerId)?.send(JSON.stringify({
                type: "query_dataPeers",
                rtcmessage: data.rtcmessage,
              }));
            } catch (e) {
              console.log("error sending query_dataPeers", e);
            }
            console.log("sent query_dataPeers");
          }
          else {
            console.error("unknown query_dataPeersReturn type", data);
          }
        } else if (data.type === "webrtc_message_custom") {
          console.log("received custom webrtc message");
          /* console.log("xx",this.ipcSockets);
          console.log("xx",data); */
          const rtcmessage = JSON.parse(data.rtcmessage);
          const { address: { to } } = rtcmessage;
          console.log("to", to);

          if (this.ipcSockets.has(to)) {
            console.log("sending webrtc message to ipc socket");
            this.ipcSockets.get(to)?.send(JSON.stringify(data));
          }
        } else {
          console.log("sending webrtc message to node socket");
          this.nodeSocket?.send(JSON.stringify(data));
        }
      });

      return response;
    });
    console.log(`IPC server is running on ws://localhost:${this.ipcPort}`);
  }
}

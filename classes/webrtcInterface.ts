import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";
import {wait } from "../actorsystem/utils.ts";

export class WebRTCInterface {
  private nodeSocket: WebSocket | null = null;
  private ipcPort: number;
  private ddnsIp: string;
  private id: string;
  private messageHandler: ((data: any) => void) | null = null;
  private channel: string | null = null;
  private addressBook: Set<string> = new Set();

  constructor(id: string, ipcPort: number) {
    this.ipcPort = ipcPort;
    this.ddnsIp = "";
    this.id = id;
  }
  async start() {
    this.ddnsIp = await this.getddnsIP();
    await this.startNodeProcess();
    return this.startIPCServer();
  }

  public onMessage(handler: (data: any) => void) {
    this.messageHandler = handler;
  }

  //#region channel

  public isSocketOpen(): boolean {
    return this.nodeSocket !== null && this.nodeSocket.readyState === WebSocket.OPEN;
  }
  
  public async setChannel(channelId: string | null) {
    if (this.isSocketOpen()) {
      await wait(1000)
      this.channel = channelId;
      this.sendToNodeProcess({ type: "set_channel", channelId });
      return true;
    }
    return false;
  }

  public broadcastAddress() {
    if (this.channel) {
      this.sendToNodeProcess({ type: "broadcast_address", channelId: this.channel });
    }
  }

  public queryAddresses() {
    if (this.channel) {
      this.sendToNodeProcess({ type: "query_addresses", channelId: this.channel });
    }
  }

  private updateAddressBook(addresses: string[]) {
    const newAddresses = addresses.filter(addr => !this.addressBook.has(addr));
    newAddresses.forEach(addr => {
      this.addressBook.add(addr);
      this.sendToNodeProcess({ type: "create_offer", targetPeerId: addr });
    });
  }


  //#endregion


  private async getddnsIP(): Promise<string> {
    const publicIp = await getIP();
    const resolved = await Deno.resolveDns("petplay.ddns.net", "A", {
      nameServer: { ipAddr: "8.8.8.8", port: 53 },
    });
    return publicIp == resolved ? "ws://192.168.1.178:8081" : "ws://petplay.ddns.net:8081";
  }

  private startNodeProcess() {
    const command = new Deno.Command("node", {
      args: [
        "-e",
        `require('child_process').execSync('npx ts-node nodeWebRTC/webrtc.ts ${this.id} ${this.ipcPort} ${this.ddnsIp}', {stdio: 'inherit'})`,
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const nodeProcess = command.spawn();

    this.pipeOutput(nodeProcess.stdout, "stdout");
    this.pipeOutput(nodeProcess.stderr, "stderr");
  }

  private pipeOutput(stream: ReadableStream<Uint8Array>, type: "stdout" | "stderr") {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    const idPrefix = this.id.split("@")[0];

    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).trim().split("\n");
        for (const line of lines) {
          return
          if (line) console.log(`[RTC NODE ${idPrefix} ${type}]: ${line}`);
        }
      }
    })();
  }

  private startIPCServer(): Promise<WebSocket> {
    return new Promise((resolve) => {
      Deno.serve({ port: this.ipcPort }, (req) => {
        if (req.headers.get("upgrade") !== "websocket") {
          return new Response(null, { status: 501 });
        }
        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.addEventListener("open", () => {
          console.log("IPC client connected!");
          this.nodeSocket = socket;
          resolve(socket);
        });

        socket.addEventListener("message", (event) => {
          this.handleNodeMessage(JSON.parse(event.data));
        });

        return response;
      });
      console.log(`IPC server is running on ws://localhost:${this.ipcPort}`);
    });
  }

  private handleNodeMessage(data: any) {
    console.log("Received message from Node process:", data);
    if (data.type === "address_update") {
      this.updateAddressBook(data.addresses);
    }
    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  public sendToNodeProcess(message: any) {
    if (this.isSocketOpen()) {
      this.nodeSocket!.send(JSON.stringify(message));
      return true;
    } else {
      console.error("Node socket is not open. Cannot send message.");
      return false;
    }
  }
}
import { getIP } from "https://deno.land/x/get_ip@v2.0.0/mod.ts";
import { wait } from "../actorsystem/utils.ts";
import { CustomLogger } from "../classes/customlogger.ts";
import * as JSON from "../classes/JSON.ts";

export class WebRTCInterface {
  private nodeSocket: WebSocket | null = null;
  private ipcPort: number;
  private id: string;
  private messageHandler: ((data: unknown) => void) | null = null;
  private topic: string | null = null;

  constructor(id: string, ipcPort: number) {
    this.ipcPort = ipcPort;
    this.id = id;
  }

  async start() {
    await this.startNodeProcess();
    return this.startIPCServer();
  }

  public onMessage(handler: (data: unknown) => void) {
    this.messageHandler = handler;
  }

  public isSocketOpen(): boolean {
    return this.nodeSocket !== null && this.nodeSocket.readyState === WebSocket.OPEN;
  }

  public async setTopic(topicId: string | null) {
    if (this.isSocketOpen()) {
      await wait(1000)
      this.topic = topicId;
      this.sendToNodeProcess({ type: "set_topic", topicId });
      return true;
    }
    return false;
  }

  private startNodeProcess() {
    const command = new Deno.Command("node", {
      args: [
        "-e",
        `require('child_process').execSync('npx ts-node nodeWebRTC/webrtc.ts ${this.id} ${this.ipcPort}', {stdio: 'inherit'})`,
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
          if (line) CustomLogger.log("default", `[RTC NODE ${idPrefix} ${type}]: ${line}`);
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
          CustomLogger.log("class", "IPC client connected!");
          this.nodeSocket = socket;
          resolve(socket);
        });

        socket.addEventListener("message", (event) => {
          this.handleNodeMessage(JSON.parse(event.data));
        });

        return response;
      });
      CustomLogger.log("class", `IPC server is running on ws://localhost:${this.ipcPort}`);
    });
  }

  private handleNodeMessage(data: unknown) {
    CustomLogger.log("class", "Received message from Node process:", data);
    if (this.messageHandler) {
      this.messageHandler(data);
    }
  }

  public sendToNodeProcess(message: unknown) {
    if (this.isSocketOpen()) {
      this.nodeSocket!.send(JSON.stringify(message));
      return true;
    } else {
      CustomLogger.error("syncloop", "Node socket is not open. Cannot send message.");
      return false;
    }
  }
}
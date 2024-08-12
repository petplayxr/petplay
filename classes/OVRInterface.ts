// IPCOVRSpawner.ts
import { getAvailablePort } from "jsr:@std/net";
import { CustomLogger } from "../classes/customlogger.ts";

class ExecRunner {
  constructor(private executablePath: string) { }

  async run(args: string[]) {
    const command = new Deno.Command(this.executablePath, {
      args: args,
      stdout: "piped",
      stderr: "piped",
    });

    const child = command.spawn();
    CustomLogger.log("class", `Spawned child pid: ${child.pid}`);

    // Function to handle continuous stream reading and logging
    const continuouslyLogStream = async (
      stream: ReadableStream<Uint8Array>,
      label: string,
    ) => {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          CustomLogger.log("class", `${label}: ${text}`);
        }
      } catch (err) {
        CustomLogger.error("classerr", `Error reading from ${label}:`, err);
      } finally {
        reader.releaseLock();
      }
    };

    // Start reading and logging stdout and stderr without waiting for them to finish
    continuouslyLogStream(child.stdout, "Standard Output");
    continuouslyLogStream(child.stderr, "Standard Error");

    // Monitor the process exit status in the background
    const status = await child.status;
    if (status.code !== 0) {
      CustomLogger.error("classerr", `Process exited with code ${status.code}`);
    }

    // Ensure resources are cleaned up
    child.stdout.cancel(); // Cancel the stream to prevent memory leaks
    child.stderr.cancel();
    CustomLogger.log("class", "Resources have been cleaned up.");
  }
}

class OVRInterface {
  private static overlayPortMap: Map<string, number> = new Map();
  private port: number;
  private server: Deno.Listener | null = null;
  private execRunner: ExecRunner;
  private conn: Deno.Conn | null = null;
  private subscribers: ((data: string) => void)[] = [];

  constructor(private overlayId: string, private executablePath: string) {
    this.execRunner = new ExecRunner(executablePath);
    this.port = 0; // Default value, adjust as needed
  }

  async connect() {
    const availablePort = await getAvailablePort();
    if (availablePort === undefined) {
      throw new Error("Failed to get an available port.");
    }
    this.port = availablePort;
    CustomLogger.log("class", `Using port: ${this.port}`);

    OVRInterface.overlayPortMap.set(this.overlayId, this.port);

    this.execRunner.run([this.port.toString()]);
    CustomLogger.log("class", `Executed ${this.executablePath} with port ${this.port}`);

    this.conn = await Deno.connect({ hostname: "127.0.0.1", port: this.port });
    CustomLogger.log("class", `Connected to server on port ${this.port}`);

    // Start listening for incoming data
    this.receive();
  }

  async send(data: string) {
    if (!this.conn) {
      throw new Error("No connection established.");
    }
    const encoder = new TextEncoder();
    await this.conn.write(encoder.encode(data + "\n"));
    //CustomLogger.log("class", `Sent data: ${data}`);
  }

  async receive() {
    if (!this.conn) {
      throw new Error("No connection established.");
    }
    const buffer = new Uint8Array(4096);
    const decoder = new TextDecoder();
    let partialMessage = "";

    while (true) {
      const bytesRead = await this.conn.read(buffer);
      if (bytesRead === null) {
        CustomLogger.log("class", "connection closed");
        break;
      }
      const chunk = decoder.decode(buffer.subarray(0, bytesRead), {
        stream: true,
      });
      partialMessage += chunk;

      while (true) {
        const lengthPrefix = partialMessage.indexOf(":L:");
        const dataPrefix = partialMessage.indexOf(":D:");

        if (
          lengthPrefix === -1 || dataPrefix === -1 || lengthPrefix >= dataPrefix
        ) {
          // Not enough data to determine the length or data, wait for more
          /* CustomLogger.log("class", "not enough data2") */
          break;
        }

        const lengthStr = partialMessage.slice(lengthPrefix + 3, dataPrefix);
        const messageLength = parseInt(lengthStr, 10);
        if (isNaN(messageLength)) {
          CustomLogger.log("class", "invalid message length");
          throw new Error(`Invalid message length: ${lengthStr}`);
        }

        // Check if we have the complete message
        if (partialMessage.length < dataPrefix + 3 + messageLength) {
          // Not enough data, wait for more
          /* CustomLogger.log("class", "not enough data1") */
          break;
        }

        // Extract the complete message
        const message = partialMessage.slice(
          dataPrefix + 3,
          dataPrefix + 3 + messageLength,
        );
        this.notifySubscribers(message);

        // Remove the processed message from partialMessage
        partialMessage = partialMessage.slice(dataPrefix + 3 + messageLength);
      }
    }

    // Handle any remaining partial message (if necessary)
    if (partialMessage.length > 0) {
      CustomLogger.log("class", "partial message");
      this.notifySubscribers(partialMessage);
    }
  }

  async disconnect() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    OVRInterface.overlayPortMap.delete(this.overlayId);
    CustomLogger.log("class", "TCP connection has been closed and port mapping removed.");
  }

  static getPortByOverlayId(overlayId: string): number | undefined {
    return OVRInterface.overlayPortMap.get(overlayId);
  }

  subscribe(callback: (data: string) => void) {
    this.subscribers.push(callback);
  }

  unsubscribe(callback: (data: string) => void) {
    this.subscribers = this.subscribers.filter((sub) => sub !== callback);
  }

  private notifySubscribers(data: string) {
    for (const subscriber of this.subscribers) {
      subscriber(data);
    }
  }
}

export { OVRInterface };

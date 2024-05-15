// IPCOVRSpawner.ts
import { getAvailablePort } from "https://deno.land/x/port/mod.ts"

class ExecRunner {
    constructor(private executablePath: string) { }

    async run(args: string[]) {
        const command = new Deno.Command(this.executablePath, {
            args: args,
            stdout: "piped",
            stderr: "piped"
        });

        const child = command.spawn();
        console.log(`Spawned child pid: ${child.pid}`);

        // Function to handle continuous stream reading and logging
        const continuouslyLogStream = async (stream: ReadableStream<Uint8Array>, label: string) => {
            const reader = stream.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = new TextDecoder().decode(value);
                    console.log(`${label}: ${text}`);
                }
            } catch (err) {
                console.error(`Error reading from ${label}:`, err);
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
            console.error(`Process exited with code ${status.code}`);
        }

        // Ensure resources are cleaned up
        child.stdout.cancel(); // Cancel the stream to prevent memory leaks
        child.stderr.cancel();
        console.log("Resources have been cleaned up.");
    }
}

class OverlayInterface {
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
        console.log(`Using port: ${this.port}`);

        OverlayInterface.overlayPortMap.set(this.overlayId, this.port);

        this.execRunner.run([this.port.toString()]);

        this.conn = await Deno.connect({ hostname: "127.0.0.1", port: this.port });
        console.log(`Connected to server on port ${this.port}`);

        // Start listening for incoming data
        this.receive();
    }

    async send(data: string) {
        if (!this.conn) {
            throw new Error("No connection established.");
        }
        const encoder = new TextEncoder();
        await this.conn.write(encoder.encode(data + "\n"));
        console.log(`Sent data: ${data}`);
    }

    async receive() {
        if (!this.conn) {
            throw new Error("No connection established.");
        }
        const buffer = new Uint8Array(1024);
        const decoder = new TextDecoder();
        while (true) {
            const bytesRead = await this.conn.read(buffer);
            if (bytesRead === null) {
                break;
            }
            const message = decoder.decode(buffer.subarray(0, bytesRead));
            console.log(`Received data: ${message}`);
            this.notifySubscribers(message);
        }
    }

    async disconnect() {
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
        OverlayInterface.overlayPortMap.delete(this.overlayId);
        console.log("TCP connection has been closed and port mapping removed.");
    }

    static getPortByOverlayId(overlayId: string): number | undefined {
        return OverlayInterface.overlayPortMap.get(overlayId);
    }

    subscribe(callback: (data: string) => void) {
        this.subscribers.push(callback);
    }

    unsubscribe(callback: (data: string) => void) {
        this.subscribers = this.subscribers.filter(sub => sub !== callback);
    }

    private notifySubscribers(data: string) {
        for (const subscriber of this.subscribers) {
            subscriber(data);
        }
    }
}

export { OverlayInterface };
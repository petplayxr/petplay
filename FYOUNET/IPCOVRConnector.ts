export class IPCOVRConnector {
    private hostname: string;
    private port: number;
    private conn: Deno.TcpConn | null = null;
    private subscribers: ((data: string) => void)[] = [];

    constructor() {
        this.hostname = "127.0.0.1";
        this.port = 27015;
    }

    async connect() {
        if (this.conn) {
            console.log("Already connected to server.");
            return;
        }
    
        // Retry logic
        const maxRetries = 9000; // Maximum number of retries
        const retryDelay = 12000; // Delay in milliseconds between retries
    
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.conn = await Deno.connect({
                    hostname: this.hostname,
                    port: this.port,
                });
                console.log("Connected to server!");
                this.receiveAndProcessData();
                break; // Exit the loop if the connection is successful
            } catch (error) {
                console.error(`Attempt ${attempt} failed: ${error.message}`);
                if (attempt < maxRetries) {
                    console.log(`Retrying in ${retryDelay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error("Maximum retries reached. Connection failed.");
                }
            }
        }
    }

    async updateCoord(data: string) {
        if (!this.conn) {
            console.error("Not connected to server.");
            return;
        }
        const encoder = new TextEncoder();
        const encodedData = encoder.encode(data);
        await this.conn.write(encodedData);
        console.log("Sent data back to server.");
    }

    subscribe(callback: (data: string) => void) {
        this.subscribers.push(callback);
    }

    private async receiveAndProcessData() {
        if (!this.conn) {
            console.error("Not connected to server.");
            return;
        }
        const buffer = new Uint8Array(4096);
        while (true) {
            const bytesRead = await this.conn.read(buffer);
            if (bytesRead === null) {
                console.log("Connection closed by server.");
                break; // Exit the loop if the server closes the connection
            }
            const decoder = new TextDecoder();
            const receivedMsg = decoder.decode(buffer.subarray(0, bytesRead));
            console.log("Received data:", receivedMsg);

            // Notify subscribers
            this.subscribers.forEach(subscriber => subscriber(receivedMsg));
        }

        // Close the connection
        if (this.conn) {
            this.conn.close();
            this.conn = null;
        }
    }
}

// iroh_interface_worker.ts
import { Iroh, NodeOptions, Connection, Connecting, BiStream, NodeAddr } from "@number0/iroh";
import { Buffer } from "node:buffer";


let irohNode: Iroh;
const ALPN = Buffer.from("iroh-actor-system/v1");

// Map to store active connections: nodeId -> Connection
const connections: Map<string, Connection> = new Map();
let ownNodeId: string | null = null; // Store own nodeId

self.onmessage = async (e: MessageEvent) => {
    const { type, data } = e.data;

    switch (type) {
        case 'INIT':
            await initNode();
            break;
        case 'CONNECT_BY_NODE_ID':
            await connectToNodeById(data.nodeId);
            break;
        case 'SEND_MESSAGE':
            console.log("iroh send")
            await sendMessage(data.message);
            break;
    }
};

async function initNode() {
    const protocols = {
        [ALPN]: (_err: unknown, _ep: unknown, client: Iroh) => ({
            accept: async (err: Error | null, connecting: Connecting) => {
                if (err) {
                    console.error("Error accepting connection:", err);
                    return;
                }

                const conn = await connecting.connect();
                await handleConnection(conn);
            },
            shutdown: (err: Error | null) => {
                if (err) {
                    console.error("Error during shutdown:", err);
                } else {
                    console.log("Shutting down Iroh node");
                }
            },
        }),
    };

    const options: NodeOptions = {
        enableRpc: true,
        protocols,
    };

    irohNode = await Iroh.memory(options);

    ownNodeId = await irohNode.net.nodeId();
    const nodeAddr = await irohNode.net.nodeAddr();

    // Notify the main thread that the node has been created, along with its ID and address
    self.postMessage({ type: 'NODE_CREATED', nodeId: ownNodeId, nodeAddr });
}

async function handleConnection(conn: Connection) {
    try {
        const remote = await conn.getRemoteNodeId();
        console.log(`Connected to ${remote.toString()}`);
        connections.set(remote.toString(), conn); // Store the connection

        const bi = await conn.acceptBi();
        listenForMessages(bi, remote.toString()); // Pass nodeId
    } catch (error) {
        console.error("Error handling connection:", error);
    }
}

async function connectToNodeById(nodeId: string) {
    if (!irohNode) {
        self.postMessage({ type: 'ERROR', message: 'Iroh node not initialized' });
        return;
    }

    if (connections.has(nodeId)) {
        console.log(`Already connected to node: ${nodeId}`);
        return;
    }

    try {
        const endpoint = irohNode.node.endpoint();
        if (!endpoint) throw new Error("Endpoint is undefined");

        console.log(`Connecting to node with ID: ${nodeId}`);

        // Prevent connecting to self
        if (nodeId === ownNodeId) {
            throw new Error("Connecting to ourself is not supported");
        }

        // Use connectByNodeId to connect via the raw node ID
        const conn = await endpoint.connectByNodeId(nodeId, ALPN);
        await handleConnection(conn);  // Call handleConnection after connecting

        self.postMessage({ type: 'CONNECTED', nodeAddr: { nodeId } });
    } catch (error) {
        self.postMessage({ type: 'ERROR', message: `Failed to connect: ${error.message}` });
    }
}

async function sendMessage(message: string) {
    try {
        if (connections.size === 0) {
            throw new Error("No connected nodes to send messages to.");
        }

        const fullMessage = JSON.stringify({ message, from: ownNodeId });
        const buffer = Buffer.from(fullMessage);

        for (const [nodeId, conn] of connections) {
            const bi = await conn.openBi();
            await bi.send.writeAll(buffer);
            await bi.send.finish();
            await bi.send.stopped();
        }

        self.postMessage({ type: 'MESSAGE_SENT', message });
    } catch (error) {
        self.postMessage({ type: 'ERROR', message: `Failed to send message: ${error.message}` });
    }
}

function listenForMessages(bi: BiStream, fromNodeId: string) {
    (async () => {
        try {
            while (true) {
                const chunk = await bi.recv.readToEnd(1024);
                if (chunk.length === 0) break;
                const rawMessage = Buffer.from(chunk).toString();
                const { message, from } = JSON.parse(rawMessage);

                // Prevent echo by ensuring messages are from other nodes
                if (from !== ownNodeId) {
                    self.postMessage({ type: 'MESSAGE_RECEIVED', from, message });
                }
            }
        } catch (error) {
            self.postMessage({ type: 'ERROR', message: `Error reading messages: ${error.message}` });
        }
    })();
}
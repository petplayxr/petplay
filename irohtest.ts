import { Iroh } from "@number0/iroh";
import { Buffer } from "node:buffer";

async function createMemoryNode() {
    const node = await Iroh.memory();
    console.log("Memory node created:", node);
}

async function createMemoryNodeWithOptions() {
    const node = await Iroh.memory({
        gcIntervalMillis: 10000,
    });
    console.log("Memory node with options created:", node);
}

async function nodeStatus() {
    const iroh = await Iroh.memory();
    const status = await iroh.node.status();
    console.log("Node status:", status);
}

async function rpcClientMemoryNode() {
    const node = await Iroh.memory({
        enableRpc: true,
    });

    const nodeId = await node.net.nodeId();

    const client = await Iroh.client();
    const clientId = await client.net.nodeId();

    console.log("Node ID:", nodeId);
    console.log("Client ID:", clientId);

    if (nodeId === clientId) {
        console.log("Node ID matches Client ID");
    } else {
        console.log("Node ID does not match Client ID");
    }
}

async function customProtocol() {
    const alpn: any = Buffer.from("iroh-example/hello/0");

    const protocols = {
        [alpn]: (_err: unknown, _ep: unknown, client: any) => ({
            accept: async (err: unknown, connecting: any) => {
                if (err) {
                    console.error("Error accepting connection:", err);
                    return;
                }

                const nodeId = await client.net.nodeId();
                console.log(`Accepting on node ${nodeId}`);

                const alpnProtocol = await connecting.alpn();
                console.log(`Incoming on ${alpnProtocol.toString()}`);

                const conn = await connecting.connect();
                const remote = await conn.getRemoteNodeId();
                console.log(`Connected to ${remote.toString()}`);

                const bi = await conn.acceptBi();
                const bytes = await bi.recv.readToEnd(64);
                console.log(`Received: ${bytes.toString()}`);

                if (bytes.toString() === "yo") {
                    console.log("Message received correctly: yo");
                }

                await bi.send.writeAll(Buffer.from("hello"));
                await bi.send.finish();
                await bi.send.stopped();
            },
            shutdown: (err: unknown) => {
                if (err) {
                    console.error("Error during shutdown:", err);
                } else {
                    console.log("Shutting down");
                }
            },
        }),
    };

    const node1 = await Iroh.memory({ protocols });
    const nodeAddr = await node1.net.nodeAddr();

    const node2 = await Iroh.memory({ protocols });
    const status = await node2.node.status();
    console.log(`Node 2 status: ${status.version}`);

    const endpoint = node2.node.endpoint();
    if (!endpoint) throw new Error("Endpoint is undefined")
    console.log(`Connecting to ${nodeAddr.nodeId}`);

    const conn = await endpoint.connect(nodeAddr, alpn);
    const remote = await conn.getRemoteNodeId();
    console.log(`Connected to ${remote.toString()}`);

    const bi = await conn.openBi();
    await bi.send.writeAll(Buffer.from("yo"));
    await bi.send.finish();
    await bi.send.stopped();

    let out = Buffer.alloc(5);
    await bi.recv.readExact(out);

    console.log(`Read: ${out.toString()}`);

    if (out.toString() === "hello") {
        console.log("Message received correctly: hello");
    }

    await node2.node.shutdown(false);
    await node1.node.shutdown(false);

    console.log("Nodes shut down");
}

// Run the functions sequentially
async function runExamples() {
    await createMemoryNode();
    await createMemoryNodeWithOptions();
    await nodeStatus();
    await rpcClientMemoryNode();
    await customProtocol();
}

runExamples().catch(console.error);

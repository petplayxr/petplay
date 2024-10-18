// main.ts
const args = Deno.args;
const processId = args[0] || "1";  // Get process ID from the first argument

// Automatically create Iroh worker and initialize it
const irohWorker = new Worker(new URL("./iroh_interface_worker.ts", import.meta.url).href, { type: "module" });
const actors: { [key: string]: Worker } = {};
let firstActorId: string | null = null; // Track the first actor ID
let ownNodeId: string | null = null; // Store own nodeId

irohWorker.onmessage = (e: MessageEvent) => {
    const { type, nodeId, nodeAddr, message, from } = e.data;

    switch (type) {
        case 'NODE_CREATED':
            ownNodeId = nodeId;
            console.log(`Iroh node created with ID: ${nodeId}`);
            console.log(`Node address (for connection): ${JSON.stringify(nodeAddr)}`);
            break;
        case 'CONNECTED':
            console.log(`Connected to node: ${nodeAddr.nodeId}`);
            break;
        case 'MESSAGE_RECEIVED':
            const { from: fromNodeId, message: msg } = e.data;
            // Prevent echo by not forwarding messages from self
            if (fromNodeId !== ownNodeId && firstActorId && actors[firstActorId]) {
                actors[firstActorId].postMessage({ type: 'RECEIVE_MESSAGE', message: msg });
            } else {
                console.log(`No actor found to receive the message or message from self.`);
            }
            break;
        case 'ERROR':
            console.error(`Iroh worker error: ${message}`);
            break;
    }
};

function createActor(actorId: string) {
    const worker = new Worker(new URL("./actor_worker.ts", import.meta.url).href, { type: "module" });
    actors[actorId] = worker;

    if (!firstActorId) {
        firstActorId = actorId; // Set the first created actor
    }

    worker.postMessage({ type: 'INIT', data: { actorId } });

    worker.onmessage = (e: MessageEvent) => {
        const { type, message } = e.data;
        if (type === 'SEND_MESSAGE') {
            // The first actor sends messages to the Iroh worker
            irohWorker.postMessage({ type: 'SEND_MESSAGE', data: {message: message } });
            console.log("sent");
        }
    };

    console.log(`Actor created with ID: ${actorId}`);
}

// Initialize Iroh node automatically
irohWorker.postMessage({ type: 'INIT' });

await new Promise(resolve => setTimeout(resolve, 2000)); // Ensure the log shows up

// Non-blocking CLI interface
async function cli() {
    while (true) {
        const input = prompt("Enter command (create_actor, connect, send, quit):");
        if (!input) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to prevent tight loop
            continue;
        }

        const [command, ...args] = input.split(' ');

        switch (command) {
            case 'create_actor':
            case 'ca':
                if (args.length < 1) {
                    console.log("Usage: create_actor <actor_id>");
                    break;
                }
                createActor(args[0]);
                break;
            case 'connect':
                if (args.length < 1) {
                    console.log("Usage: connect <node_id>");
                    break;
                }
                const nodeId = args[0];  // Take the raw node ID as input
                irohWorker.postMessage({ type: 'CONNECT_BY_NODE_ID', data: { nodeId } });  // Pass the node ID to the Iroh worker
                break;
            case 'send':
                if (!firstActorId) {
                    console.log("No actor has been created yet.");
                    break;
                }
                const message = args.join(' ');  // Get the entire message as one string
                if (actors[firstActorId]) {
                    actors[firstActorId].postMessage({ type: 'SEND_MESSAGE', data: { message: message } });
                } else {
                    console.log(`No actor found with ID: ${firstActorId}`);
                }
                break;
            case 'quit':
                console.log("Exiting...");
                return;
            default:
                console.log("Unknown command");
        }

        await new Promise(resolve => setTimeout(resolve, 0)); // Yield to allow message processing
    }
}

console.log(`Process ${processId} started. Use the CLI to interact with the system.`);
cli();

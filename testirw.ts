// test_iroh_workers.ts
const worker1 = new Worker(new URL("./iroh_worker.ts", import.meta.url).href, { type: "module" });
const worker2 = new Worker(new URL("./iroh_worker.ts", import.meta.url).href, { type: "module" });

let node1Addr: any;
let node2Addr: any;

worker1.onmessage = handleWorkerMessage('Worker 1');
worker2.onmessage = handleWorkerMessage('Worker 2');

function handleWorkerMessage(workerName: string) {
    return (e: MessageEvent) => {
        const { type, nodeId, nodeAddr, message } = e.data;
        console.log(`${workerName} - Received: ${type}`);

        switch (type) {
            case 'NODE_CREATED':
                if (workerName === 'Worker 1') {
                    node1Addr = nodeAddr;
                    console.log(`Node 1 ID: ${nodeId}`);
                    worker2.postMessage({ type: 'CREATE_NODE', data: { isFirst: false } });
                } else {
                    node2Addr = nodeAddr;
                    console.log(`Node 2 ID: ${nodeId}`);
                    worker2.postMessage({ type: 'CONNECT', data: { nodeAddr: node1Addr } });
                }
                break;
            case 'CONNECTED':
                console.log(`${workerName} connected to ${nodeAddr.nodeId}`);
                break;
            case 'LOG':
                console.log(`${workerName} log: ${message}`);
                break;
            case 'ERROR':
                console.error(`${workerName} error: ${message}`);
                break;
        }
    };
}

// Start the test by creating the first node
worker1.postMessage({ type: 'CREATE_NODE', data: { isFirst: true } });

// Cleanup function
function cleanup() {
    worker1.postMessage({ type: 'SHUTDOWN' });
    worker2.postMessage({ type: 'SHUTDOWN' });
    setTimeout(() => {
        worker1.terminate();
        worker2.terminate();
        console.log('Test completed, workers terminated.');
    }, 1000);
}

// Run the cleanup after 10 seconds (adjust as needed)
setTimeout(cleanup, 10000);

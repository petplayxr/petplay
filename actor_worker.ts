// actor_worker.ts
self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data;
    console.log(data)

    switch (type) {
        case 'INIT':
            console.log(`Actor ${data.actorId} initialized.`);
            break;
        case 'RECEIVE_MESSAGE':
            console.log(`Actor received message: ${data.message}`);
            break;
        case 'SEND_MESSAGE':
            // Forward the message to the Iroh worker
            self.postMessage({ type: 'SEND_MESSAGE', message: data.message });
            console.log("sent")
            break;
    }
};

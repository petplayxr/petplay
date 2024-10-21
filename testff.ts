import { listen } from "jsr:@milly/namedpipe";
import { Worker, MessageChannel, isMainThread, parentPort } from "node:worker_threads";

const pipePath = "\\\\.\\pipe\\your-own-name";
const NUM_WORKERS = 4; // Adjust based on your CPU cores
const TARGET_FPS = 90; // Typical refresh rate for VR headsets
const FRAME_TIME_MS = 1000 / TARGET_FPS;

// Function to simulate a precise delay using Atomics.wait
function preciseWait(ms: number) {
    const sharedArray = new Int32Array(new SharedArrayBuffer(4));
    const start = performance.now();
    while (performance.now() - start < ms) {
        Atomics.wait(sharedArray, 0, 0, 1);
    }
}

// Simulated OpenVR overlay
class SimulatedOpenVROverlay {
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private totalLatency: number = 0;

    updateTexture(frameData: Uint8Array, captureTimestamp: number) {
        const now = performance.now();
        const latency = now - captureTimestamp;
        this.totalLatency += latency;
        this.frameCount++;

        if (now - this.lastFrameTime >= 1000) {
            const avgLatency = this.totalLatency / this.frameCount;
            const fps = this.frameCount / ((now - this.lastFrameTime) / 1000);
            console.log(`OpenVR Overlay: FPS: ${fps.toFixed(2)}, Avg Latency: ${avgLatency.toFixed(2)}ms`);
            this.lastFrameTime = now;
            this.frameCount = 0;
            this.totalLatency = 0;
        }

        // Simulate texture update time
        const textureUpdateTime = 2; // ms, adjust based on expected GPU performance
        preciseWait(textureUpdateTime);
    }
}

const openVROverlay = new SimulatedOpenVROverlay();

if (!isMainThread) {
    parentPort!.once('message', (value) => {
        const port = value.port;
        port.on('message', (message: { frameData: Uint8Array, captureTimestamp: number }) => {
            const { frameData, captureTimestamp } = message;
            // Simulate some processing (e.g., resizing, color space conversion)
            const sum = frameData.reduce((a, b) => a + b, 0);
            openVROverlay.updateTexture(frameData, captureTimestamp);
            port.postMessage({ sum, processedTimestamp: performance.now() });
        });
    });
}

async function captureDesktopToMemory(duration: number): Promise<void> {
    const ffmpegCommand = new Deno.Command("ffmpeg", {
        args: [
            "-y",
            "-f", "gdigrab",
            "-framerate", `${TARGET_FPS}`,
            "-t", duration.toString(),
            "-i", "desktop",
            "-c:v", "mjpeg",
            "-q:v", "3",
            "-f", "image2pipe",
            pipePath
        ],
        stderr: "piped",
    });

    console.log(`Starting FFmpeg capture to named pipe at ${TARGET_FPS} FPS...`);

    const child = ffmpegCommand.spawn();
    const { stderr } = child;

    const errorReader = stderr.getReader();
    const decoder = new TextDecoder();
    (async () => {
        while (true) {
            const { done, value } = await errorReader.read();
            if (done) break;
            if (value) console.error(decoder.decode(value));
        }
    })();
}

async function startPipeServer() {
    const listener = listen({ path: pipePath });
    console.log("Named pipe server started. Waiting for FFmpeg to connect...");

    const frameQueue: Array<{ frameData: Uint8Array, captureTimestamp: number }> = [];
    let processedFrames = 0;
    let lastLogTime = performance.now();
    let totalLatency = 0;

    // Create worker threads
    const workers = Array.from({ length: NUM_WORKERS }, () => {
        const worker = new Worker(new URL(import.meta.url));
        const { port1, port2 } = new MessageChannel();
        worker.postMessage({ port: port1 }, [port1]);
        return { worker, port: port2, busy: false };
    });

    // Function to process frames using available workers
    async function processFrames() {
        for (const workerData of workers) {
            if (!workerData.busy && frameQueue.length > 0) {
                const frame = frameQueue.shift()!;
                workerData.busy = true;
                workerData.port.postMessage(frame);
                workerData.port.once('message', (message: { sum: number, processedTimestamp: number }) => {
                    workerData.busy = false;
                    processedFrames++;
                    const endToEndLatency = message.processedTimestamp - frame.captureTimestamp;
                    totalLatency += endToEndLatency;
                });
            }
        }

        // Log performance metrics every second
        const now = performance.now();
        if (now - lastLogTime > 1000) {
            const elapsedSeconds = (now - lastLogTime) / 1000;
            const fps = processedFrames / elapsedSeconds;
            const avgLatency = totalLatency / processedFrames;
            console.log(`Processed ${fps.toFixed(2)} FPS. Avg Latency: ${avgLatency.toFixed(2)}ms. Queue size: ${frameQueue.length}`);
            processedFrames = 0;
            totalLatency = 0;
            lastLogTime = now;
        }
    }

    for await (const conn of listener) {
        console.log("--- New connection from FFmpeg ---");

        let frameCount = 0;
        const reader = conn.readable.getReader();

        try {
            let buffer = new Uint8Array(0);
            const frameStartMarker = new Uint8Array([0xFF, 0xD8]);
            const frameEndMarker = new Uint8Array([0xFF, 0xD9]);

            const processInterval = setInterval(() => {
                processFrames();
                preciseWait(FRAME_TIME_MS);
            }, FRAME_TIME_MS);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                if (value) {
                    buffer = new Uint8Array([...buffer, ...value]);

                    let startIdx = 0;
                    while (true) {
                        const startMarkerIdx = buffer.indexOf(frameStartMarker[0], startIdx);
                        if (startMarkerIdx === -1) break;

                        const endMarkerIdx = buffer.indexOf(frameEndMarker[1], startMarkerIdx + 2);
                        if (endMarkerIdx === -1) break;

                        const frameData = buffer.slice(startMarkerIdx, endMarkerIdx + 2);
                        frameCount++;
                        frameQueue.push({ frameData, captureTimestamp: performance.now() });

                        startIdx = endMarkerIdx + 2;
                    }

                    buffer = buffer.slice(startIdx);
                }
            }

            clearInterval(processInterval);
        } catch (error) {
            console.error("Error reading from pipe:", error);
        } finally {
            reader.releaseLock();
            await conn.close();
        }
        console.log(`Total frames captured: ${frameCount}`);

        // Process any remaining frames
        while (frameQueue.length > 0) {
            await processFrames();
            preciseWait(FRAME_TIME_MS);
        }
    }

    // Terminate workers
    for (const { worker, port } of workers) {
        port.close();
        worker.terminate();
    }
}

async function main() {
    if (isMainThread) {
        const captureDuration = 30; // Increased to 30 seconds for better performance evaluation
        startPipeServer();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await captureDesktopToMemory(captureDuration);
    }
}

main();
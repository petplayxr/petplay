import { launch,  } from "jsr:@astral/astral";

async function captureScreenshots(url: string, numFrames: number = 100, maxCaptureTime: number = 10000) {
    console.log("Starting capture process...");
    const browser = await launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-audio-output',
            '--no-first-run',
            '--no-zygote',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-popup-blocking',
            '--disable-settings-window',
            '--disable-prompt-on-repost',
            '--disable-background-networking',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-default-browser-check',
            '--mute-audio',
            '--ignore-certificate-errors',
            '--disable-client-side-phishing-detection',
            '--enable-features=NetworkService,NetworkServiceInProcess',
            '--disable-features=IsolateOrigins,site-per-process',
        ]
    });
    console.log("Browser launched");

    const page = await browser.newPage(url);
    console.log("New page created and navigated to URL");

    const startTime = Date.now();
    const frameTimes = [];

    for (let i = 0; i < numFrames; i++) {
        const frameStartTime = Date.now();

        if (frameStartTime - startTime > maxCaptureTime) {
            console.log(`Max capture time reached after ${i} frames`);
            break;
        }

        // Capture screenshot
        await page.screenshot({
            optimizeForSpeed: true,
            format: "jpeg",
            quality: 90,
        });

        const frameEndTime = Date.now();
        const frameTime = frameEndTime - frameStartTime;
        frameTimes.push(frameTime);

        if (i % 10 === 0) {
            console.log(`Captured frame ${i} in ${frameTime}ms`);
        }
    }

    await browser.close();
    console.log("Browser closed");

    // Calculate and log FPS
    const totalTime = Date.now() - startTime;
    const avgFrameTime = frameTimes.reduce((sum, time) => sum + time, 0) / frameTimes.length;
    const fps = 1000 / avgFrameTime;

    console.log(`Capture completed in ${totalTime}ms`);
    console.log(`Total frames captured: ${frameTimes.length}`);
    console.log(`Average frame time: ${avgFrameTime.toFixed(2)}ms`);
    console.log(`Estimated FPS: ${fps.toFixed(2)}`);

    // Calculate percentiles
    frameTimes.sort((a, b) => a - b);
    const p50 = frameTimes[Math.floor(frameTimes.length * 0.5)];
    const p95 = frameTimes[Math.floor(frameTimes.length * 0.95)];
    const p99 = frameTimes[Math.floor(frameTimes.length * 0.99)];

    console.log(`50th percentile (median) frame time: ${p50}ms`);
    console.log(`95th percentile frame time: ${p95}ms`);
    console.log(`99th percentile frame time: ${p99}ms`);
}

const url = "https://www.nyan.cat/";
console.log(`Starting capture for URL: ${url}`);
captureScreenshots(url);
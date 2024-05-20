//import puppeteer, { Page } from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import puppeteer, { Page,ScreenRecorder } from "https://raw.githubusercontent.com/mommysgoodpuppy/puppeteer_plus/main/mod.ts";
import { Buffer } from "https://deno.land/std@0.224.0/io/buffer.ts";
import {installMouseHelper} from "./install-mouse-helper.js";



// Function to capture and save images from the screencast stream
async function captureFrames(url:string) {
  const browser = await puppeteer.launch({
    headless: true,
    handleSIGHUP: false,
    handleSIGINT: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });
  await page.goto(url, {
    waitUntil: 'networkidle2',
  });

  // Start the screencast
  const recorder = await page.screencast();
  
  // Create a buffer to store the screencast data
  let chunks = [];
  recorder.on('data', (chunk:Uint8Array) => { //Uint8Array(429)
    chunks.push(chunk);
  });

  // Wait for 1 second
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Stop the screencast
  await recorder.stop();
  console.log("Recording stopped");


  await browser.close();
}

const url = "https://www.nyan.cat/";
captureFrames(url);
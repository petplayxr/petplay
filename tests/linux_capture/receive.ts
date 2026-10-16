import { type CapturedFrame, ScreenCapturer } from "../../classes/ScreenCapturer/scclass.ts";

const [helper, token, output] = Deno.args;
const originalBus = Deno.env.get("DBUS_SESSION_BUS_ADDRESS");
// Reserve an available TCP port; ScreenCapturer requires a concrete port for the helper.
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const capture = new ScreenCapturer({
  port,
  executablePath: helper,
  captureTokenPath: token,
  fps: 5,
  debug: true,
});
let previous: CapturedFrame | null = null;
const phases = new Set<string>();
const samples = [];
try {
  for (let i = 0; i < 50; i++) {
    const frame = await capture.getNextFrame(previous, 15_000);
    if (!frame) throw new Error("No captured frame within 15 seconds");
    previous = frame;
    if (i === 0) await Deno.writeTextFile(`${output}/source-chosen`, "yes\n");
    const { width, height, data } = frame;
    if (width !== 960 || height !== 720 || data.length !== width * height * 4) {
      throw new Error(`Unexpected frame: ${width}x${height}, ${data.length} bytes`);
    }
    const pixel = (x: number, y: number) =>
      Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
    const sample = {
      left: pixel(width / 4, height / 2),
      right: pixel(width * 3 / 4, height / 2),
      middle: pixel(width / 2, height / 2),
    };
    samples.push(sample);
    if (String(sample.left) === "0,0,255,255" && String(sample.right) === "255,0,0,255") {
      if (String(sample.middle) === "0,255,0,255") phases.add("green");
      if (String(sample.middle) === "0,255,255,255") phases.add("yellow");
    }
    if (phases.size === 2 && i >= 24) {
      await Deno.writeFile(`${output}/frame.bgra`, data);
      await Deno.writeTextFile(
        `${output}/receiver-result.json`,
        JSON.stringify(
          {
            success: true,
            receiver: "PetPlay ScreenCapturer and frame receiver worker",
            frames: samples.length,
            dimensions: [width, height],
            phases: [...phases],
            first: samples[0],
            last: sample,
            parentEnvironmentPreserved: Deno.env.get("DBUS_SESSION_BUS_ADDRESS") === originalBus,
          },
          null,
          2,
        ) + "\n",
      );
      break;
    }
  }
  if (phases.size !== 2) throw new Error("Did not receive both expected pattern phases");
  if (Deno.env.get("DBUS_SESSION_BUS_ADDRESS") !== originalBus) {
    throw new Error("Parent bus changed");
  }
} finally {
  await capture.dispose();
}

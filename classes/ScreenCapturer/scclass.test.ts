import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { ScreenCapturer } from "./scclass.ts";

Deno.test("a dropped frame socket stops a live helper so its owner can restart it", async () => {
  const dir = Deno.makeTempDirSync();
  const helper = `${dir}/fake-streamer`;
  const script = new URL("./testdata/fake_streamer.ts", import.meta.url).pathname;
  Deno.writeTextFileSync(helper, `#!/bin/sh\nexec "${Deno.execPath()}" run -A "${script}" "$@"\n`);
  Deno.chmodSync(helper, 0o755);
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  let notifyExit!: (status: Deno.CommandStatus) => void;
  const exited = new Promise<Deno.CommandStatus>((resolve) => notifyExit = resolve);
  const capturer = new ScreenCapturer({ port, executablePath: helper, onExit: notifyExit });
  try {
    const frame = await capturer.getNextFrame(null, 10_000);
    assertEquals([frame?.width, frame?.height], [2, 1]);
    const status = await Promise.race([
      exited,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    assertEquals(status?.success, false, "the helper should have been stopped");
  } finally {
    await capturer.dispose();
    Deno.removeSync(dir, { recursive: true });
  }
});

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

Deno.test("capture session overrides reach the helper without changing the OpenVR environment", async () => {
  const dir = Deno.makeTempDirSync();
  const report = `${dir}/environment.json`;
  const script = new URL("./testdata/fake_streamer.ts", import.meta.url).pathname;
  const helper = `${dir}/fake-streamer`;
  Deno.writeTextFileSync(helper, `#!/bin/sh\nexec "${Deno.execPath()}" run -A "${script}" "$@"\n`);
  Deno.chmodSync(helper, 0o755);
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const values = {
    DBUS_SESSION_BUS_ADDRESS: "parent-vr-session",
    XDG_RUNTIME_DIR: "/parent-vr-runtime",
    WAYLAND_DISPLAY: "parent-vr-display",
    PETPLAY_CAPTURE_DBUS_SESSION_BUS_ADDRESS: "capture-session",
    PETPLAY_CAPTURE_XDG_RUNTIME_DIR: "/capture-runtime",
    PETPLAY_CAPTURE_WAYLAND_DISPLAY: "capture-display",
    PETPLAY_TEST_CAPTURE_ENV_REPORT: report,
  };
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  const capturer = new ScreenCapturer({ port, executablePath: helper });
  try {
    const frame = await capturer.getNextFrame(null, 10_000);
    assertEquals(frame?.width, 2);
    assertEquals(JSON.parse(await Deno.readTextFile(report)), {
      DBUS_SESSION_BUS_ADDRESS: "capture-session",
      XDG_RUNTIME_DIR: "/capture-runtime",
      WAYLAND_DISPLAY: "capture-display",
    });
    assertEquals(Deno.env.get("DBUS_SESSION_BUS_ADDRESS"), "parent-vr-session");
    assertEquals(Deno.env.get("XDG_RUNTIME_DIR"), "/parent-vr-runtime");
    assertEquals(Deno.env.get("WAYLAND_DISPLAY"), "parent-vr-display");
  } finally {
    await capturer.dispose();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    Deno.removeSync(dir, { recursive: true });
  }
});

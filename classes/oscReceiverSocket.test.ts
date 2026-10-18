import { listenOscReceiver } from "./oscReceiverSocket.ts";

Deno.test("OSC receiver coexists with another app owning the preferred port", async () => {
  const other = Deno.listenDatagram({ port: 0, transport: "udp" });
  const port = (other.addr as Deno.NetAddr).port;
  const receiver = listenOscReceiver(port);
  const actual = (receiver.addr as Deno.NetAddr).port;
  try {
    if (actual === port || actual === 0) throw new Error("expected a distinct assigned port");
    await other.send(new Uint8Array([42]), {
      hostname: "127.0.0.1",
      port: actual,
      transport: "udp",
    });
    const [packet] = await receiver.receive();
    if (packet[0] !== 42) throw new Error("receiver did not receive on assigned port");
  } finally {
    receiver.close();
    other.close();
  }
});

Deno.test("OSC receiver reuses its alternate port after restarting", () => {
  const other = Deno.listenDatagram({ port: 0, transport: "udp" });
  const port = (other.addr as Deno.NetAddr).port;
  let receiver = listenOscReceiver(port);
  try {
    const actual = (receiver.addr as Deno.NetAddr).port;
    receiver.close();
    receiver = listenOscReceiver(port);
    if ((receiver.addr as Deno.NetAddr).port !== actual) throw new Error("alternate port changed");
  } finally {
    receiver.close();
    other.close();
  }
});

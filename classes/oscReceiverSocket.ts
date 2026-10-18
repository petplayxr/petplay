/** Keep the conventional OSC output port when free; OSCQuery advertises the actual port. */
export function listenOscReceiver(preferredPort: number): Deno.DatagramConn {
  try {
    return Deno.listenDatagram({ port: preferredPort, transport: "udp" });
  } catch (error) {
    if (!(error instanceof Deno.errors.AddrInUse)) throw error;
    // Face/eye tracking software commonly owns 9001. Do not share its socket or stop it.
    // Prefer a repeatable port so a receiver restart does not invalidate clients' caches.
    for (let port = preferredPort + 1; port <= Math.min(preferredPort + 10, 65535); port++) {
      try {
        return Deno.listenDatagram({ port, transport: "udp" });
      } catch (nextError) {
        if (!(nextError instanceof Deno.errors.AddrInUse)) throw nextError;
      }
    }
    return Deno.listenDatagram({ port: 0, transport: "udp" });
  }
}

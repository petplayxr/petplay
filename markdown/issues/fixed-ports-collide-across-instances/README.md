# Fixed ports collide when two instances run

Status: open
Track: stability-performance, capture-in-repo

The `hmd` pose websocket (8887) and the capture receiver (12345) are fixed. A second instance
fails with `Address already in use`. Overlay keys are already per-pid
(`petplay.webxr.overlay.raylib.<pid>`); these ports are the remaining fixed resources.

Fix: bind port 0 (or a pid-derived port) and pass the chosen port to the helper/clients.

Source: `docs/ARCHITECTURE.md` §9.

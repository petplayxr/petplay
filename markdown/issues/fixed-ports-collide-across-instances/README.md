# Fixed ports collide when two instances run

Status: open
Track: stability-performance, capture-in-repo

The capture receiver (12345) is fixed. A second instance fails with `Address already in use`.
Overlay keys are already per-pid (`petplay.webxr.overlay.raylib.<pid>`); this port is the
remaining fixed resource. (The `hmd` pose websocket on 8887 had no clients and was removed on
2026-10-19.)

Fix: bind port 0 (or a pid-derived port) and pass the chosen port to the helper/clients.

Source: `docs/ARCHITECTURE.md` §9.

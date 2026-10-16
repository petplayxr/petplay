# Isolated Linux capture integration test

Tests the actual path from an existing Wayland desktop through KDE's ScreenCast portal,
`OpenPipeWireRemote`, the native helper, and PetPlay's `ScreenCapturer`/frame receiver worker.
The desktop is test infrastructure; PetPlay remains a cross-platform capture client.

From the repository root:

```sh
deno task build:native
python3 tests/linux_capture/run.py
# Optional control: KWin's virtual backend instead of nested Wayland
python3 tests/linux_capture/run.py --backend virtual
```

Prerequisites: Linux with KWin, KDE's portal backend, xdg-desktop-portal, PipeWire,
WirePlumber with the `policy` profile, Deno, and Python with PyGObject and PySide6.
The current backend/permission-store executable paths match Arch/CachyOS. Pass `--helper`
for another native executable path (including an ARM64 build on an ARM64 host).

The default test starts KWin nested inside a separate headless KWin, approximating Frame's
nested Plasma capture topology. It starts a fullscreen changing test pattern, real KDE
portal/backend services and private PipeWire/WirePlumber processes. It uses software rendering,
a private session bus, runtime directory, configuration, cache and state; it does not restart
or reconfigure the user's desktop services. WirePlumber runs policy only, without hardware
monitors. The helper runs with `--no-input`, so the test never opens host uinput devices.

KWin's permission-check bypass applies only to the private test compositor, allowing the
chooser to be automated through KDE's test input protocol. This does **not** test production
permission policy or recommend disabling checks in a real desktop. The chooser selects an
existing output, not a screencast-created virtual output. Automation asserts the private runtime
and socket name before sending keys. Tab and Space activate the first output card once;
Enter in KDE 6.7's search field produced duplicate Start replies and replaced the stream.

The test requires 25 frames at 960 × 720 with exact BGRA red/blue samples and both changing
center colors. It deliberately gives the helper a nonexistent default PipeWire remote and
leaves the Deno parent on a different bus, checking that the portal FD and helper-only capture
session configuration work. It saves `result.json`, process logs and a captured `frame.png`
under `_scratch/linux-capture/<timestamp>/`, then stops its processes and removes its private
runtime. Use `--out` for a different empty artifact directory.

This validates native Linux capture and reception. It does not validate Frame's ARM64 firmware,
Gamescope portal, GPU-specific buffer handling, source discovery, pointer targeting, OpenVR
presentation or headset performance. The pattern changes at 2.5 Hz, so this is a correctness
test rather than an FPS benchmark.

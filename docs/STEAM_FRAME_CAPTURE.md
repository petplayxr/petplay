# Steam Frame capture assessment

Investigated 2026-10-16; local capture validation 2026-10-17. **PetPlay remains a cross-platform screen-capture system. Portal/PipeWire
is a plausible Linux backend for capturing existing Frame sources, but is not yet verified
in PetPlay on hardware.** DroidFrame's
current failure happens before pixel capture and cannot establish a real-Frame incompatibility.

This assessment distinguishes static inspection of the available Frame image (SteamOS VR 0.3.0,
`BUILD_ID=20260922.5152327`), current public compositor source, and an on-device DroidFrame probe.
The public source revisions are not asserted to match that image or today's shipping firmware.

## What Frame actually provides

The image's `/usr/lib/steamos/gamescope-session` starts Gamescope with the OpenVR backend,
`--vr-session-manager`, two Xwayland servers and `--virtual-connector-strategy PerAppId`.
Steam UI and application panels therefore are not an ordinary collection of physical monitors.

The inspected image contains `xdg-desktop-portal`, `xdg-desktop-portal-gamescope`, and
`/usr/lib/xdg-desktop-portal-kde`, together with KDE's D-Bus activation service. This is file
presence, not proof that KDE capture activates successfully in the running desktop.
`/usr/bin/start-gamescope-session` selects the Gamescope/Holo backend definitions through
`XDG_DESKTOP_PORTAL_DIR=/usr/share/xdg-desktop-portal/gamescope-portals` in the user service
manager. The Gamescope definition implements ScreenCast, Screenshot and Access. It does **not**
implement RemoteDesktop. Do not infer portal readiness from the existence of a PipeWire process.

Frame also ships a nested Plasma desktop: `/usr/bin/steamos-nested-desktop` creates
`$XDG_RUNTIME_DIR/nested_plasma`, shares the outer PipeWire/Pulse sockets, removes the Gamescope
portal override and runs `dbus-run-session startplasma-wayland`. That desktop has its **own
session bus and compositor**. PetPlay launched in Steam's outer session does not automatically
request the inner desktop's ScreenCast service. Capturing Plasma may require running PetPlay
from that desktop, or selecting its environment for the capture helper alone.

Valve's documented XRDP developer desktop is another session: its default login is Xorg.
It is not evidence that a Steam-launched VR application has a capturable KDE Wayland desktop.
Source: [Valve's Frame debugging documentation](https://partner.steamgames.com/doc/steamhardware/steamframe/debugging).

## What the current capture path can reasonably do

The [Gamescope portal source](https://github.com/evlaV/xdg-desktop-portal-gamescope/tree/c99b9f7a6357e4753391c13933ef8bbfc3a9b7bb)
(Valve-authored source mirrored publicly) obtains Gamescope's PipeWire node through its private
Wayland protocol and returns one monitor stream. It advertises monitor/window support but its
source-selection method is a TODO; it does not implement arbitrary application selection.
PetPlay's monitor-only request is compatible with this basic monitor path, rather than itself
being proof of failure. The protocol should remain behind the portal, not become PetPlay's
primary private API dependency.

[Gamescope's capture protocol](https://github.com/ValveSoftware/gamescope/blob/2b5cf191d1047d6895516a834de8a72ac1c342f3/protocol/gamescope-pipewire.xml)
advertises the main capture node. At that source revision, `src/pipewire.cpp` supports BGRx
and NV12, with shared-memory and DMA-BUF buffers. PetPlay supports BGRx, so a CPU-accessible
basic stream has a plausible common format. The compositor's `paint_pipewire` path follows
current focus unless Gamescope-specific app-id metadata selects an application. PetPlay does
not currently negotiate that metadata. This is not a general “all VR panels as one desktop”
implementation or a verified per-app capture backend on Frame.

| Desired source | Assessment |
| --- | --- |
| Gamescope's main/focused local application output | Existing portal approach is plausible; verify actual selected pixels and metadata on Frame |
| Nested Plasma desktop | Plausible through its KDE portal, but needs the correct bus/runtime/session |
| Arbitrary independent Steam VR application panels | Additional discovery/selection likely needed; current monitor-only helper and portal source do not establish it |
| PC desktop streamed to Frame | A separate host-capture/control problem; local Frame capture and uinput do not provide PC desktop access |

## Frametop as a reference

Reviewed [Frametop](https://github.com/Frametop/frametop) at commit
`adebd7d6cfc938477bf8e42a8bcb1c41a32a6f9c`. Its main local desktop path is **a hosting
compositor, not a screen-capture client**:

1. `session/frametop-session.sh` starts a nested Plasma/KWin session under `ft-screens`,
   a small wlroots Wayland compositor, with one KWin host window per desktop output.
2. `screens/compositor.c` obtains the committed buffer's DMA-BUF attributes and retains the
   buffer while SteamVR uses it.
3. `screens/vr.cpp` imports the buffer using OpenVR's `IVRIPCResourceManagerClient::ImportDmabuf`
   and submits a `TextureType_SharedTextureHandle` to the overlay. Imports are cached by buffer;
   overlays are cleared before imports are released. Its implementation avoids the CPU readback,
   raw-pixel TCP stream and texture upload in PetPlay's current capture path.
4. Input enters the hosted desktop through the compositor's Wayland seat. It does not rely on
   uinput accidentally targeting the correct nested desktop.

See its [design notes](https://github.com/Frametop/frametop/blob/adebd7d6cfc938477bf8e42a8bcb1c41a32a6f9c/docs/design.md),
[buffer handling](https://github.com/Frametop/frametop/blob/adebd7d6cfc938477bf8e42a8bcb1c41a32a6f9c/screens/compositor.c)
and [OpenVR submission](https://github.com/Frametop/frametop/blob/adebd7d6cfc938477bf8e42a8bcb1c41a32a6f9c/screens/vr.cpp).

PetPlay will continue capturing existing desktops and applications through platform-specific
backends behind its cross-platform capture interface. Hosting a desktop or implementing a
compositor is outside PetPlay's direction. Frametop is useful here as a reference for Linux GPU
buffer lifetime and SteamVR texture import, not as an architecture to adopt. A later GPU capture
optimization would also need an explicit native buffer transport: a file descriptor is not a
transferable raw texture payload.

Frametop's remote-access path is separate: `session/remote-desktop.sh` uses KRdp's `--plasma`
backend to capture the nested KWin directly, without a desktop portal. That suggests a direct
KWin capture backend as another option if portal capture is unavailable. Frametop enables KWin
permission-check bypasses only for its own remote-enabled nested session; PetPlay should not
copy those environment settings into an existing desktop automatically.

Its design notes say SteamOS lacks `xdg-desktop-portal-kde`. That conflicts with the executable
and activation file present in our inspected SteamOS VR 0.3.0 image. Treat the upstream report
as a compatibility warning, not a universal fact about every Frame image. Establish actual
portal activation and pixel delivery on each supported firmware. Frametop also reports crashes
with KWin 6.2.5's virtual-output screencast path; avoid assuming virtual outputs work simply
because ordinary output capture does.

Keep the portal FD and safe CPU-buffer fixes, then validate capture of an existing source on
hardware. If another Linux capture backend is required, it must still capture an existing
session and fit PetPlay's cross-platform capture interface. Do not build a compositor, an owned
desktop session or DroidFrame desktop support as a prerequisite.

## PetPlay changes indicated by the source audit

The following findings describe the helper at `58c6fc2`, before the current implementation work.

1. **Use the portal's PipeWire remote.** The vendored portal binding declares
   `OpenPipeWireRemote` but never calls it. `LinuxCapturer::new` retains only the returned node
   id, and `pipewire_capturer` uses `context.connect_rc(None)` against the default server.
   This can happen to work on permissive sessions but bypasses the access-scoped remote in the
   [ScreenCast contract](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html).
   Keep the portal session alive and connect PipeWire using its returned FD.
2. **Define a safe CPU buffer contract first.** `process_callback` dereferences the first plane's
   data pointer and copies `maxsize`, without validating pointer/type or using chunk offset,
   size and stride. Explicitly negotiate mapped MemFd/MemPtr, check bounds, and pack rows to the
   wire protocol's width × height × 4 layout. Handle or reject DMA-BUF safely. Merely setting
   `MAP_BUFFERS` does not implement arbitrary GPU buffer import.
3. **Make format negotiation match decoding.** The helper advertises RGB/RGBA/RGBx/BGRx, but the
   callback has no RGBA arm and the streamer drops RGB frames. Prefer BGRx/BGRA or implement all
   advertised conversions. The 4096 × 4096 maximum also needs reconsidering for larger workspaces.
4. **Represent the captured source, rather than assuming KDE outputs.** `workspaceDisplays.ts`
   only enumerates through `kscreen-doctor`; that is not Gamescope panel discovery. Carry stream
   size/source metadata and support a single portal-selected source when KScreen is unavailable.
   Keep any later per-app selector separate from physical-monitor layout/cropping.
5. **Allow capture-specific session configuration.** `ScreenCapturer` currently inherits all
   environment from PetPlay. Capture-session selection must carry the appropriate bus and runtime
   without accidentally moving the OpenVR process into another session. Detect missing portals,
   cancellation and service errors explicitly; current “permission granted” and “Unsupported
   cursor mode” messages can precede an actual session-bus/service failure.
6. **Validate input independently.** The helper uses `/dev/uinput`, not the RemoteDesktop portal.
   Frame's `60/70-steam-input.rules` tag uinput for `uaccess`, making normal active-session access
   plausible, but access for the actual launch user/session and correct panel targeting need
   testing. KDE advertises RemoteDesktop; Gamescope's inspected portal does not. Do not assume
   replacing uinput with one portal input API covers both sessions.

At 1920 × 1080 × 4 × 60, raw pixel payload alone is about 498 MB/s (475 MiB/s), before the
helper's copies, TCP transfer and texture upload. This is a performance/battery consideration,
not evidence that capture cannot function. Establish low-rate BGRx correctness before DMA-BUF
optimization, multi-source UI or claims about Frame performance.

## Implemented locally and tested on native Linux

The v0.0.10 capture helper uses the portal's `OpenPipeWireRemote` FD, keeps the session connection
alive, waits for the selected source node to be visible on that remote, and explicitly requests
mapped MemFd/MemPtr buffers. The callback validates plane/chunk bounds, strips row padding and
converts BGRx/BGRA/RGBx/RGBA into packed BGRA. Portal setup failures return errors rather than
panicking. Helper-specific session overrides leave the parent's OpenVR environment unchanged.
The release includes an experimental ARM64 executable with the capture helper and raylib bundled.

The maintained [isolated capture test](../tests/linux_capture/README.md) passed twice with KWin
nested inside a separate Wayland compositor on this machine. Each run checked 25 frames at
960 × 720 through **real KDE ScreenCast portal → portal PipeWire FD → native helper → PetPlay's
TypeScript ScreenCapturer/receiver worker**. Red and blue regions and both changing center colors
matched exact BGRA samples. The default PipeWire remote was deliberately nonexistent; the parent
Deno process had a different bus address, preserved throughout the run. The helper received the
correct private capture session through the new overrides.

Test versions: KWin 6.7.5, xdg-desktop-portal 1.22.1, PipeWire 1.6.9. The desktop, bus, PipeWire,
policy-only WirePlumber and portal services were private test processes. Software rendering and
automated source selection replace the Frame GPU and interactive permission step. No host uinput
devices were created (`--no-input`). The compositor is a fixture; PetPlay remains a capture client.

Evidence: `_scratch/linux-capture/20261017-001421/result.json` and
`_scratch/linux-capture/20261017-001456/result.json`, with logs and captured `frame.png` files.
A separate virtual-backend control also passed with 25 frames. Seven Rust library tests, two
capture-process tests and PetPlay's filtered type-check also pass.
This establishes real native Linux pixel delivery, not Frame hardware compatibility. Gamescope's
portal, older Frame KWin/firmware, ARM64 execution of the revised helper, input targeting and
OpenVR presentation remain separate checks.

The initial test automation exposed a KDE chooser issue: Enter in its search field produced two
Start replies for one call with different node IDs; replacing the first stream made the returned
node unavailable. Tab/Space selects the existing output card once. This was a test-dialog issue,
not evidence of a PipeWire startup race in PetPlay.

## DroidFrame control result

The probe extracted **the helper embedded in CI run 38961923212**, source `456c655`, and attempted
real capture at 1 fps in the existing genuine Frame session. No desktop stack was installed or
new portal service started for this test.

- The diagnostic PetPlay launch inherited no `DBUS_SESSION_BUS_ADDRESS` and failed opening D-Bus.
- DroidFrame's existing private session bus was live. With that address supplied explicitly,
  the helper failed because `org.freedesktop.portal.Desktop` had no service/activation entry.
- The selected guest namespace had no portal frontend/backend binaries, no KWin and no
  `/dev/uinput`. The bus reported no portal name owner.
- Neither attempt reached source selection, PipeWire format negotiation or pixel delivery.
  An empty TCP receiver is not the failure here: the helper opens the portal before connecting
  to its frame receiver.

The missing inherited bus is a diagnostic launch-environment gap; it does not prove Steam's own
child processes lack the bus. Portal services and desktop support remain independently absent.
Results: `_scratch/frame-capture-2026-10-16/live-probe/result.json`. The available image's extracted
configuration inventory and inspected public source revisions are retained beside that evidence.

## Smallest useful next validation

The local portal/buffer fixes and native Linux pixel test are in place. On a real Frame, test one
changing Gamescope source through its normal portal at low fps, with known BGRx dimensions and
independent input checks. Test nested Plasma separately from its own session before adding
cross-session discovery.

DroidFrame currently lacks the capture services needed for this validation. Building those
services into the emulator is outside this work; prioritize a real-Frame-compatible backend and
isolated Linux protocol tests. PRoot also cannot grant Android kernel uinput privileges, so
emulated input results must remain separate from Frame input validation.

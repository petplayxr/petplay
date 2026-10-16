# Steam Frame integration investigation (2026-09-25)

For current experimental CI artifacts and the Quest/DroidFrame regression procedure, see
[Steam Frame testing](STEAM_FRAME_TESTING.md). The investigation below records the earlier
image/QEMU work; it is not the current device test status.

This is a compatibility investigation, not a headset certification. There is no Steam Frame
available for an end-to-end run yet. The checked recovery image is
`steamframe-oobe-repair-20260922.5153644-0.3.0.img.bz2`, SHA-256
`3a4a077f1b1f40688ab3279affcb56776bd97c54db1573e7c65fc52a97106676`.

## What the image establishes

- The recovery image is a 7 GiB GPT disk with an ESP, `efi-A`, a Btrfs `rootfs-A`, `var-A`, and
  `home`. `/etc/os-release` reports SteamOS `0.3.0`, build `20260922.5152327`, variant `vr`.
- The root has an ARM64 kernel (`6.18.0-gfbdbca41fd45`), a device tree named
  `sm8650-mp.dtb`, and Qualcomm U-Boot assets. The ESP has U-Boot files and **no**
  `EFI/BOOT/BOOTAA64.EFI`.
- The image contains native ARM64 SteamVR/OpenVR binaries, including
  `/opt/steamvr/bin/linuxarm64/vrserver`, `vrclient.so`, and `libopenvr_api.so`.
  `/usr/lib/libopenvr_api.so` links to the ARM64 library. It also has an ARM64
  `/usr/lib/libglfw.so.3`, but no raylib library.
- Petplay's bundled `resources/libraylib.so.550` and `resources/screen-streamer` are x86-64.
  `@gfx/dwm` 0.3.9 also bundles an x86-64 GLFW library on Linux unless `DENO_GLFW_PATH`
  points to a native library.

Valve documents [native Linux ARM64 deployment](https://partner.steamgames.com/doc/steamhardware/steamframe/loadgames)
and [OpenVR support on Frame](https://partner.steamgames.com/doc/steamhardware/steamframe/engines/custom).
The [recovery instructions](https://help.steampowered.com/en/faqs/view/65B4-2AA3-5F37-4227)
describe booting the USB image on a Frame or flashing the QDL package to a physical Frame.

There are two use cases to test on hardware. For **PC streaming**, Petplay stays on the x86-64
PC with SteamVR while Frame acts as the headset; the existing desktop build is the candidate.
For **standalone use**, Petplay and its native helpers run on the Frame itself; the ARM64 bundle
below targets that path. The recovery image only helps validate the standalone software stack.

## QEMU result

The recovery disk was attached read-only to QEMU 11.1.1's generic ARM64 `virt` machine with
EDK2 firmware. UEFI reported `No bootable option or device was found`. This is consistent with
the U-Boot and Snapdragon-specific boot assets in the image. QEMU does not emulate the Frame's
Snapdragon graphics, tracking, cameras, controllers, or compositor devices. A generic ARM VM
therefore cannot provide a full Frame integration test.

QEMU **user-mode** emulation did provide useful checks against the actual image libraries:

- A compiled ARM64 Deno executable ran against the image's glibc.
- Deno FFI loaded the image's ARM64 `libopenvr_api.so`; `VR_IsRuntimeInstalled()` returned
  `true`, while `VR_IsHmdPresent()` returned `false` in the emulated host environment.
- A source-built ARM64 raylib 5.5 library loaded through Deno FFI and returned graphics API
  version `4` from `rlGetVersion()`.
- The ARM64 screen-streamer binary resolves its PipeWire and D-Bus dependencies from the image.
- The cross-compiled Petplay server started its `--novr` actor graph under QEMU user-mode with
  the image's ARM64 GLFW library. This checks process startup and library loading, not VR
  presentation, GPU behavior, or capture portal interaction.

### Graphics emulation: a working Venus path

A separate Venus experiment reached further than library loading. On an x86-64 host with a
Radeon RX 7900 XTX, Mesa RADV, and kernel 7.2.6, virglrenderer 1.3.0's `virgl_test_server`
exposed the GPU to an ARM64 Venus ICD. QEMU user mode ran these ARM64 programs against the
mounted Frame root:

- The image's `vulkaninfo --summary` reported `Virtio-GPU Venus (AMD Radeon RX 7900 XTX
  (RADV NAVI31))`, driver `venus`, Vulkan API 1.4.343.
- The image's `vkcube --wsi wayland --c 30` rendered 30 frames and exited successfully.
- The image's `glxinfo -B`, using its `zink_dri.so` over Venus, reported OpenGL 4.6 and a
  `zink Vulkan 1.4(Virtio-GPU Venus...)` renderer.
- An ARM64 raylib 5.5 program opened a GLFW Wayland OpenGL 4.3 context, rendered a green
  rectangle into a 64×64 render texture, read it back, and checked the center pixel
  (`0,228,48,255`). This exercises the graphics API path Petplay uses to create overlay
  textures, but it does not submit one to SteamVR.
- The bundled ARM64 Petplay process ran `--novr --desktop` for 35 seconds with the same
  graphics environment. It created its scene, served a healthy `/health` response with the
  expected actors, and shut down cleanly on the test timeout. Desktop mode explicitly
  disables its OpenVR capture/display overlay path, so this is an application startup and
  desktop graphics check rather than a headset presentation check.

The initial locally built raylib embedded an X11-only GLFW. Under QEMU user mode, that build
reported evdev `Inappropriate ioctl for device` errors and failed window initialization. A
second build links the image's ARM64 `libglfw.so.3` (GLFW 3.4 with Wayland and X11 support).
That build passed the render-texture test and is now in the local `bundle/`. This changes the
bundle's runtime dependency to the Frame's `libglfw.so.3`, which the image contains. The
original build remains in `build-raylib-arm-clang/`; the working build is in
`build-raylib-arm-external/`.

The vtest path uses a Debian ARM64 Venus ICD alongside the Frame image, since the image ships
only the Freedreno Vulkan ICD. It is an API-level test, not a booted Frame OS. Mesa's
[Venus documentation](https://docs.mesa3d.org/drivers/venus.html) describes this vtest mode
and the separate requirements for a QEMU VM. The first prebuilt vtest attempt failed at
context creation; a locally built virglrenderer with `RENDER_SERVER_EXEC_PATH` pointing to
its own `virgl_render_server` passed both native and ARM64 clients. The local test sources
are `venus-glfw-smoke.c` and `venus-raylib-smoke.c` in the investigation workspace. With
the local dependencies and mounted image present, `run-venus-smoke.sh` repeats the Vulkan,
vkcube, and raylib tests.

### SteamVR process boundary

The Frame's `steamvr.service` starts SteamVR after `gamescope-session.service`. Its
`vrcompositor` is ARM64 and links OpenXR/OpenVR, OpenGL, DRM, X11, and SDL libraries;
`vrclient.so` links OpenGL and EGL. `vrserver` is primarily the runtime/device server.
Petplay creates OpenGL textures and passes a texture handle to OpenVR with
`IVROverlay::SetOverlayTexture`. The compositor must accept that handle in a compatible
graphics context; Venus alone cannot verify this handoff, display timing, tracking, or the
Frame's headset output. The image has a Frame HMD resource manifest and a CV driver, but no
ready-to-use null HMD driver. Valve's [OpenVR driver documentation](https://github.com/ValveSoftware/openvr/blob/master/docs/Driver_API_Documentation.md)
describes how a virtual HMD driver could supply device data to SteamVR.

Subsequent tests showed the OpenVR client/server split is viable for tracking and control.
With shared PID, network, and IPC namespaces and `/dev/shm`, an x86 client connected to
the ARM Frame `vrserver`, and an ARM Frame client connected to native desktop SteamVR
2.18.1. In both directions, `VR_Init` succeeded and a virtual HMD returned a valid pose.
This does not prove graphics-handle transfer. We also ran both ARM64 processes in one
QEMU **user-mode** environment to investigate the Frame compositor. No VM or guest kernel
is involved.

### Userspace SteamVR stack experiment

`bwrap` mounts the Frame root read-only, a disposable Steam home, private `/tmp` and `/run`,
the host render node, and the Venus vtest socket. An ARM64 build of Valve's
[simplehmd sample driver](https://github.com/ValveSoftware/openvr/tree/master/samples/drivers/drivers/simplehmd)
supplies a virtual HMD. QEMU 11.1.1 does not implement ARM Linux
`get_robust_list`/`set_robust_list` fully; a test-only preload shim satisfies SteamVR's
startup assertion. It does **not** provide robust-futex owner-death handling and must stay
confined to this disposable sandbox. The recovery root also lacks `steamclient.so`, which
both processes log, but `vrserver` continues and activates the virtual HMD.

This reached real SteamVR process boundaries: `vrserver` loaded the sample driver,
activated a tracked HMD, and accepted a `vrcompositor` connection. Without a virtual HMD,
`vrcompositor` stopped at `VRInitError_Init_HmdNotFound`. With one, it initialized its
Vulkan path. Stock ARM64 Venus 26.1.6 exposed the host RADV GPU but did not advertise
`VK_KHR_external_semaphore_fd`, one of the compositor's 21 requested device extensions;
`vkCreateDevice` failed. An attempt to use ARM64 RADV directly against the host render node
loaded the driver, but QEMU rejected AMDGPU ioctl `0x40206445` with `ENOTTY` during
`amdgpu_query_info(ACCEL_WORKING)`. Direct RADV is blocked at QEMU's device ioctl layer.

The [waydroid-nvidia vtest sync patch series](https://github.com/Shiro836/waydroid-nvidia/blob/main/docs/transport-design.md)
addresses the precise Venus extension gap. Its first Mesa and virglrenderer patches
applied cleanly to the project's pinned Mesa revision and our virglrenderer 1.3.0 source.
We built the patched host renderer and an ARM64 Venus ICD against the Frame root; only the
sync patches were applied, with none of the Android/NVIDIA allocation changes. The patched
Venus device advertises `VK_KHR_external_semaphore_fd`. An ARM64 probe queried
`SYNC_FD` as importable/exportable, created a Vulkan device with the extension, signaled a
semaphore, exported an already-signaled `SYNC_FD` (the valid `fd=-1` convention), and
imported it into another semaphore. `OPAQUE_FD` reported no import/export support. The
upstream patch copy initially hung on the `fd=-1` case because it passed that value to an
unbounded `sync_wait`; our local copy skips that wait. A pending, nonnegative sync-file FD
and `SCM_RIGHTS` transfer remain untested.

With that patched pair, the actual Frame `vrcompositor` **created a VkDevice** and graphics
queue. It then logged `No direct mode display`, failed to create an HMD window/swapchain,
and aborted at `pComputeQueue != VK_NULL_HANDLE`. Enabling its
`enableLinuxVulkanAsync` setting made it request a high-priority compute queue; the Vulkan
driver returned insufficient permission, so SteamVR disabled async support and reached the
same null-compute-queue assertion. A virtual display path and a safe way to provide the
expected compute queue are the next compositor startup problems.

There is a further overlay-specific limit. The compositor binary references
`GL_EXT_semaphore_fd`/`glImportSemaphoreFdEXT`; the
[Khronos extension specification](https://registry.khronos.org/OpenGL/extensions/EXT/EXT_external_objects_fd.txt)
defines only opaque-FD import for that OpenGL entry point. The patched Venus transport
supports sync-file FDs, not `OPAQUE_FD`. This suggests Petplay's OpenGL-to-compositor
overlay path will need an additional interoperable semaphore implementation, even if
compositor startup is fixed. The exact handle type in that path has not yet been observed
at runtime.

The local reproduction assets are in `/home/ellie/git/steamframe-emu/vr-sandbox/`:
`run-steamvr-userspace.sh`, `external-semaphore-probe.c`, sandbox configuration/logs, and
the `mesa-sync-src`/`virglrenderer-sync-src` patch copies. Start the matching
`virglrenderer-sync-build` vtest server, then set
`VR_VULKAN_ICD=/home/steamos/venus/virtio_sync_icd.json` when invoking the sandbox script.
These are experimental local artifacts, not a deployable SteamVR runtime. The next useful
integration test is a virtual display plus compute queue, followed by the ARM64 Petplay
OpenVR overlay probe and explicit sync/memory sharing tests. No full VM is needed for that
line of investigation; physical Frame graphics, tracking, capture, and controllers still
require device testing.

### Native SteamVR flat-panel route and immersive limit

The Frame's `/usr/lib/steamos/gamescope-session` starts Gamescope with `--backend openvr`
and a Steam gamepad UI overlay key. The installed x86-64 Gamescope has the same OpenVR
backend and VR overlay options. This may show the Frame's flat Steam panel in a Bigscreen
Beyond: desktop SteamVR owns the headset and compositor, native Gamescope presents a VR
overlay, and ARM64 Frame Steam/UI processes run under QEMU as clients of Gamescope's
Wayland/Xwayland session. It does not by itself show the immersive Frame VR environment.
The ARM OpenVR client/native server handshake already works,
including across Frame SteamVR 2.17.10 and desktop 2.18.1; an ARM Frame compositor/native
server pairing still stops after Vulkan device creation at direct display/compute queue
initialization. A visible overlay and the Frame Steam UI have **not** yet been tested.
For the immersive environment, static binary inspection narrows the render owner:
Frame's ARM64 `systemlayer` embeds `CSystemLayer`, scene graph, skybox, overlay, and GPU
rendering paths also present in its `vrcompositor`. The native desktop compositor has
those same named paths and VR gamepad UI message paths. Three sampled background images
are byte identical between the installations. Prism is disabled by default in both.
This makes native desktop SteamVR plus ARM Frame UI processes a plausible route to much
of the actual Frame environment. It remains unproven which features are Frame-specific,
whether the ARM processes can submit their graphics, and whether the full in-headset
experience matches. The next milestones are ARM UI process initialization, visible
graphics submission, and only then comparison of the complete environment and controls.
An initial `vrdashboard` experiment got as far as native `vrserver` accepting the real
ARM64 Frame dashboard as `VRApplication_Overlay` and assigning its Steam overlay app key.
The dashboard then requested a compositor. After fixing the isolated launcher's missing
Steam runtime path, the native compositor started and bound its IPC socket, but could
not lease a direct display from the forced virtual HMD
(`VRInitError_Compositor_CannotDRMLeaseDisplay`). The ARM dashboard exited with
`VRInitError_IPC_CompositorInvalidConnectResponse`. This is UI registration, not a
rendered frame.
The full ARM compositor and virtual-display route remains available for features the
native compositor cannot reproduce. The flat-panel Gamescope test is separate.

With the real Bigscreen Beyond driver registered in a separate private SteamVR home,
native `vrcompositor` leased the display, initialized its system layer and aurora skybox,
and reached `Startup Complete` while the ARM Frame `vrdashboard` was connected. The user
reported seeing a surrounding VR world in the Beyond before opening a menu. They
later clarified that their viewpoint was below the floor, rather than the image
being upside down.
The native dashboard started only after the ARM dashboard exited. This establishes live
stereo headset presentation in the hybrid configuration, but the visible skybox was
rendered by the native compositor using an asset byte identical to Frame's copy; it does
not prove Frame-specific UI pixels reached the HMD. The low viewpoint may be related
to the private test home's missing chaperone data, but that is not confirmed. The
private Lighthouse universe ID differs from the calibrated universe ID in the user's
normal SteamVR home, so copying the chaperone file alone would not restore the matching
room setup.

A static host wrapper bind-mounted over the Frame `vrwebhelper.sh` solved the QEMU
child-exec format error. With the staged Venus/Zink renderer, the ARM web helper connected
to native SteamVR, registered named overlay definitions, and started a CEF browser for SteamVR settings.
No rendered overlay has yet been confirmed visible in the Beyond, and a subsequent run
intermittently failed GLX visual selection. The next focused test is to stabilize that
graphics path and confirm a Frame ARM overlay paints pixels in the headset.

A 90-second Beyond test kept the ARM dashboard, ARM web helper, native server, and native
compositor running until the test timeout. The user saw a continuous world but no menu
when pressing the menu button, although controllers appeared. The processes did not crash. A persistent local launcher,
`/home/ellie/git/steamframe-emu/vr-sandbox/run-frame-world-beyond.sh`, now runs the
hybrid session without a timer and cleans up with Ctrl+C. It does not yet launch the
Frame Steam client (`-vrgamepadui`), whose package is present as a 668 MB archive in the
recovery image. The recovery image's Steam service launches this client after SteamVR,
while its ARM Gamescope session uses `--backend openvr` and
`--vr-overlay-key valve.steam.gamepadui.fallback`. These two components are the likely
missing menu path, alongside the unverified ARM
graphics-to-native compositor transfer.

The host's x86-64 Gamescope advertises the same OpenVR backend and overlay-key options.
Using native Gamescope with the ARM Frame Steam client could place the architecture
boundary at X11/Wayland while Gamescope submits the VR overlay natively. This is an
untested path for the gamepad UI; the immersive skybox and system layer would still be
owned by the native compositor.

The Frame Steam archive has been extracted in the local sandbox. A bounded
`probe-frame-steam-client.sh` launcher is staged but has not yet been run because the
normal desktop Steam client is active in the shared IPC namespace. A second private
Beyond home with the matching calibrated Lighthouse database and chaperone file is
ready for a future floor-height test; the current headset session was not restarted.

## Local build and bundle

`deno task build --target=aarch64-unknown-linux-gnu` produces `dist/petplay-aarch64`.
Cross builds deliberately do not embed the developer machine's `.env` file. A local bundle at
`/home/ellie/git/steamframe-emu/bundle/` contains that binary, ARM64 raylib 5.5, an ARM64
screen-streamer, and `run-petplay.sh`. The launcher sets the paths for those native libraries.
The bundle is a local test artifact, not a verified release.

The bundled raylib build used upstream tag `5.5`, Clang targeting `aarch64-linux-gnu`, LLD,
and the mounted Frame root as sysroot, with `PLATFORM=Desktop`, `OPENGL_VERSION=4.3`,
`USE_EXTERNAL_GLFW=ON`, and a shared library. The screen-streamer was built from
`/home/ellie/git/screen-streamer` for
`aarch64-unknown-linux-gnu`, using the same Frame root for pkg-config and Clang/LLD linking.
Both binaries resolve their dynamic dependencies against the image. Their rendering and
capture behavior on a physical Frame are untested.

## Physical Frame test plan

1. Enable developer mode and upload the bundle using the SteamOS Devkit Client's Linux ARM64
   runtime, or run it directly in a developer shell. Start `run-petplay.sh --novr --agent-repl`
   first; check `http://127.0.0.1:3987/health` and the server logs.
2. Start `run-petplay.sh --agent-repl` with SteamVR running. Confirm OpenVR initialization,
   HMD pose and display frequency, overlay creation, and a visible Petplay scene.
3. Open the desktop overlay and grant the ScreenCast portal permission. Check PipeWire frames,
   the raylib/GL overlay texture, cursor alignment, and input through `/dev/uinput`.
4. Exercise Frame controller bindings, wrist menu, virtual display placement, restart/detach,
   and performance. Petplay's current action manifest was written for other controllers.
5. Separately, stream PC VR to Frame and run the existing Petplay desktop build with SteamVR
   on the PC. Check overlay visibility, pose alignment, controller input, and disconnect/reconnect.

The Venus test reduces uncertainty about the ARM build's Vulkan/OpenGL render path on a
virtual GPU. The main remaining risks are the Frame's actual Freedreno/Zink capabilities,
SteamVR's overlay/compositor texture handoff on ARM, ScreenCast portal availability in the
headset session, uinput permissions, and controller mappings. These require a physical
device or a substantially more complete virtual SteamVR setup.

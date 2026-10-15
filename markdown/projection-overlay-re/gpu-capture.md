# A working compositor GPU capture and the remaining output check

Follow-up: [clean runtime output control and a mixed-generation draw](clean-gpu-capture.md).
The limitations below describe the initial compositor-only restart; the follow-up establishes
a working composed-image control and identifies an intentionally mixed projection draw.

Investigation on 2026-10-13; same [SteamVR BuildIDs](README.md). The user explicitly authorized
launching SteamVR as necessary. Capture and replay now work on the compositor, without changing
ptrace restrictions or installing a system-wide capture layer.

## What the capture establishes

A fresh immutable DMA-BUF image was rendered through GL, fenced, imported through public OpenVR,
and published on an isolated projection overlay. Its RGB generation byte was 1; an optional
single opaque marker had byte values **64/128/1/255**. The rest of the image had zero alpha.

In compositor frame **7465**:

- Event **63** is labelled `petplay.re.gpu-dmabuf.544352`.
- Event **69**, `vkCmdDraw`, is inside `RenderPass:TextureLayerResolve`.
- Its fragment-shader image descriptor binds captured resource **61673**, a **16×16
  B8G8R8A8_SRGB** image. These are RenderDoc resource IDs, not native/shared texture handles.
- Readback of that image at texel **14/14** gives linear RGBA approximately
  **0.0512695/0.21582/0.000303268/1**, matching the marked source bytes after sRGB decoding.
- The center texel is approximately **0/0/0.000303268/0**, matching the transparent generation
  byte elsewhere in the source.

This is direct pixel evidence inside the compositor's imported Vulkan image, attached to the
identified overlay draw. It improves on producer-only readback and changing CPU-record handles.
It does **not** show that a particular fragment sampled that marker or that the marker reached the
headset output. A descriptor binding alone is not a completed fragment/output measurement.

The same linkage appears in frame **20212**, with a new producer/overlay label
`petplay.re.gpu-dmabuf.545904` and sampled resource **163713**. That run used the public current
HMD pose rather than the earlier identity transform. The submitted pose began:

```text
 0.0595726   0.318557   0.946030  -1.55465
-0.0221969   0.947901  -0.317789   0.621565
-0.997977  -0.00206743  0.0635399  0.756543
```

Replay exposes the actual draw's 624-byte uniform block, and shader reflection decodes its
matrices/vectors. For example, `_child0` contains the same rotation components within its
projection-derived transform; `_child1` contains the current view transform. The shader names
are stripped, so these labels are generated reflection names, not semantic field names. The
buffer is saved as binary for further matrix reconstruction. **This is access to draw-time
constants, not a proof that texture and pose came from one publication generation.**

The draw writes attachment **729**, a 4900×4900 RGBA sRGB intermediate, with depth attachment
725. The later left scene/lens-distortion draw at **88** binds intermediate 729 and writes
swapchain image **153**, 5088×2544 BGRA UNORM. Event **90** clears the intermediate before the
other eye's pass. Reading it only at the capture's final event would therefore lose the earlier
eye's contents; inspection must select the intended draw/pass event.

## Composed marker: not established yet

The diagnostic's marked input texel was verified, but the inspected intermediate and output had
no nonzero-alpha colored marker pixels. Checks included draw 69, end of the overlay render pass
71, and the first distortion draw 88. A further frame **38861** used a center marker rather than
a corner marker; it still did not establish a composed marker.

Do not attribute this to pose/texture mixing, source overwrite, an incorrect publication boundary,
or a specific projection/shader defect. During this instrumented compositor-only restart, the
runtime also had stale shared-resource/semaphore references from the previous compositor, and
the user reported a black headset display. Those conditions invalidate this run as a positive
normal-output control. Producer image contents and binding observations remain explicit, but
we need a clean runtime/output baseline before using output absence to infer a mechanism.

Next acceptance check: capture a correctly visible diagnostic overlay in a **fresh full runtime
session**, verify its intermediate and final output pixels, decode its pose constants, then vary
image and pose generations deliberately. First establish a visible control; do not proceed straight
to interpreting mixed-generation failures under load.

## Capture tooling and environment

The regular Arch `extra/renderdoc` package was version **1.46-1**, built 2026-09-18. The alternative
Cachy package was built on the investigation date and was not used. The older package passed the
machine's three-day age policy, and `pacman-key --verify` confirmed its detached signature from
Campbell Jones. It was unpacked into session scratch, without root installation or global layer
registration. Version output reports commit `e4bd23b671d3d5a747ff5221dbe08a63eb6ca200`.

Matching public v1.46 replay headers were obtained from the
[RenderDoc repository](https://github.com/baldurk/renderdoc/tree/v1.46/renderdoc/api/replay).
The [target-control API](https://github.com/baldurk/renderdoc/blob/v1.46/renderdoc/api/replay/renderdoc_replay.h)
provides capture triggering; the
[application/capture documentation](https://github.com/baldurk/renderdoc/blob/v1.46/docs/behind_scenes/vulkan_support.rst)
explains Vulkan layer interception. This does not require attaching to an already running process
once the compositor starts with the layer.

The private manifest has its library path rewritten to the unpacked `librenderdoc.so`.
`VK_ADD_IMPLICIT_LAYER_PATH` adds this manifest without replacing the installed SteamVR fixes
layer. Treating it as an explicit layer using `VK_ADD_LAYER_PATH` caused extension errors in the
initial test. Enabling it through the private implicit path and loader enable filter worked.

A supported capture launch used only per-launch environment:

```sh
ENABLE_VULKAN_RENDERDOC_CAPTURE=1 \
VK_LOADER_LAYERS_ENABLE=VK_LAYER_RENDERDOC_Capture \
VK_ADD_IMPLICIT_LAYER_PATH=/tmp/petplay-projection-re-20261013/renderdoc-layer \
RENDERDOC_CAPFILE=/tmp/petplay-projection-re-20261013/compositor-layer \
STEAMVR_DISABLE_THREAD_WATCHDOGS=1 \
  /home/ellie/.local/share/Steam/steamapps/common/SteamVR/bin/linux64/vrcompositor-launcher.sh
```

This example is **not** a runtime restart script. All previous runtime processes must be stopped
first, and the launch must retain the normal SteamVR environment. The successful diagnostic also
used `VALVE_SKIP_RUNTIME_SAFETY=1` on a direct shell launch and SteamVR's `vrenv.sh`; the final
normal full-runtime startup uses SteamVR's normal Scout/runtime launcher. Capture changes timing
and may change render paths (SteamVR detects RenderDoc); its frame times are not normal pacing
measurements. Watchdog disabling is diagnostic and was not left enabled on the normal runtime.

### Two helpers

[`renderdoc-control.cpp`](tools/renderdoc-control.cpp) connects only to an explicitly supplied
local target ident and checks its executable name. It does not force another controller off the
target. It waits for a supported presenting Vulkan API message, requests one capture, skips old
capture messages using their timestamps, and prints the resulting capture path. Timestamp resolution
is one second: when reusing a target, avoid treating a capture created in the same second as the
request as proof of freshness; confirm its frame number and diagnostic overlay identity as well.
The recorded diagnostic files were checked against their distinct producer labels.

[`renderdoc-inspect.cpp`](tools/renderdoc-inspect.cpp) replays a saved capture and lists draw
labels, shader descriptor resources, uniform-buffer offsets and Vulkan attachments. With an event
and output prefix it decodes constants, saves bounded uniform data and exports RGBA8 textures at
that event. It reports source marker pixels and nonzero-alpha colored pixel bounds. These counts
are inspection diagnostics, not a shader-execution trace or automatic generation classifier.

Build from the repository root against the exact headers/library in use:

```sh
# Set RD_SOURCE to the extracted renderdoc-1.46 source directory and RD_LIB to its matching library.
g++ -std=c++17 -rdynamic -DRENDERDOC_PLATFORM_LINUX \
  -I"$RD_SOURCE/renderdoc/api/replay" markdown/projection-overlay-re/tools/renderdoc-control.cpp \
  -L"$RD_LIB" -Wl,-rpath,"$RD_LIB" -lrenderdoc -o /tmp/renderdoc-control
# Use the same flags for renderdoc-inspect.cpp.

/tmp/renderdoc-control 38920 vrcompositor
/tmp/renderdoc-inspect capture.rdc 69 /tmp/overlay-event69
```

The source paths above are relative to the repository root. `-rdynamic` is required
for the executable's replay marker to be visible to the library. Omitting it made the first replay
helper initialize as a capturing application and crash; the corrected helper passed both cube and
compositor replay. `GetAPI()`'s initial empty string is not a live readiness signal: use the
`RegisterAPI` message. Also, a reconnect delivers previously saved captures; returning the first
`NewCapture` message initially printed an old path. The timestamp filter and explicit producer-label
check were used for the new captures described here.

The GPU publisher's optional `PP_GPU_VISIBLE_MARKER=1` paints one opaque texel at 14/14;
`PP_GPU_MARKER_CENTER=1` moves it to 8/8. `PP_GPU_POSE_CURRENT=1` submits a public current HMD pose.
Defaults remain the earlier transparent identity-pose diagnostic. Diagnostic delays hold the
image long enough to capture; they are not publication/retirement criteria.

## Runtime recovery and state left behind

Replacing only the compositor invalidated old compositor-owned resources while clients and
vrserver stayed alive. Import errors referenced handles ending in the old compositor PID's low
bits (`0x8559`). The clean full-runtime restart resolved the black-display state; the user
confirmed **"Display works again"**. PetPlay relaunched with the fresh runtime.

A launch retry also revealed an early-exit race: `main` at `0x28c710` checks the named `vrcompositor`
instance guard through `0x3aac60` and returns zero when it cannot proceed. Launching immediately
following SIGKILL can arrive before the old process has exited. Waiting for the old PID to disappear
allowed the instrumented launch to initialize. Do not diagnose that early zero exit as a capture
compatibility failure without checking the instance guard.

An early exploratory launch briefly modified `vrcompositor-launcher.sh` to bypass its capability
proxy. It was restored before the successful capture. The successful capture retained the normal
proxy and installed refresh-only SteamVR fixes layer. Final launcher SHA-256 matches the saved
pre-investigation script: `e1f429d8517c7e68352582182472830ebbaed3da0626fe84b551529d4dc1cadb`.
No native binary, ptrace policy, global Vulkan setting or production pacing source was changed.
No commits or uploads were made. Tracefs is off. Normal final server/compositor PIDs at verification
were **550934/550991**, distinct from instrumented PID 543181.

## Saved evidence

Session scratch `/tmp/petplay-projection-re-20261013/` contains:

- `cube_frame120.rdc`, `cube-vrenv_frame5.rdc`, `cube-forced_frame137.rdc`: capture/replay controls.
- `compositor-layer_frame1053.rdc`: compositor baseline.
- `compositor-layer_frame7465.rdc`, `gpu-capture-marker2.api.txt`, `marker-capture2.inspect.txt`.
- `compositor-layer_frame20212.rdc`, `gpu-capture-current.api.txt`, `current-pose69.inspect.txt`,
  `current-draw69.inspect.txt`, `current-draw88.inspect.txt`, `current-pass71.inspect.txt`.
- `compositor-layer_frame38861.rdc`, `gpu-capture-center.api.txt`, `center-pass71.inspect.txt`.
- Event-specific exported PNGs and uniform `.bin` files with the corresponding prefixes.

`compositor-layer_frame5202.rdc` was a separately produced baseline-like capture; the first
controller output returned the previously saved frame1053 path instead. It is not the marked-image
measurement. Native Vulkan image handles still need exact import-return correlation when doing
rapid generation comparisons; RenderDoc resource IDs must not be numerically equated with them.

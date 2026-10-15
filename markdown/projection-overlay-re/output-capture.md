# Where to measure the pixels

Follow-up on 2026-10-13, same [BuildIDs](README.md). No compositor restart, injection, production
pacing change, or completed headset pixel-generation test in this investigation.

## Public mirror: no image is published to the reader

The earlier GL mirror error 102 is now localized. A client uprobe at ELF `0x34e77a` observes the
shared handle passed to the GL importer. It is **zero**, before import is attempted. This is not
evidence of a bad producer texture, unsupported pixel format, or an import synchronization race.

The new C++ probe uses the current public `IVRCompositor_029` header and a working hidden EGL/GL
context. It calls `GetMirrorTextureGL(Eye_Left)` before and after `ShowMirrorWindow()`. Both return
102 with zero texture ID and null shared handle. The mirror remains reported invisible; the
probe restores its initial visibility state. An earlier hidden raylib context has the same result.
OpenVR also attempts to launch vrmonitor, which exits with missing `libQt5Multimedia.so.5` in the
probe's environment. No claim is made that fixing that launch would create the missing GL mirror.

The client reads mirror handles from client-state `+0x480/+0x488` at `0x34e756`, under its shared
guard. The compositor publishes them at `0x165c6d/0x165c84`, using `0x1743d0`, which returns
compositor `+0x21cd0 + eye*0x18`. Initialization creates the corresponding mirror textures at
`0x1ada30..0x1ada82`, using renderer methods `+0xd0` and `+0x140`.

That initialization branch is gated by `compositor +0x25600 == 0` at `0x1ad05b/0x1ad063`.
Do not change this private pointer or infer that a public visibility setting controls this branch.
The meaning of every driver/configuration alternative is not yet audited. The observation is
specific to the current runtime path; it does not establish that every Linux setup lacks mirrors.
The previously audited mirror lock/unlock methods remain no-ops, so successful import alone would
still not supply an output-completion fence.

## Public image dump: synchronization stub on the selected path

`IVRCompositor_029::CompositorDumpImages` sends message `0x207` through client `0x356290`.
The compositor's handler `0x26abc0` sets a request flag at its context `+0x1f9`. Live probes show
that request reaching the render thread: `0x164c4d` observes the flag, `0x265b20` constructs the
screenshots directory, and `0x16536d` invokes `0x176000` with a timestamped output path.

For example, the captured path was:

```text
/home/ellie/.local/share/Steam/steamapps/common/SteamVR/screenshots/2026-10-13-PM_10_53_23
```

The **selected Linux implementation at `0x176000` ignores that filename**. Its assembly enters a
`DumpTextures` debug scope, reads shared-state `+0x1ac/+0x1b4`, invokes `0x175ef0`, restores the
scope, and returns. It does not call image-copy/readback or file-writing functions.

The helper is synchronization, not image readback. Its renderer `+0x1f0/+0x210` methods resolve
live to `0x3dfad0/0x3df1f0`. The former imports a shared synchronization object; the latter adds a
wait through `0x43b750` and invokes renderer `+0x250`. The helper's first argument was zero in the
captured run, so that conditional renderer wait was not called. Do not label these arguments as
scene images or treat this helper as a host GPU-completion fence.

The active scene-focus and last-renderer PID both returned 134667. Thus the absent dump is not
explained by an API report of no active scene renderer. No image output was obtained from the
request. This is an audit of this selected binary function, not every screenshot facility or
platform implementation.

## Next experiment: compositor GPU capture

The public output paths tested here do not produce a sampleable image. A Vulkan overlay view
could still be useful for checking imported source pixels, but its input readback would not prove
what the compositor rendered. The missing measurement needs the compositor's GPU commands and
output, with these explicit acceptance criteria:

1. An isolated projection overlay publishes fresh immutable images containing a generation marker.
   Producer GPU completion is checked before publication, using the existing DMA-BUF probe.
2. The capture identifies the actual overlay draw, descriptor/image view, and underlying image.
   Compare that image with the actual import-return mapping, not just the changing CPU record.
3. Read the captured image's marker and inspect the draw's composed output. Distinguish producer
   source, intermediate overlay render target, mirror, and final eye output.
4. Correlate the draw's matrix and eye with the pose snapshot and generation. Start with a fixed
   image/pose for identification, then deliberately change generations and pose under load.
5. Use the capture tool's replay/readback completion. `WaitFrameSync`, API return, frame timing,
   mirror access locks, and an elapsed millisecond delay are not GPU-output completion evidence.

An output-visible marker is required for the composed-output check: the current diagnostic has
alpha zero and cannot establish a visible generation by inspecting the final eye output. A new
marker test should be small and isolated, and preserve the ordinary overlay's state.

RenderDoc and Frida executables are absent from PATH. Ptrace remains restricted. Uprobes observe
CPU arguments and timings, but cannot issue GPU readback commands. The installed Vulkan layer
inventory includes Mesa screenshot and an existing SteamVR Linux fixes layer; listing a layer
is not evidence it is enabled or that its swapchain capture includes the projection-overlay draw.

A launch-time capture/layer would require a separate instrumented compositor session. Any such
experiment must preserve the existing fixes layer, avoid changing global loader settings, and
restore the normal launch environment afterward. No layer was installed, enabled, or injected,
and the live SteamVR session was not restarted in this investigation.

## Reproduce the public-path findings

From repository root:

```sh
g++ -std=c++17 -I/home/ellie/git/openvr/headers \
  markdown/projection-overlay-re/tools/public-readback.cpp \
  -lgbm -lEGL -lGL -lopenvr_api -o /tmp/public-readback
bash markdown/projection-overlay-re/tools/public-readback-probe.sh \
  /tmp/public-readback /tmp/public-readback
```

The C++ diagnostic reuses the hidden EGL context helper from `dmabuf-gpu-probe.cpp`; it does not
run that publisher or create an overlay. It briefly requests the public mirror window, restores
its initial visibility, and requests a public image dump. The shell script refuses active tracing,
removes only its own probes, and leaves tracing off. Offsets are build-specific executable-file
offsets, ELF vaddr minus `0x1000`; that conversion does not apply to every ELF segment.

Session evidence: `/tmp/petplay-projection-re-20261013/mirror-handle.{trace,api.txt}`,
`public-dump.{trace,api.txt}`, `public-readback.{trace,api.txt}`, and
`public-readback-targets.{trace,api.txt}`. The first scratch mirror invocation failed before the
API call because its Deno config was missing; the corrected invocation uses the repository config.
A scratch probe at `0x165366` was before the path load; the saved probe uses the call at `0x16536d`.
Do not use the earlier value as a pathname observation. Read-only Ghidra export:
`decomp/265b20_redo.c`; the decisive dump-body and renderer-method checks use objdump.

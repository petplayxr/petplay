# ARM64 raylib

`deno task build:raylib` downloads raylib 5.5 from upstream, checks its SHA-256, and applies
`external-glfw.patch` to the official `build.zig`. The patch adds external GLFW linkage and
optional target library search paths. Raylib C sources are unchanged. The original build and
source license are in the verified archive; the notice is also shipped in `resources/licenses/`.

Use **Zig 0.13.0**, the version supported by that release's build API. `PETPLAY_ZIG` can select
an executable without changing your normal Zig installation. CI installs this version on the
Ubuntu ARM64 runner. Both CPU architectures use Zig's generic target CPU defaults.

```sh
# Native Linux build, with GLFW 3.4 development libraries installed:
deno task build:raylib
# Cross-build on x64 with a target sysroot containing usr/lib/libglfw.so:
deno task build:raylib --target=aarch64-unknown-linux-gnu --sysroot=/path/to/arm64-sysroot
```

The sysroot supplies target GLFW libraries (including its development symlink); Zig supplies
its GNU libc headers and stubs. This is not an Android/Bionic or musl build. Do not point it at
host x64 graphics libraries. The result is `dist/native/<Rust target>/libraylib.so`, shared,
OpenGL 4.3, with audio and the standard raylib modules enabled. GLFW/OpenGL remain runtime
libraries (GLFW 3.4+), supplied by Steam Frame rather than embedded or copied out of its system image.

`deno task build --target=aarch64-unknown-linux-gnu` builds and embeds raylib automatically.
For that complete cross-build set `PETPLAY_RAYLIB_SYSROOT` as well as the separate Cargo
linker/pkg-config configuration needed by screen-streamer. Native ARM64 CI needs neither
cross-toolchain setup. Desktop x64/Windows retain their existing bundled raylib libraries.

The ARM64 job boots the actual compiled executable under Xvfb/Mesa, checks a live scene and
raylib window, runs the embedded capture helper's version probe, then checks clean shutdown.
This verifies software OpenGL and packaging; real Steam Frame GPU/controllers and portal
capture still require device testing.

Ubuntu 24.04 ships GLFW 3.3, which lacks raylib 5.5’s `glfwGetPlatform` API. The ARM64
CI job therefore builds a hash-verified GLFW 3.4 X11 fixture with CMake for linking and the
Xvfb test only (`build-ci-glfw.sh`). That fixture is not embedded in PetPlay or uploaded.
Steam Frame continues to supply its own GLFW implementation.

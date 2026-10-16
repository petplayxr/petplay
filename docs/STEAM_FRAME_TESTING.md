# Experimental Steam Frame builds and testing

Updated 2026-10-16. The initial deliverable is a compiled Linux ARM64 artifact and regression
coverage. Raylib and capture helpers are embedded; physical Steam Frame certification is pending.

## CI artifacts

`.github/workflows/ci.yml` runs on main pushes, pull requests and manual dispatch. It checks
types with the project's vendor filtering, runs `deno test -A --no-check classes utils`, and
runs the smoke playtest under Xvfb/software OpenGL. It compiles three artifacts with Deno 2.9.7:

| Artifact | Executable |
| --- | --- |
| `petplay-windows-x64` | `petplay.exe` |
| `petplay-linux-x64` | `petplay` |
| `petplay-linux-arm64-experimental` | `petplay-aarch64` |

Artifacts expire after seven days. Downloaded Linux executables may need `chmod +x` because
GitHub artifact uploads do not preserve executable modes. The existing `v*` tag release workflow
reuses these checks/builds before publishing the Windows/Linux x64 executables and `SHA256SUMS`.
ARM64 remains a clearly labelled experimental CI artifact while device validation continues;
normal releases still publish desktop executables only. Local changes to these workflows do
not run or publish them.

The cross build omits the developer `.env`. ARM64 raylib 5.5 is now source-built with pinned
Zig 0.13.0, the official upstream recipe and a small external-GLFW patch, then embedded and
selected automatically. `PETPLAY_RAYLIB_LIBRARY` remains an override. The capture helper is now built from the pinned screen-streamer
submodule and embedded in the executable; `PETPLAY_SCREEN_STREAMER` can override it. The genuine Frame
runtime supplies OpenVR and GLFW. See [the integration investigation](STEAM_FRAME.md) for native
build details. The x86 binaries embedded in `resources/` are not ARM64 substitutes.

| Component | Current ARM64 status |
| --- | --- |
| PetPlay executable | Cross-compiled by CI; application modules and resources embedded |
| raylib 5.5 shared library | Built with Zig on the ARM64 runner, external GLFW/OpenGL 4.3; embedded |
| screen-streamer capture/input helper | Source-built with Cargo in CI and embedded for each target |
| GLFW / OpenGL / OpenVR | Supplied by the Frame runtime; use native ARM64 libraries |

The earlier Quest test bundles reused `/home/ellie/git/steamframe-emu/bundle/libraylib.so` and
`screen-streamer`; those runs predate source-built helper embedding. New executables embed both
helpers and select ARM64 raylib automatically; end users do not compile them. GLFW/OpenGL/OpenVR
remain supplied by the headset. The raylib license is included in resources. Local ARM64 cross
builds require Zig 0.13.0 and `PETPLAY_RAYLIB_SYSROOT` for target GLFW, plus a configured Cargo
ARM64 linker/sysroot and pkg-config environment;
CI builds natively on an Ubuntu 24.04 ARM64 runner to avoid that cross-linking requirement. The optional experimental C++ overlay presenter is a separate opt-in
build and was not used by the Quest runs.

The ARM64 job also boots the compiled executable outside the checkout under Xvfb/Mesa, checks
the scene, creates an OpenGL window/render texture through bundled raylib, executes the embedded
capture helper’s version probe and checks shutdown. See the [raylib recipe](../utils/native/raylib/README.md).
This is a software-rendering/package test; Frame GPU and live portal capture remain device gates.

Native Frame controller defaults are documented in
[Steam Frame controller bindings](STEAM_FRAME_CONTROLLERS.md).

## Local regression checks

```sh
deno task preconf
deno install --allow-import
deno task check
deno test -A --no-check classes utils
deno task playtest smoke
deno task playtest                 # all interaction suites
deno task build --target=aarch64-unknown-linux-gnu
```

The playtests need an accessible X11/Wayland session and OpenGL. Set the session's `DISPLAY`,
`XAUTHORITY` and/or `WAYLAND_DISPLAY` when running from an agent shell without them. For a
headless machine, use the CI Xvfb command. `LIBGL_ALWAYS_SOFTWARE=1` exercises software OpenGL.
The runner isolates settings/layout and writes its reports under `logs/playtest/`.

## Quest / DroidFrame

Use the **DroidFrame** engineering app's genuine ARM64 Frame runtime, with its existing Quest
tracking/graphics bridge. The separate DroidDeck installation is not this test environment.
No synthetic HMD driver replaces the Quest driver. `petplay_ovrdriver` remains a separate Linux
x86-64 pose/pacing test rig; it currently has neither a verified ARM64 ABI nor scripted buttons.

PetPlay includes an explicit `droidframe_quest` engineering binding. It maps analog trigger and
squeeze to click/grab with hysteresis, plus thumbsticks, face-button modifiers and haptics.
Runtime staging copies this binding beside the action manifest. An `oculus_touch` binding alone
does not activate these controls. This workaround does not establish native Frame-controller
fidelity; that follow-up is tracked in DroidFrame's
`droidframe/issues/steam-frame-controller-fidelity.md`.

The existing external tooling is in `/home/ellie/git/steamframe-emu/droidframe/tools/`.
Use `_scratch/` for agent artifacts; PetPlay owns the repo-local `tmp/`.

1. Run `droidframectl --serial <quest> launch`, then inspect `launch-state`. Require `RUNNING`,
   a live guest and fresh images **before** starting PetPlay. A live process or an old XR snapshot
   alone is insufficient. On stale XR ownership, use scoped stop; if that cannot finish, recover
   the DroidFrame app before starting a fresh session.
2. Build the ARM64 executable and package it with the previously built, explicit native inputs:

   ```sh
   python /home/ellie/git/steamframe-emu/droidframe/tools/package-petplay.py \
     --source "$PWD" \
     --native-bundle /home/ellie/git/steamframe-emu/bundle \
     --frame-libs /home/ellie/git/steamframe-emu/droidframe/.local/petplay-retained-trace-20261007/frame-libs \
     --output _scratch/frame-candidate
   ```

   The packager records source revision/status, helper provenance, ELF architecture and hashes.
   Native helpers are reused, not rebuilt. The Frame-library closure is a local engineering
   dependency for this test bed, not a proposed redistributable release bundle.
3. Run bounded tests sequentially against that same session:

   ```sh
   python /home/ellie/git/steamframe-emu/droidframe/tools/test-petplay-quest.py \
     --normal-launch --serial <quest> --bundle _scratch/frame-candidate \
     --output _scratch/frame-novr --hold-seconds 15

   python /home/ellie/git/steamframe-emu/droidframe/tools/test-petplay-quest.py \
     --normal-launch --serial <quest> --bundle _scratch/frame-candidate \
     --output _scratch/frame-vr --vr --hold-seconds 20

   python /home/ellie/git/steamframe-emu/droidframe/tools/test-petplay-quest.py \
     --normal-launch --serial <quest> --bundle _scratch/frame-candidate \
     --output _scratch/frame-vr-js --vr --hold-seconds 10 --playtest smoke
   ```

   Each output directory must be new. The harness binds the saved profile's adapter/display
   assets and preserves the shared-sync contract, isolates PetPlay settings/layout, and records
   readiness, activity and shutdown separately. It requires staging space plus 256 MiB headroom.
   Reuse the staged hash in the same guest profile rather than copying the executable repeatedly.
   Obsolete bundles under inactive profiles can be removed when space is needed; preserve active
   and rollback runtime selections and Steam state.

The no-VR control requires advancing scene frames and clean exit. VR additionally requires a
ready OpenVR client, a ready renderer and advancing overlay uploads. Accepted uploads do not
prove visible headset pixels, stereo correctness or latency. Desktop capture/portal access,
physical controller bindings and long sessions remain independent checks.

## JS interaction on a live session

Synthetic hands are supported with live IVRInput. The harness writes pose/button/stick state
immediately before the production controller bridge consumes it, then restores the original
bridge. This tests scene interaction while keeping the actual runtime and presentation path.
It does not validate the physical controller bindings.

Compiled artifacts include `utils/playtest.ts` and `tests/playtest/`. `/eval` in `webxr` exposes
`moduleUrl` (the worker's own module URL), so imports resolve inside the compiled snapshot:

```js
const p = await import(new URL("../utils/playtest.ts", moduleUrl).href);
const script = new URL("../tests/playtest/smoke.ts", moduleUrl).href;
const { steps } = await import(script);
try {
  for (let i = 0; i < steps.length; i++) {
    const result = await p.runPlaytestStep(host, script, i);
    // Record result.ok, notes and failures before advancing.
  }
} finally {
  p.startPlaytest(host).stop();
}
```

Use a scratch PetPlay instance for mutating interaction tests. `overlay:perf --attach
--scenario=none` observes without replacing hands; explicit scenarios override them temporarily.

## Results on 2026-10-16

- Type-checking passes with the existing vendor filtering; 209 unit tests pass. The initial full
  desktop run passed all 12 playtest suites. Software-OpenGL smoke and keyboard tests pass again
  after the audio fix. Workflow syntax passes actionlint; hosted CI has not been run yet.
- The ARM64 compile passes. On Quest/DroidFrame, the no-VR control passes all six embedded JS
  smoke steps, advances scene frames and exits 0.
- With real Frame OpenVR, initialization, renderer readiness and advancing overlay uploads pass.
  A final uninstrumented 10-second health control exits 0 and passes. After fixing the audio
  crash, five of six live JS smoke steps pass; the window-settings assertion
  [remains open](../markdown/issues/live-frame-smoke-window-settings-does-not-open/README.md).
- A missing audio device previously led to `LoadSoundAlias` dereferencing an invalid sound.
  [Fixed](../markdown/issues/FIXED-unavailable-audio-device-crashes-sound-alias/README.md): audio
  failure leaves PetPlay running silently and delayed stop callbacks cannot touch released buffers.
- Native exit/shutdown faults [remain open](../markdown/issues/steam-frame-exit-segfault/README.md).
  The live JS run exits with SIGSEGV after cleanup. An instrumented run returned parent exit 0
  while logging a descendant fault in `vrclient.so`; the harness now rejects recorded native
  faults regardless of the parent's exit code. One clean short repeat does not resolve this.
- Desktop capture still exits 101 without a supplied D-Bus session. It is not a passing gate.
  These short engineering tests do not establish performance, visible pixels or physical Frame
  compatibility.

Full local artifacts are in `_scratch/steam-frame-2026-10-16/`; compact reproduction evidence is
attached to the local issues above. Four obsolete on-device PetPlay bundles were removed from an
inactive runtime, reclaiming 1.86 GiB without removing active/rollback runtime images or Steam state.

## Capture architecture follow-up

The [capture assessment](STEAM_FRAME_CAPTURE.md) inventories the image’s Gamescope/KDE portals,
nested desktop session, helper compatibility gaps and the live DroidFrame capture failure.
A working bundled-helper version probe does not establish ScreenCast frame delivery.

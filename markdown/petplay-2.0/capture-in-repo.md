# Track 1: Capture in-repo

## Today

- The capture helper's source is now the `submodules/screen-streamer` Git submodule
  (github.com/goodpuppies/screen-streamer, tracking `master`): Rust in `src/main.rs` on top of a
  vendored `scap` fork (`vendor/scap`). It uses PipeWire/portal on Linux, WGC on Windows, and
  `/dev/uinput` input injection on Linux (`input-linux`).
  - Registered 2026-10-16; the current Rust/Cargo changes and vendored fork are carried in the
    pinned submodule revision. The original `~/git/screen-streamer` checkout remains unchanged.
- `deno task build:native` compiles the helper; `deno task build` runs it automatically and embeds
  the target's executable. CI uses matching Windows x64, Linux x64 and Linux ARM64 runners.
  `resources/screen-streamer{,.exe}` have been removed. Source checkouts build the helper once
  before capture; runtime extraction and `PETPLAY_SCREEN_STREAMER` overrides work on ARM64 too.
- `screen-streamer/` also holds its own copies of `scclass.ts` and `frame_receiver_worker.ts`,
  and both have diverged from `classes/ScreenCapturer/`.
- Four capture-ish client classes sit in `classes/`: `ScreenCapturer` (live), `IpcCapturer`,
  `CefCap` and `WebCapturer` (the last two only serve dormant actors, see
  [dormant actors](../issues/dormant-actors-are-dead-weight/README.md)).

## Plan

1. Source registration and CI builds are done as a **submodule**, per the 2026-10-16 decision.
   Use `git submodule update --init --recursive` after cloning.
2. `classes/ScreenCapturer/` remains the canonical TS client. The duplicate TS in the helper
   repository is not part of PetPlay's runtime integration.
3. Done: `deno task build:native` runs `cargo build --locked --release`; `deno task build` embeds
   the target output. Native CI runners avoid ARM64 cross-linker setup.
4. Done: select the embedded target helper, with `PETPLAY_SCREEN_STREAMER` overriding it.
5. Done: [native helper and wire protocol](../../docs/CAPTURE_PROTOCOL.md).
6. Fold in the capture issues: reconnect, the fixed port, and orphaned helpers on Windows
   (`displayOverlayHost.ts:398`).
7. Delete or quarantine `IpcCapturer`/`CefCap`/`WebCapturer` once nothing references them.

## Done when

A fresh clone + `deno task build` produces a working capture helper on Linux x86-64, Linux
ARM64 (cross) and Windows. There are no binaries in `resources/` for it.

## Related issues

- [capture-receiver-has-no-reconnect](../issues/FIXED-capture-receiver-has-no-reconnect/README.md)
- [fixed-ports-collide-across-instances](../issues/fixed-ports-collide-across-instances/README.md)

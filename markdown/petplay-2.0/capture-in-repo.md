# Track 1: Capture in-repo

## Today

- The capture helper's source lives in a separate repo, `~/git/screen-streamer`
  (github.com/goodpuppies/screen-streamer): ~440 lines of Rust in `src/main.rs` on top of a
  vendored `scap` fork (`vendor/scap`). It uses PipeWire/portal on Linux, WGC on Windows, and
  `/dev/uinput` input injection on Linux (`input-linux`).
- PetPlay ships **prebuilt binaries** in `resources/screen-streamer{,.exe}`. They are x86-64
  only, and `displayOverlayHost.ts` (`getScreenStreamerPath`) copies them to `tmp/` at runtime.
  ARM64 needs `PETPLAY_SCREEN_STREAMER` set by hand (see `docs/STEAM_FRAME.md`).
- `screen-streamer/` also holds its own copies of `scclass.ts` and `frame_receiver_worker.ts`,
  and both have diverged from `classes/ScreenCapturer/`.
- Four capture-ish client classes sit in `classes/`: `ScreenCapturer` (live), `IpcCapturer`,
  `CefCap` and `WebCapturer` (the last two only serve dormant actors, see
  [dormant actors](../issues/dormant-actors-are-dead-weight/README.md)).

## Plan

1. Import the source with history: `git subtree add --prefix native/screen-streamer`, or a plain
   copy if the history isn't worth keeping. Use a directory, **not a submodule**: the goal is one
   checkout that builds.
2. Drop the duplicate TS in the imported tree. `classes/ScreenCapturer/` is the canonical client.
3. `deno task build:native` runs `cargo build --release` for the host target (plus an ARM64 cross
   target for the Frame), and `deno task build` depends on it. The built binary goes into the
   build output, so `resources/screen-streamer*` drops out of git.
4. Resolve the binary from the build output first, then `PETPLAY_SCREEN_STREAMER`. Remove the
   ARM64 throw.
5. Write down the wire protocol (TCP 12345, frame header, compression) in `docs/`, next to the
   code that speaks it.
6. Fold in the capture issues: reconnect, the fixed port, and orphaned helpers on Windows
   (`displayOverlayHost.ts:398`).
7. Delete or quarantine `IpcCapturer`/`CefCap`/`WebCapturer` once nothing references them.

## Done when

A fresh clone + `deno task build` produces a working capture helper on Linux x86-64, Linux
ARM64 (cross) and Windows. There are no binaries in `resources/` for it.

## Related issues

- [capture-receiver-has-no-reconnect](../issues/FIXED-capture-receiver-has-no-reconnect/README.md)
- [fixed-ports-collide-across-instances](../issues/fixed-ports-collide-across-instances/README.md)

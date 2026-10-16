# Bundled screen-streamer is a prebuilt x86-64 binary

Status: fixed 2026-10-16 (`utils/build-native.ts`, `petplay/displayOverlayHost.ts`)
Track: capture-in-repo

`resources/screen-streamer{,.exe}` are prebuilt from `~/git/screen-streamer`, and
`getScreenStreamerPath` (`petplay/displayOverlayHost.ts`) throws on Linux ARM64 unless
`PETPLAY_SCREEN_STREAMER` is set. Resolved by [capture in-repo](../../petplay-2.0/capture-in-repo.md).

The helper now builds from the pinned submodule for each target and is embedded in the compiled
executable. ARM64 raylib packaging remains separate from this capture-helper issue.

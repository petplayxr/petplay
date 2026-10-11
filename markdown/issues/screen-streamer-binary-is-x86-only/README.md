# Bundled screen-streamer is a prebuilt x86-64 binary

Status: open
Track: capture-in-repo

`resources/screen-streamer{,.exe}` are prebuilt from `~/git/screen-streamer`, and
`getScreenStreamerPath` (`petplay/displayOverlayHost.ts`) throws on Linux ARM64 unless
`PETPLAY_SCREEN_STREAMER` is set. Resolved by [capture in-repo](../../petplay-2.0/capture-in-repo.md).

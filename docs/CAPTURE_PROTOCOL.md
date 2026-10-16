# Native capture helper

Source: `submodules/screen-streamer`; canonical client: `classes/ScreenCapturer/`.
`deno task build:native` invokes Cargo with the submodule's lockfile and writes
`dist/native/<target>/screen-streamer` (`.exe` on Windows). `deno task build` runs this first,
then embeds only that target's helper in PetPlay. CI builds Windows x64, Linux x64 and Linux ARM64
on matching runners. The Rust compiler used by CI is pinned in the workflow.

At runtime `displayOverlayHost` extracts the embedded helper into PetPlay's managed `tmp/`
directory, under the stable process name `petplay-screen-streamer`. `PETPLAY_SCREEN_STREAMER`
overrides it. Source checkouts must build the helper once before using capture. No prebuilt
screen-streamer executables remain in `resources/`.

## Wire format

The helper connects to PetPlay's loopback TCP listener (default port 12345). Frames are raw
32-bit BGRA/BGRx pixels; no compression or format identifier is sent. Each frame begins with
four little-endian unsigned 32-bit integers:

| Offset | Field |
| --- | --- |
| 0 | Width in pixels |
| 4 | Height in pixels |
| 8 | Total payload bytes |
| 12 | Number of chunks |

Each chunk consists of its little-endian 32-bit byte length followed by that many pixel bytes.
Chunks are at most 256 KiB. The client must read exactly each field/payload length; TCP packet
boundaries do not delimit frames. Disconnection makes the client stop that helper so its owner
can restart it.

Linux input commands are newline-delimited UTF-8 on the helper's stdin:

- `M,x,y`: absolute pointer position, normalized to the captured workspace.
- `B,left|middle|right,1|0`: mouse press/release.
- `W,delta`: wheel steps.
- `K,scanHex,1|0`: keyboard press/release, with PC scan codes translated to Linux evdev.

Windows input is handled by PetPlay's Windows input sink instead. ScreenCast restore tokens are
stored separately in the path passed by `--capture-token-path`; they are not part of the stream.
Build/startup checks do not validate portal authorization, `/dev/uinput` access or real capture.

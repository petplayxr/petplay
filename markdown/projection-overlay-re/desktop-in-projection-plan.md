# Plan: draw desktop screens inside the projection image

Status: future plan (2026-10-15). Not started.

## Why

In projection-overlay mode every PetPlay pixel ends up behind PetPlay's own display screens,
which are separate SteamVR quad overlays. A live uprobe on vrcompositor showed the draw order is
not the cause: `DrawOverlays` (`0x187370`) draws the two screen quads and then the projection
overlay last in every pass, with sort orders 0 and 20 in the same category (see the overlay draw
order section of [README.md](README.md)). The projection layer still loses everywhere a screen
is, consistent with it being depth-tested as infinitely far (its sort distance is `FLT_MAX`).
No sort order or overlay flag changes that; `SortWithNonSceneOverlays` was tried and did nothing.

So in projection mode the screens have to be part of PetPlay's own image.

## Current pipeline

- The capture helper sends raw BGRA frames over local TCP to the display host process
  (`classes/ScreenCapturer`, `petplay/displayOverlayHost.ts` `deskCapLoop`). The whole workspace
  is one frame: 3840x1080 on the current two-monitor setup, about 16.6 MB, 30 fps by default.
- The host uploads it into one GL texture (`OpenGLManager.createTextureFromBgraScreenshot`),
  composites the mouse cursor on the GPU (`compositeCursor`), and points each display overlay at
  its crop with `SetOverlayTextureBounds`.
- In PetPlay's scene each screen is a depth-only stand-in mesh (`displayInstance/ui.tsx`, curved
  `createDisplaySurfaceGeometry`, 0..1 UVs, ray input for the mouse). The scene knows each
  display's workspace crop (`displayInstance/logic.tsx`).
- The raylib renderer's 3D materials are colour-only; textures are only used by the UI pass by id
  (`UI_TEXTURE_PATHS`).

## Steps

1. **Frame transport.** The display host also writes each frame and the cursor position into a
   double-buffered shared-memory region in `/dev/shm`, mapped through libc `mmap` over FFI, with a
   per-slot sequence number (seqlock). GPU sharing would avoid the copy but needs file-descriptor
   passing between sibling processes, which Deno cannot do without more FFI.
2. **Renderer texture.** The renderer process maps the region and uploads a new frame into a
   `petplay:desktop` texture when the sequence changes, then draws the cursor itself.
3. **Textured 3D materials.** The raylib renderer samples a material texture with a UV
   offset/repeat; a texture whose source is `petplay:desktop` resolves to the dynamic texture.
4. **Scene.** In projection mode each screen's stand-in mesh becomes visible with that material
   and its crop as UV offset/repeat. Curvature and mouse input already work on that mesh.
5. **Display host.** Hide the SteamVR screen overlays while projection mode is on.

## Main risk

Uploading 16.6 MB 30 times a second on the renderer's frame loop, roughly 2-5 ms against a
13.3 ms budget at 75 Hz. Use a pixel-buffer-object upload and measure renderer frame times before
and after steps 1-2, before touching the scene. Fallback: copy and upload only the crops the
visible screens use.

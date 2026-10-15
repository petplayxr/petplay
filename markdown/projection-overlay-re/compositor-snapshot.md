# Pose, texture, and event snapshots: follow-up RE (2026-10-13)

Target: the SteamVR build identified in README. All addresses below are objdump image virtual
addresses, **not** Ghidra's +0x100000 addresses. Both binaries' executable file offsets are
vaddr minus 0x1000 (verified with readelf).

## Result

**Projection pose and current texture are read in separate shared-lock acquisitions.** The
pose is copied into SteamVR's scenegraph first; the texture ring is consulted later when the
compositor constructs its render records. This is observable on RenderThread in the running
build. A producer update can cross that interval even if its API calls complete together.

The proposed separate IPC-thread texture-switch mechanism is unnecessary: `0x201` is
`VREvent_OverlaySharedTextureChanged` (513), not evidence of a compositor command that selects
a texture. The local OpenVR bindings name it explicitly. The parent investigation resolved the
client vcall to a shared event-ring enqueue; see its separate event-path notes.

**The earlier claim that pooled GL textures guarantee separate SteamVR shared images is also
unsupported for the normal GL path.** In the live capture, PetPlay's two projection overlays
used one unchanged compositor texture handle per eye for all 749 compositor frames, despite
667-ish producer texture/pose updates. Client slot selection uses free ring subslots, and the
GL allocation context includes the overlay index and selected subslot. A separate client cache
also compares the original source texture identity; that cached GL-import image must not be
confused with the final compositor-visible image. This keeps shared-image overwrite/synchronization an open issue.

## Static path and addresses

1. `PrepareForFrame`, compositor `0x24f410`, calls `PushUpdatesToScenegraph` at `0x24f4db`.
2. `PushUpdatesToScenegraph`, `0x239c10` (`standaloneoverlays.cpp:37`), acquires the shared
   guard at `0x239d4e` through helper `0x2bf890`, obtains state via `0x2bf900`, and iterates
   overlay slots. The projection-transform case (kind 8) is `0x23a040`.
3. For a non-interpolated projection transform, `0x23a06a..0x23a0cc` copies six 64-bit chunks
   of the shared matrix at `state + index*0x614 + 0x560c` into the overlay's scenegraph transform
   at `+0x94..+0xbc`, and copies tracking origin `+0x55f4` into `+0xfc`. The alternate ordinary
   transform case starts at `0x23a5ea`. Interpolation uses `+0x560c/+0x563c` at `0x23aa6e`.
   The guard is released later in this function (`0x23a99c` -> `0x2bf8a0`).
4. `ComputeSystemLayerParams`, `0x258950` (`systemlayer.cpp:1798`), calls scenegraph
   `BuildRenderLists`, `0x215860`, at `0x258c9d`. The scenegraph produces an internal overlay
   record containing its matrix at `+0x130`.
5. This function takes **another** shared guard at `0x259ff6`, obtains state at `0x259ffe`,
   and calls render-record builder `0x23f180` at `0x25a72f`. It releases that guard at
   `0x25a81a` -> `0x2bf8a0`.
6. `0x23f180` reads the current ring index from `+0x5570` at `0x23f202`, then the shared-image
   handle from `+0x548c + currentIndex*0x2c` at `0x23f408`. It stores the handle in the output
   render record at `+0x10`, ring index at `+0x18`, and copies the already-prepared internal
   matrix `input+0x130..+0x158` into `output+0x28..+0x50` at `0x23f629..0x23f66d`.

The last step copies pose and texture into one render record, but that does **not** make their
original client-state snapshots atomic. The matrix has already passed through the scenegraph.
The matrix-copy lineage through the scenegraph has not been fully typed in Ghidra; the distinct
actual shared-memory read sites and their order are verified by disassembly and live probes.

The shared guard helpers are `0x2bf890` (construct/acquire), `0x2bf900` (access shared state),
and `0x2bf8a0` (release). Disassembly of `0x2bf7e0` shows waiting on the guard's synchronization
object; `0x2bf8a0` calls its unlock vmethod. Some Ghidra functions are truncated at ordinary
calls incorrectly treated as no-return; objdump is the authority for the ranges above.

### Corrections to field meanings

- Transform kind is at **`+0x55f0`**, and projection sets it to 8 at vrclient `0x3afb8b`.
- `+0x55a0` receives **5 or 6** at `0x3afb85` (projection shape, selected by the final boolean
  argument), not the transform kind.
- `+0x5774/+0x5778` are compared against `0x3ef6c0`'s current-process identity, not against
  texture ids. Their ownership/access-control semantics need full confirmation.
- `0x416040` is a tiny SIMD **UV bounds interpolation** helper. It reads four floats from each
  argument and computes `min + (max-min)*uv`. `DoInputWork` (`0x250150`) reads the current ring
  UV bounds and calls it for input/raycast processing. Its late timing is not evidence of late
  image selection or GPU sampling.

## GL texture ring allocation differs from direct shared-texture submission

In vrclient `SetOverlayTextureXR` (`0x3b2d40`), the loop at `0x3b2f31` comparing a source handle
against existing ring entries is gated by a flag indicating a supplied native shared texture.
The ordinary GL import/copy path goes through **`0x3b30b0`** instead:

- `0x55fe20` selects a ring subslot. Its compositor equivalent `0x4160a0` iterates five entries,
  testing their per-entry lock arrays; it chooses an available slot rather than searching for
  the original GL texture handle.
- `0x3b3107..0x3b3118` constructs a cache key from
  `((overlayIndex << 4) & 0xff0) XOR selectedSubslot`. This is part of the allocation context;
  the parent investigation also found a source-identity cache comparison at `0x35a030`.
- `0x35fd90`, called at `0x3b317c`, imports/copies the supplied texture using that context.
  In the GL update path, `0x317919` calls a further copy helper `0x35b920` after the GL blit.
  The GL-import scratch image and final shared image are therefore separate objects to trace.
- `0x55fe90`, called at `0x3b2fc9`, publishes the shared handle and UV bounds and current index
  under the shared guard. Its compositor equivalent `0x416110` writes `+0x548c`, bounds,
  and `+0x5570`.
- The `0x201` event enqueue at `0x3b3024` is conditional on a boolean result at `[rbp-0x2f9]`.

The exact GL/Vulkan synchronization and lifetime rules inside `0x35fd90` still need investigation.
The live stable handle observation is sufficient to reject the previous assumption that each
pooled source GL texture necessarily owns a distinct compositor image in this workload.

## Live indexed capture

A 10-second capture recorded:

- shared projection pose reads at compositor `0x23a06a`, recording overlay index `%r13`;
- selected texture handles after the load at `0x23f410`, recording index `%r15`, handle `%ax`;
- client pose publication after the final matrix/bounds write at `0x3afc2a`, recording handle `%r12`;
- client texture publication after shared unlock at `0x3b2fd9`, recording handle `%bx`.

All compositor read probes ran on **RenderThread (tid 34227)**. PetPlay's corresponding client
updates came from `worker-11` (tid 428182; trace markers identify tgid 377888). Low 32 bits of
client overlay handles matched compositor slot indices 21 and 46.

| Overlay index | Paired frame reads | Pose-to-texture p50 | p95 | max | API-generation differences |
| --- | ---: | ---: | ---: | ---: | ---: |
| 21 | 749 | 0.261 ms | 0.564 ms | 2.127 ms | 4 |
| 46 | 749 | 0.238 ms | 0.510 ms | 2.087 ms | 1 |

Generation differences count per-overlay texture-publication API calls visible by the texture
read against pose-publication calls visible by the earlier pose read. They show a timing race,
**not** proof of exactly which pixel generation the GPU sampled. The two functions publish
independently, and the underlying selected image handle stayed constant throughout:

- index 21: `4857608045913` on every one of 749 reads;
- index 46: `4870492947801` on every one of 749 reads.

One concrete crossing for index 46, monotonic trace time in seconds:

```text
42796.574307  RenderThread  pose_read  index=46
42796.574384  RenderThread  PushUpdatesToScenegraph ends
42796.574412  worker-11     texture publication complete, overlay index=46
42796.574534  worker-11     pose publication complete, overlay index=46
42796.575016  RenderThread  tex_read index=46, handle=4870492947801
```

The compositor's pose for that record precedes the producer update, while its later texture
state/content can include that update. Client submission order in this capture is texture left,
texture right, then pose left, pose right. Some mismatches can therefore also arise from a
compositor snapshot between those separate client API calls.

The exact 10-second capture and analysis are retained locally in
`/tmp/petplay-re-snapshot/indexed.trace`, `pairs.json`, `capture.sh`, and `analyze.py`.
They are session scratch files, not durable repository artifacts. The earlier eight-second
trace with entry-point probes is `/tmp/petplay-re-snapshot/snapshot.trace`.

## Frame-pacing implications and remaining work

Avoid updating projection poses or publishing/copying texture content across the whole interval
from the projection-state copy through texture selection. The critical CPU state window is
narrower than "until GPU work finished," but that does not yet make an earlier submit safe:
these shared-image handles are being reused, so GPU ownership and blit synchronization matter.

`WaitFrameSync` is signaled after CPU snapshots and Vulkan submission. It is a candidate lower-
latency boundary for the **next** overlay frame only after shared-image lifetime/synchronization
is established. Its signal alone cannot be claimed to protect against overwriting an image
still being sampled. An 11–17 ms timing window remains an empirical policy until that is settled.

Next targeted questions:

1. Does GL path `0x35fd90` overwrite the shared image currently held in the compositor record,
   and what fences/semaphores serialize that with compositor sampling?
2. When/how are per-entry texture locks held, and does ordinary projection rendering ever hold
   one long enough to force a different free subslot?
3. What writes `+0x5574` (the new interface getter's selected index)? There is no literal
   `+0x5574` load/store in this compositor's text; aliases, bulk copies, or another process may
   write it. Its meaning cannot yet be called "last compositor-latched texture."

## Visibility and immutable overlay banks: investigated separately

**Correction from the bank experiment:** `+0x55d4` is the overlay input method, not
visibility. Client `0x3aed80` is `SetOverlayInputMethod`; its value is compared to 1 at
compositor `0x239ed8` and written to scenegraph node `+0xc0` for input behavior.

Actual `ShowOverlay` (`0x3b0600`) sets bit 3 of `+0x5a1d` at `0x3b06cd`;
`HideOverlay` (`0x3b04e0`) clears it at `0x3b05ad`. Both take the shared guard.
`PushUpdatesToScenegraph` reads this flag at **`0x23a130`**, under the same guard as
projection pose `0x23a06a`. For projection kind 8, the flag controls bit 0 of the
associated scenegraph nodes' `+0x18` flags: clear loop `0x23a178`, set loop `0x23a488`.
Kinds 4/5 have special visibility handling; this conclusion concerns projection kind 8.
Thus the shared-snapshot observation survives, but the former field/address explanation was wrong.

This supports investigating a hidden-bank publication design: fill a hidden overlay's pose and
texture completely, then show it and leave that bank's content immutable while visible. Its
visibility and pose become part of the same scenegraph snapshot. This is a **candidate design,
not a verified solution**. Important remaining questions include:

- whether a hidden bank can still be sampled from an earlier GPU submission when recycled;
- whether the separate Show/Hide calls can expose both banks or neither bank in one compositor
  snapshot, and how to switch both stereo eyes together;
- confirming the visibility flag's entire scenegraph-to-render-list lineage (the initial shared
  read is established, but full node traversal has not been typed);
- whether publishing texture on a hidden bank has any implicit visibility side effects.

Immutability can protect frame pairing without a machine-dependent delay, but bank retirement
and switching need their own explicit correctness proof.

A transparent, isolated four-overlay experiment confirmed independent view pins and captured
interrupted visibility switches. See [bank publication experiment](bank-publication.md).

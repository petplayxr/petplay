# Image lifetime: GL reuse versus direct public DMA-BUF submission

Investigated 2026-10-13 on the [documented BuildIDs](README.md). This found a useful **public
Linux submission path** for distinct immutable images, not a complete portable presenter.
Production code and live pacing are unchanged.

## Result

- Ordinary GL source changes, `ClearOverlayTexture`, and overlay handle recreation did **not**
  produce fresh compositor images in the isolated test: one final shared image was reused.
- Public `IVRIPCResourceManagerClient_003::ImportDmabuf` plus
  `TextureType_SharedTextureHandle` **did** preserve distinct image identities. Three imports
  produced three distinct compositor backend/native images, with no internal client Vulkan copy.
- On that direct path, backend last-use timelines advanced each compositor frame. Release queued
  the backend images, and completed Vulkan timeline checks preceded their destruction.
- This is backend resource-lifetime evidence, **not a public producer-buffer retirement signal**.
  Continuous bounded reclamation, GPU-rendered producer completion, and pose/image publication
  coherence still need proof. No headset pixel-generation result has been obtained.

## Backend destruction and GPU completion

Static lineage, ELF virtual addresses (uprobe offsets subtract `0x1000`):

| Site | Meaning established from code |
| --- | --- |
| `0x44d1e0` | `MarkInUse`: stores timeline at object `+0x10` and last-use point at `+0x18/+0x20` |
| `0x43a470` | tags command-buffer referenced resources from vector `+0x750..+0x758` |
| `0x44e090` | release: marks object released (`+0x28`), queues it by last-use timeline |
| `0x44e2a0` | resource-manager cleanup, checks completed timeline points before destruction |
| `0x44d340` | `IsInUse`, delegates to completion query `0x452760` |
| `0x452760` | Vulkan timeline wait/query with supplied timeout, returns true on success |
| `0x436eb0` | backend image destruction; asserts `!IsInUse()`, destroys image view and owned image/memory |

The completion query packs its point as `(use << 8) | signed-subpoint`, waits on timeline
object `+0x40`, and calls Vulkan through global `0x4e1e80`. Cleanup supplies timeout zero, so
it tests completion rather than sleeping for a chosen duration. `0x44e090` itself does not wait.

`FacetTexture` wrapper destructors `0x3dfce0` / `0x3dfd40` queue their backend image via
`0x44d3a0 → 0x44e090`, and release the imported shared-resource interface. Imported backing
memory/reference ownership is a separate chain; deferred backend destruction must not be
promoted into a proof that the producer may recycle its memory.

## Ordinary GL route: cached image reuse

[`overlay-lifetime.ts`](tools/overlay-lifetime.ts) uses its own projection overlay, hidden GL
window, and three texture sources. **Texels have alpha zero; overlay alpha is one**. This lets
the compositor import and use the image without a visible test image. Merely setting overlay
alpha zero prevented import in an initial run, leaving render-record wrapper pointers null.

The corrected run selected final shared handle `6025839150425` across:

1. Three source GL texture IDs.
2. Hide, ClearOverlayTexture, resubmit, Show.
3. Four DestroyOverlay/CreateOverlay cycles at slot 65, with different overlay handle serials.

222 record observations referenced the same backend object `0x55a3f656c110` and native image
`0x55a3f65a0210`. Its last-use point was tagged once at import (`2360402`, subpoint 1), not on
each subsequent observed use. It was released/destroyed near the isolated client's shutdown.

Likewise, the three-second production capture found no `MarkInUse` calls for PetPlay's two
known sampled backend objects. Their last-use fields stayed at `1986648`, subpoint 1, while
other resources were being tagged at current points around `2350573`. This negative result
concerns these specific objects/functions, not every indirect dependency or driver mechanism.
It does not prove a GPU use-after-free or identify the cause of judder.

The observations reject “new application GL texture” or “recreate the overlay” as a verified
fresh-image allocation strategy on this route/build. `ClearOverlayTexture` clears the published
handle but did not invalidate the client's allocation cache in this experiment.

### Null-pointer trace caveat

The first alpha-zero-overlay capture had `wrapper=0` and `backend=0`. Nested uprobe user-memory
fetch failures can leave meaningless downstream fields in trace output. Those fields must be
ignored. [`lifetime-summary.py`](tools/lifetime-summary.py) explicitly excludes null wrappers
and backend pointers. Record observation is also not proof that a GPU shader sampled pixels.

## Direct shared handles: public API test

[`dmabuf-probe.cpp`](tools/dmabuf-probe.cpp) uses only public OpenVR interfaces and GBM:

1. Query supported DMA-BUF formats/modifiers for `VRApplication_Overlay`.
2. Allocate a separate 16x16 ARGB8888 GBM buffer for each generation, explicitly using modifier 0
   (linear). CPU-map/write/unmap each buffer **before** import/publication.
3. Encode generation in the blue byte with alpha zero. Keep every buffer unchanged and retain
   all producer buffers/imports during the experiment.
4. `ImportDmabuf` returns a shared handle. Pass a pointer to that handle in `Texture_t`, with
   type **8**, `TextureType_SharedTextureHandle`, to public `SetOverlayTexture`.
5. Hide/clear/destroy the private overlay at the end, drop this client's resource references,
   shut down its client, and destroy its GBM buffers/device.

Initial `gbm_bo_create` returned modifier `DRM_FORMAT_MOD_INVALID` and import failed. Explicit
linear-modifier allocation succeeded. The runtime reported 11 supported formats and 11
modifiers for ARGB8888, including linear; do not assume these lists match other hardware.
The probe currently selects this machine's single render node `/dev/dri/renderD128`.

Three-generation capture, isolated PID 487590:

| Generation | Shared handle | Compositor backend | Record observations | Last-use tags |
| --- | --- | --- | ---: | ---: |
| 0 | `6047313986905` | `0x7f473c022740` | 32 | 16 |
| 1 | `6051608954201` | `0x7f473c012700` | 34 | 17 |
| 2 | `6055903921497` | `0x7f473c0241d0` | 32 | 16 |

Each had a distinct native Vulkan image **inside the compositor**. Their submitted handles were
published into ring slots 0, 1, and 2. The isolated producer had three publication calls and
**zero calls to the internal Vulkan copy helper `0x35b920`**. Do not compare raw Vulkan handles
between processes/devices.

All three backend images were released and destroyed during the capture. For example:

```text
47763.904421  release backend 0x7f473c022740, last use 2376457 / 1
47763.904576  poll that exact timeline point with timeout 0
47763.904580  Vulkan query result 0 (success)
47763.904590  backend image destruction
```

The other two images likewise had successful queries for last-use points `2376474/1` and
`2376490/1` preceding destruction. Unlike the observed GL route, each direct image's last-use
point advanced while the compositor selected it. This is meaningful resource-lifetime evidence,
but not a claim about all platforms/builds or a public observable permitting producer writes.

A 12-generation follow-up crossed the five-entry ring and observed all 12 distinct imported
images. It did **not** demonstrate bounded reclamation during continuous publication: no
observed backend destruction preceded the final publication, and only one relevant backend
destruction was seen within that capture. The probe intentionally retains producer buffers and
references; cleanup/caching needs a separate sustained lifetime audit. No finite pool size is
proven safe by this test.

## Pixel-generation verification: still open

The source buffers encode generation in RGB, but their alpha is zero. Their contents are known
from CPU writes; that does not show what the compositor shader sampled.

A separate public GL `AcquireOverlayView` reader
([`dmabuf-view.ts`](tools/dmabuf-view.ts)) attempted to read the imported DMA-BUF generation through
a hidden GL context. It returned **error 23** (`InvalidTexture`) on the first acquisition in this
configuration. The reader shut down normally without changing the publisher's overlay. This
failure does not mean the compositor failed to import the images—the compositor trace confirms
it did—and does not prove every view/device path is unavailable.

The earlier public mirror GL probe also failed, and its access lock/unlock methods were no-ops.
There is therefore **no completed compositor-output pixel readback test** here. A useful next
pixel experiment needs an actual compositor GPU capture or diagnostic readback that preserves
queue ordering and distinguishes source image contents from sampled generation. Adding a frame
ID to API traces alone cannot establish that.

## Reproduce

From repository root, with the current public header at the neighboring OpenVR checkout:

```sh
g++ -std=c++17 -I/home/ellie/git/openvr/headers \
  markdown/projection-overlay-re/tools/dmabuf-probe.cpp -lgbm -lopenvr_api -o /tmp/dmabuf-probe
bash markdown/projection-overlay-re/tools/lifetime-probe.sh /tmp/dmabuf /tmp/dmabuf-probe
python3 markdown/projection-overlay-re/tools/lifetime-summary.py /tmp/dmabuf.trace /tmp/dmabuf.api.txt

# Optional 12-generation diagnostic:
PP_DMABUF_GENERATIONS=12 bash markdown/projection-overlay-re/tools/lifetime-probe.sh /tmp/dmabuf-ring /tmp/dmabuf-probe

# Ordinary GL source/cache comparison:
bash markdown/projection-overlay-re/tools/lifetime-probe.sh /tmp/gl-lifetime
```

The capture refuses active tracing and removes only its own probes. Sleeps in these isolated
programs allow diagnostic observations; they are **not** retirement/pacing guarantees.
`PP_DMABUF_STAGE_MS` defaults to 220 and may be lengthened to run the failed public view test
against the printed publisher PID. The GL reader's timed acquisitions are diagnostic only.

Session evidence: `/tmp/petplay-projection-re-20261013/lifetime-active.trace`,
`lifetime-transparent.{trace,api.txt}`, `dmabuf-direct.{trace,api.txt}`, and
`dmabuf-ring.{trace,api.txt}`. Read-only Ghidra exports include `44d1e0_redo.c`,
`44e090_redo.c`, `44e2a0_redo.c`, `452760_redo.c`, `436eb0_redo.c`, and `3f9c10_redo.c`.

## Architectural implication

This public Linux path can supply distinct immutable image generations without the GL route's
extra compositor-visible copy. It deserves further investigation as the image transport.
For GPU-rendered frames, we must still establish completion of rendering into the DMA-BUF before
publication. We also need bounded memory reclamation without relying on diagnostic sleeps.

It does **not** solve the separate pose/texture snapshots or stereo publication transaction.
The rejected subview-parent approach still overrides independent eye projection. Keep those
requirements explicit; neither this successful import nor generic deferred destruction is a
complete all-workload presentation protocol.

The [GPU-rendered handoff follow-up](gpu-publication-handoff.md) establishes producer GL fence
completion, catches an early-release race, and tests replacing an immutable image followed by
a public FrameSync before releasing the previous producer import reference. Continuous
reclamation is observed on that path; reusing allocations and coherent pose/stereo publication
remain unproved.

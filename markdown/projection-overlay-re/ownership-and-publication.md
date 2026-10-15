# Ownership and publication, rather than a millisecond edge

Follow-up on 2026-10-13. This is the direction of the investigation, **not a completed portable
presentation algorithm**. The user's requirement is correct pacing across PCs and workloads;
11/12 ms tests are diagnostics only.

## Producer completion and compositor waits

Further client decompilation (with the erroneous no-return marking on pthread mutex calls
cleared in a read-only Ghidra session) resolves `0x35b920` and `0x35e0f0`:

- `CVRSharedGLTexture::Update` (`0x3175b0`) blits the application's GL texture into a scratch
  image, then signals a GL/Vulkan interop semaphore, or falls back to `glFinish`.
- `0x35b920` records another Vulkan image copy from that scratch image to the final shared
  output image. Its layout/queue-family transitions are `0x54f860 → 0x54f7e0 → 0x54f0e0`.
- `CVRCompositorSharedTextures::EndCommandBuffer` (`0x35e0f0`) submits this copy. Normal
  overlay submission reaches it with the third argument **zero** at `0x360d84`; the optional
  CPU GPU-fence wait is only on the nonzero branch at `0x35e590`.
- The submit at `0x35e477` waits on the input GL blit semaphore and signals a counting
  semaphore obtained from the final resource's semaphore object. It returns before the optional
  CPU completion wait, and the texture ring is then published by the surrounding API.

Five seconds of client probes captured 958 copies, 958 submits, and 958 publications across
PetPlay workers. Every captured submit had **one wait and one signal**, and every Vulkan submit
returned success. Copy-source and copy-destination native images were distinct in this process.
The native wait matched the GL blit semaphore recorded in the copy context. The counting signal
value advanced, whereas the binary input wait value was zero. All these assertions are within
one Vulkan device/process; raw Vulkan handles cannot establish resource identity across devices.

On the compositor, the final `vkQueueSubmit` call at **`0x43e481`** was probed, not just
`OnPreSubmit`'s input vectors. In a three-second capture, all 225 submits had:

- one wait: native semaphore `94162699555616`;
- two signals;
- neither PetPlay imported-image semaphore among the waits.

The two PetPlay final-image semaphore handles, resolved **inside the compositor process**, were
`139943659599920` and `139943659529520`. They were stable for 448 sampled records per eye.
The shared-image semaphore getter (`0x3f91a0`) had zero calls during this capture, as did the
previously probed generic shared-semaphore wait wrappers.

This is strong evidence that the observed ongoing compositor batch does **not explicitly wait
on either overlay image's producer-completion semaphore**. It is not an exhaustive proof about
all driver scheduling, implicit dependencies, cold imports, or other builds. It does not yet
prove which pixel generation the compositor sampled. Crucially, a `glFinish` *before*
`SetOverlayTexture` does not wait for the later internal Vulkan copy.

Mapping used to make the same-process comparison:

```text
render record +0x20 -> FacetTexture
FacetTexture +0x48 -> CSharedVulkanImage interface subobject
interface -0x68 -> main shared-image object (main vtable 0x4d4a18)
main object +0x40 -> semaphore object (vtable 0x4d4fe8)
semaphore object +0x58 -> imported native semaphore data
native semaphore data +0x10 -> VkSemaphore (getter 0x3f7f60)
```

The interface subobject's vtable is `0x4d4c48`; its virtual-base adjustment is -0x68.
Do not confuse a nested uprobe dereference of the main vtable with its first method pointer.
Session evidence: `/tmp/petplay-projection-re-20261013/copy-submit.trace`, `import-map.trace`,
`copy-submit-probe.sh`, `import-map.sh`, and `decomp/35e0f0_redo.c`.

## A public image ownership primitive: `AcquireOverlayView`

Local public OpenVR headers (`/home/ellie/git/openvr/headers/openvr.h:4633`) expose
`IVROverlayView_003::AcquireOverlayView` and `ReleaseOverlayView`. With a null native-device
argument, this build returns an OpenGL view using the caller's current GL context.

Runtime `_003` vtable:

| Slot | Method | Native address |
| --- | --- | --- |
| 0 | AcquireOverlayView | `0x3ba360` |
| 1 | ReleaseOverlayView | `0x3b9ab0` |
| 2 | PostOverlayEvent | `0x3b8d20` |
| 3 | IsViewingPermitted | `0x3b8da0` |

`0x3ba360` takes the overlay shared guard, finds a previous entry lock for the **current PID**
via `0x55ff20`, and clears it. It then takes an unused PID-reader slot on the current texture
ring entry (`+0x54a4` and following), calls view import/synchronization helper `0x3ba0d0`, and
returns a view. Normal `SetOverlayTexture` slot selection (`0x55fe20`) skips entries with these
reader slots occupied. This is genuine allocation/ownership behavior, not a time delay.

`0x3ba0d0` imports a view and synchronizes native-device access through `0x35c7d0`; its
failure diagnostic explicitly mentions failed overlay-access synchronization and possible
flickering. The GL path uses helper `0x4626e0` for import and `0x3b9bf0` for refreshed access.
A GPU wait enqueued on the caller's GL context is not automatically a CPU completion wait;
pixel readback in the test below forces completion before inspection.

### Isolated live pixel test

[`tools/overlay-view.ts`](tools/overlay-view.ts) creates its own hidden 2x2 overlay and GL context.
It never changes PetPlay's production overlays. Tested three times on the live runtime:

1. Submit red; acquire a view; readback is red.
2. Submit green twenty times; the held view still reads **red**.
3. Acquire the current green view; readback is green, with a different GL alias.
4. Submit blue twenty times; the newest acquired view still reads **green**.

There is an important limit: the **first** acquired view now reads **blue**, even though its
`ReleaseOverlayView` had not yet been called. Acquiring the next view has released this PID's
previous ring pin. Therefore this build must not be treated as permitting an arbitrary number
of simultaneously pinned generations for one PID and one overlay, despite the public header's
broad lifetime wording. Use a single view object per overlay for re-acquisition, and explicitly
model re-acquisition as moving that process's pin to the current image.

A follow-up [four-bank experiment](bank-publication.md) confirms independent pins across distinct
overlay handles. It also captures partial bank visibility switches; this is not a complete
frame-presentation protocol. The test releases its views, clears/destroys
its own overlay, shuts down its own client, and unloads its GL textures/context.

## What a scalable solution must guarantee

These are correctness requirements, not a proposed completed implementation:

1. **Completion:** new texture content is ready before it becomes eligible for presentation.
   Wait on actual GPU completion, not an estimated number of milliseconds.
2. **Coherence:** the compositor's earlier pose snapshot and later texture snapshot refer to
   one immutable generation. Even an atomic producer write alone cannot guarantee this while
   the consumer performs two separate reads.
3. **Retirement:** do not reuse an image or overlay generation until its last consumer read
   has completed. `WaitFrameSync` signals after submission; submission is not GPU completion.
4. **Publication:** expose the finished generation as one stereo frame. If a producer stalls,
   retain the previous coherent generation rather than admit a partial update.

Hidden immutable overlay banks are a promising way to address requirement 2: the compositor
snapshots visibility and pose under the same first shared guard. But public `ShowOverlay` and
`HideOverlay` calls are independent; swapping banks can expose both/neither, and left/right
publication is likewise independent. A retirement fence and a stereo publication transaction
remain necessary before claiming this as the portable solution.

The existing single visible pair, updated through independent texture and projection setters,
has no verified all-workload coherence guarantee. A fixed edge, a larger edge, a measured
percentile, or merely moving those setters to another thread cannot establish one. Moving render
and present off the simulation thread can improve throughput and latency, but is a separate
performance change from proving publication and ownership.

Next exact investigations are compositor completion/retirement through a public observable
(e.g. verify the mirror-texture access synchronization, rather than assume it), and whether a
public batched visibility/layer publication primitive exists. If neither is available, a strict
coherence protocol will require another layer API or a version-checked native compositor/client
integration; ordinary mutable OpenVR overlay setters cannot supply the missing transaction.

## Mirror access is not a retirement fence on this build

A separate hidden-GL-context probe, using **`FnTable:IVRCompositor_028`**, returned
`VRCompositorError_InvalidTexture` (102) from `GetMirrorTextureGL`, with zero output handles.
The method's native `_029` target is `0x34e710`: it reads the shared mirror handle at
client state `+0x480 + eye*8`, calls GL import `0x3626e0`, and returns 102 when import fails.
That runtime result does not by itself prove that mirrors are unavailable in every configuration.

More decisive for retirement is the code behind the access methods:

```text
LockGLSharedTextureForAccess:   0x34deb0 -> 0x35ca30 -> ret
UnlockGLSharedTextureForAccess: 0x34dec0 -> 0x35ca40 -> ret
```

These lock/unlock helpers are no-ops in this installed binary. They therefore cannot establish
compositor GPU completion, even if mirror import succeeds in another configuration on this build.
This is verified in assembly; Ghidra represents the tail-forwarding methods as empty functions.

An initial isolated mirror probe incorrectly used `_028` slot offsets with a `_027` interface
and crashed its own process. The corrected `_028` probe exited normally with error 102;
PetPlay's running process was unaffected. This is why interface version and adapter mapping
must be verified before calling an unfamiliar table. The mirror probe remains scratch-only,
not a repository tool or production feature.

## `GetFrameTiming` is telemetry, not an established retirement fence

Client native `_029` `GetFrameTiming` is `0x3583a0`. It takes the client shared-state guard
and copies from the 128-record timing ring at `+0x4f8`, stride `0xbc`, using the current ring
index at `+0x62f4` minus `framesAgo`. The native `_028` C function-table slot is 9; do not reuse
slot offsets from another interface version.

A three-second compositor trace compared ring-index publication at `0x280ce6` against the
GPU-finished marker site `0x190b21`. It recorded 165 timing-ring advances and 224 GPU-finished
points, all on RenderThread. Representative chronological points (monotonic seconds):

```text
45510.485974  GPU finished
45510.495462  timing ring advances to slot 8
45510.498823  GPU finished
45510.508901  timing ring advances to slot 9
45510.512253  GPU finished
```

The current timing record can therefore be published before the current compositor frame's
GPU completion. The ring's advances are not one-for-one with display frames. A larger
`m_nFrameIndex`, or merely retrieving timing record 0, is not a demonstrated retirement fence.
Using an older record also needs a verified connection between that record, the overlay's last
sampling submission, and completed GPU work. That connection was not established here;
`framesAgo=1` must not be promoted from useful diagnostics into an ownership guarantee.

Evidence: `/tmp/petplay-projection-re-20261013/timing-publication.trace` and
`timing-publication.sh`; client decompilation in `decomp/3583a0_redo.c`.

The user prefers public APIs with remaining limitations documented. Keep production code on
that path; do not introduce private shared-memory writes, compositor hooks, or a native
visibility transaction as if it were an approved replacement. The architecture requirements
above describe what still needs proof, and the experiments do not constitute that replacement.

The [bank publication follow-up](bank-publication.md) corrects the visibility field to
`+0x5a1d` bit 3, verifies its same-guard scenegraph consumer at `0x23a130`, and captures
both-bank, no-bank, and split-eye states during intentionally interrupted public setter sequences.
`ClearOverlayTexture` supplies no demonstrated compositor GPU retirement wait on its inspected path.

The subsequent [parent projection test](parent-projection.md) found that `CreateSubviewOverlay`
followed by child projection setters groups visibility but causes both child compositor records
to inherit the parent's shape and prepared projection matrix. Successful API calls do not make
this a coherent independent-eye publication protocol.

The [image lifetime follow-up](image-lifetime.md) found a public Linux candidate: imported
DMA-BUF shared handles preserve distinct images, bypass the internal client Vulkan copy, and
receive per-frame backend last-use tags with completion checks before destruction. It does not
yet prove bounded producer-buffer reclamation or coherent pose/stereo publication. Ordinary
GL source swaps, clearing, and handle recreation reused one final image in the isolated test.

The [GPU publication handoff probe](gpu-publication-handoff.md) now renders into imported GBM
images with an explicit producer GL fence. Immediate unref fails; rapid replacement release
can lose a selected import. A post-publication WaitFrameSync followed by previous-reference
release passes the observed handoff/reclamation tests. This is a candidate for immutable
resource ownership, not permission to overwrite a retired allocation or a pose/stereo transaction.

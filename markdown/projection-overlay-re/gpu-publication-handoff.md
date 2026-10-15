# GPU-rendered DMA-BUFs and an event-based ownership handoff

Follow-up on 2026-10-13, same [BuildIDs](README.md). Public Linux APIs, isolated transparent
overlays, no production changes. This establishes a **tested candidate for immutable image
transport and reference handoff**. It does not establish a complete stereo/pose publication
protocol or permission to overwrite an old allocation.

## What now works

[`dmabuf-gpu-probe.cpp`](tools/dmabuf-gpu-probe.cpp) renders into a fresh linear GBM DMA-BUF
through a surfaceless EGL/OpenGL context. A framebuffer is attached to its EGL-imported image.
Each generation encodes its ID in RGB with alpha zero; overlay alpha is one so the compositor
imports it, without a visible test image.

The producer:

1. Issues GPU rendering (`glClear` into the framebuffer).
2. Creates a GL sync fence, flushes, and waits until `glClientWaitSync` returns
   `GL_ALREADY_SIGNALED` or `GL_CONDITION_SATISFIED`.
3. Reads one producer pixel and checks the generation byte and zero alpha.
4. Calls public `ImportDmabuf`, then `SetOverlayTexture` with `TextureType_SharedTextureHandle`.

All tested producer fence/readback checks passed. The direct shared-handle route made **zero**
internal client Vulkan-copy calls. Local GL texture/framebuffer, EGL image, exported FD, and
GBM object are destroyed per iteration; the imported resource reference is retained separately.
The public ImportDmabuf contract says the FD is duplicated, and the caller may close its FD.
The producer never renders into a published allocation again.

This demonstrates source-context GPU completion and immutable allocation identity. A compositor
shader/output readback still has not established cross-API sampled pixel generation. The earlier
public GL OverlayView reader returned error 23 for these imports.

## Release timing matters

The probe has four diagnostic ownership modes. Their sleeps, when enabled, allow observation;
none are permission to reuse memory.

| Mode/run | Published | Non-null image observations | Selected handles never imported | Observed outcome |
| --- | ---: | ---: | ---: | --- |
| Retain, three generations | 3 | 3 | 0 | All three backend images eventually destroyed |
| Unref current immediately after SetOverlayTexture | 3 | 0 | 3 | API calls succeed, but compositor records have no imported image |
| Unref previous immediately after replacement, paced diagnostic | 128 | 128 | 0 | Continuous reclamation observed; peak six live backend images |
| Same replacement release, rapid publication | 512 | 29 distinct advertised handles with non-null wrappers | 1 | A selected handle had a null wrapper; unsafe handoff possibility is observable |
| Replace, then successful post-publication WaitFrameSync, then Unref previous | 128 | 127 | 0 | First generation skipped; all 127 observed backend images destroyed |

For the rapid run, a non-null record wrapper alone does not prove it belongs to the record's
advertised handle; import-return mapping is required under rapid changes. Its 29 figure is
therefore a record correlation, not a complete actual-image identity proof. The selected null
wrapper is sufficient to show that immediate release after replacement has no demonstrated
all-workload handoff guarantee. Most unobserved published generations simply never become the
current compositor selection; skipping them is expected.

`SetOverlayTexture` returning success is not a completed consumer-reference handoff. Likewise,
releasing after a new setter call is not by itself evidence that an earlier compositor CPU
snapshot has imported the old handle. The previous paced success must not become a fixed-delay
algorithm.

## Candidate: retain through a post-publication FrameSync

The probe's `frame_sync` mode uses this sequence:

```text
render fresh immutable image → producer GL fence completes → import → publish replacement
→ WaitFrameSync succeeds → release previous producer import reference
```

It keeps at most two producer import references while waiting. It never reuses their backing
allocations. On a timeout, a production implementation must retain pending references and stop
allocating/publishing further generations until a valid handoff boundary is established; a timeout
is not permission to release. The diagnostic program exits and performs client cleanup on errors,
so it is not a production failure-handling implementation.

Why submission progress matters here: once the consumer has imported the old allocation, its
own references can keep that immutable allocation alive while GPU work completes. A submission
boundary can therefore be useful for **reference handoff** even though it cannot authorize
producer writes into memory that the consumer GPU may still read.

### Event implementation audit

For the ordinary overlay-client path in this build:

- Client `WaitFrameSync` (`0x3b26e0`) reads event index `+0x46c` from the client state under its
  shared guard, releases the guard, then waits on that selected named event at `0x3b278c`.
- Compositor `SendOverlayVSyncEvent` (`0x17ce10`) resets the old event (`vmethod +0x30`), toggles
  its event index, signals the other event (`vmethod +0x28`), and returns the **old/reset index**.
- Normal caller `0x190aa7..0x190ae1` holds the client-state guard around signaling and publishing
  that returned index to `+0x46c` (`0x190adb`). The fallback caller at `0x190eb5/0x190ecc`
  uses the same guard and index-publication tail.

Thus an ordinary client observes the reset/inactive event index coherently, rather than choosing
the just-signaled event from a partially updated index. The next successful wake is a progress
boundary in the observed CPU submission pipeline. This is a **build-specific implementation
finding**, not a new public SDK guarantee about every compositor path/build.

The signal occurs after overlay state collection/import and submission on the observed normal
path. GPU completion follows later. Cached records, failure paths, other consumer threads and
other builds still require an audit before calling this a universal ownership protocol.

### Live verification

The final 128-generation run used **no inter-generation sleep**. All 128 producer fences and
pixel checks passed. There were 128 successful public WaitFrameSync calls (127 handoffs plus
one final cleanup boundary). Every call observed one fresh compositor signal while waiting.
All 127 previous-reference releases followed a signal after that replacement's publication.

The compositor observed 127 images; the first was replaced before selection. No selected handle
had a null wrapper. All 127 observed backend images were destroyed, 120 before the final
publication. Peak observed live backend images was six, with zero left at capture end.
**Six is an observed count, not a safe pool size or an all-workload bound.** A stalled GPU,
cache behavior, driver behavior and failure paths need separate treatment.

The initial signal probe was placed *after* the signaling call (`0x17ce61`). A woken client can
return and write its trace marker before the compositor reaches that post-call probe. Three
otherwise valid waits looked as though no new signal had occurred. Moving the probe **before**
the actual signal call, to `0x17ce5e`, resolved the measurement ordering issue. Do not count
post-call probe timing as the time at which another thread became eligible to wake.

## Identity and lifetime tracing corrections

Backend addresses are reused between successive allocations. Summing every historical object's
release/destroy events by its numeric address overcounts generations. The updated
[`lifetime-summary.py`](tools/lifetime-summary.py) attributes lifecycle events to the currently
observed generation at that address, and removes the association after destruction.

For rapid changes, raw render-record handle ↔ wrapper correlation can also be ambiguous.
The capture now probes `ImportTextureFromSharedHandle` (`0x3e0fa0`) at entry and return, recording
requested shared handle, returned wrapper, backend and native image. A 32-generation FrameSync
confirmation captured that mapping directly. These identity observations remain separate from
pixel-generation proof.

The Vulkan renderer's texture-release path is also more specific than the C++ wrapper destructor
sites initially probed. `0x3eaec0` observes the released texture; its renderer query resolves to
`0x3df450` in the live capture. That query obtains the imported native-image identity, **not a
GPU completion fence**. Release can erase the imported-image cache association and enqueue the
whole texture into renderer pending cleanup (`+0x1530..+0x1538`). Actual texture destruction is
`0x3e24d0`, which releases the backend image through its deferred resource manager and releases
the shared-resource interface. The follow-up below traces backend-owned memory through actual deferred free on the observed
normal direct-import path; this remains short of an all-path proof. Do not infer it from the query's non-null return alone.

## Backing allocation retirement: follow-up audit

The imported DMA-BUF backend owns a nonzero Vulkan memory allocation at `+0x38`. Dropping the
earlier shared wrapper does not free that allocation. The observed normal cleanup lineage is:

```text
per-frame cleanup (0x176291 → renderer virtual +0x220 → 0x3e2840)
→ swap pending texture list → 0x3e27d0 → texture destruction at 0x3e24d0
→ queue backend at 0x44e090; drop shared interface through 0x3f9df0
→ deferred manager 0x44e2a0 checks recorded timeline point through 0x452760
→ backend destruction 0x436eb0 → allocation cleanup 0x436e20
→ vkFreeMemory call at 0x436e6a, using backend +0x38
```

`0x3e2840` does not itself wait for GPU completion before dropping the shared wrapper. The
allocation survives because this direct-import backend owns it and backend destruction is
deferred. `0x436eb0` also checks `!IsInUse()` before destroying image/view and freeing memory.
[Khronos documents FD ownership transfer on successful Vulkan memory import](https://docs.vulkan.org/refpages/latest/refpages/source/VkImportMemoryFdInfoKHR.html).
That rule explains why closing producer FD references is compatible with a live imported
allocation; tracing is still needed to establish when SteamVR frees its allocation.

In `gpu-free`, 32 fresh generations were published with post-publication FrameSync and no
inter-generation delay. The first was skipped. All **31 actual imports** had nonzero owned memory;
all **31 matching allocations** were freed after a successful query for their recorded completion
point. None remained unmatched. Each selected image appeared in one compositor frame with one
last-use mark.

A second `gpu-free-held` capture kept each of three images selected for roughly 220 ms, solely to
observe repeated use. Each received **17 advancing last-use marks**, then its matching allocation
was freed after a successful query for the final recorded point. The diagnostic spacing is not a
release criterion. This confirms retirement metadata advances during repeated selection on the
observed direct path.

[`backing-lifetime-summary.py`](tools/backing-lifetime-summary.py) correlates import entry/return
per thread, then tracks the current generation at each backend address. It compares memory at
import with the actual free and successful queries with the final recorded use point. It removes
the association on free to avoid miscounting reused addresses. It does not prove sampled pixels.

The shared wrapper's `0x3f9c10` cleanup had zero native owner pointer, zero optional ownership flag
and zero shared control pointer for these imports. Probes of those optional owner-release branches
did not fire. Those empty branches are not the mechanism preserving the allocation; backend-owned
memory and its actual deferred free are the relevant evidence.

This closes the specific concern that **the tested direct-import allocation could be freed merely
because its shared wrapper was dropped first**. It strengthens the immutable-image handoff
candidate. It does not prove other import variants, device-loss paths, stalled-GPU memory bounds,
cache paths, other builds, or a producer-visible reuse fence. Production pacing is unchanged.

Evidence in `/tmp/petplay-projection-re-20261013/`: `gpu-free.{trace,api.txt,backing.json}` and
`gpu-free-held.{trace,api.txt,backing.json}`; intermediate captures `gpu-cleanup`, `gpu-backing`,
`gpu-owner-chain`, `gpu-control`, `gpu-wrapper`, `gpu-memory`. Read-only exports include
`3e2840_redo.c`, `3e24d0_redo.c`, `3f9df0_redo.c`, `3f9c10_redo.c`, `438b20_redo.c`,
`436eb0_redo.c`, `436e20_redo.c`. Exploratory decompilations of the separate whole-cleanup function
used incorrect starts; objdump identifies its actual entry as `0x3e9d50`. It was not needed for
the observed per-frame lineage. Failed decompiler exports are not evidence.

## Reproduce

From repository root, using the neighboring current public OpenVR header:

```sh
g++ -std=c++17 -I/home/ellie/git/openvr/headers \
  markdown/projection-overlay-re/tools/dmabuf-gpu-probe.cpp \
  -lgbm -lEGL -lGL -lopenvr_api -o /tmp/dmabuf-gpu-probe

PP_RELEASE_MODE=frame_sync PP_DMABUF_GENERATIONS=128 PP_DMABUF_STAGE_MS=0 PP_TRACE_MARKER=1 \
  bash markdown/projection-overlay-re/tools/lifetime-probe.sh /tmp/gpu-sync /tmp/dmabuf-gpu-probe
python3 markdown/projection-overlay-re/tools/lifetime-summary.py /tmp/gpu-sync.trace /tmp/gpu-sync.api.txt
python3 markdown/projection-overlay-re/tools/backing-lifetime-summary.py /tmp/gpu-sync.trace /tmp/gpu-sync.api.txt
```

`PP_DRM_NODE` selects the render node; this machine uses `/dev/dri/renderD128` on an AMD RX 7900
XTX. The context is surfaceless but uses a GBM window-capable config; requesting a pbuffer-capable
config failed in the initial setup attempt. No window or visible diagnostic image is created.
The probe requires these EGL/GL features and a supported linear modifier; it is not a capability
fallback implementation for other PCs.

For the deliberately failing release comparisons, use `PP_RELEASE_MODE=immediate` or `replace`.
These are diagnostic modes, not recommended application protocols. Default `retain` keeps all
producer imports during publication. `PP_CAPTURE_TAIL_MS` only controls observation after the
probe finishes; `PP_DMABUF_STAGE_MS` only controls diagnostic publication spacing.

Evidence in `/tmp/petplay-projection-re-20261013/`: `gpu-retain`, `gpu-immediate`, `gpu-replace`,
`gpu-fast`, `gpu-sync-before`, `gpu-owner`, and `gpu-import-sync` captures/API output. The capture
removes its own uprobes and leaves tracing off. Files and results are uncommitted.

## What this changes, and what remains

There is now a concrete public-API candidate for GPU-completed, immutable image generations with
an event-based producer-reference handoff. It removes the need to estimate a millisecond edge
for this **image ownership** step.

It does not give permission to render into a previously published allocation again. It also does
not combine projection pose and texture into one compositor snapshot, publish the stereo pair
atomically, or prove which pixels the headset sampled. Those are still the main blockers to a
complete presenter. Keep the tested handoff separate from those guarantees, and from any future
claim of bounded total GPU memory under overload.

# Compositor semaphore follow-up (2026-10-13)

Addresses are objdump image virtual addresses, with file offsets vaddr minus 0x1000.
This investigation does **not yet establish** consumer-to-producer GPU protection for the reused
final overlay images. Keep that uncertainty separate from the verified split pose/texture
snapshot described in `compositor-snapshot.md`.

## What the binary supports

The compositor contains several distinct semaphore paths:

| Function | Address | Observed mechanism |
| --- | --- | --- |
| shared semaphore CPU wait | `0x3f80d0` | `vkWaitSemaphoresKHR` with one timeline semaphore/value, supplied timeout |
| shared semaphore queue wait | `0x3f8cc0` | constructs an empty `VkSubmitInfo` with one wait semaphore/value, submits through global `0x4e2018`; optional GL semaphore signal afterwards |
| backend `WaitMultiple` | `0x452e80` | assembles timeline semaphore handles/values, calls Vulkan wait through global `0x4e1e80` |
| backend `OnPreSubmit` | `0x43a530` | validates wait/signal vectors, processes them through `0x43a3f0`, then `0x43a390` |
| backend submission | `0x43d920` | calls `OnPreSubmit`, then constructs/submits Vulkan batch |

`0x3f8cc0`'s optional GL tail is a **signal**, not a wait: GL function global `0x4e9550` is
loaded from `glSignalSemaphoreEXT` at `0x3f884f`. The nearby globals are loaded from
`glSemaphoreParameterui64vEXT` (`0x4e9538`), `glGetSemaphoreParameterui64vEXT` (`0x4e9540`),
and `glWaitSemaphoreEXT` (`0x4e9548`). Disassembly of the initializer at `0x3f87f0..0x3f8862`
allows those calls to be distinguished without assuming the meaning of a function pointer.

Merely finding these functions does not prove PetPlay's overlay takes them.

## Active runtime path: tested

An eight-second uprobe capture on the compositor recorded:

- `0x43d920`: 600 calls;
- `0x43a530`: 600 calls;
- `0x3f80d0`, `0x3f8cc0`, `0x452e80`: **zero calls**;
- cold texture-import error/log sites `0x3e1630`, `0x40310a`: zero calls (expected once resources
  have already been imported).

The active submit and `OnPreSubmit` calls ran once per compositor frame (about 75 Hz). Their
vblank phase p50 was 8.17/8.18 ms, p95 8.87/8.88 ms, maximum 10.19 ms in that capture.
Generic CPU/shared-semaphore wait wrappers are therefore not an explanation for ongoing
PetPlay rendering in this capture; the GPU submission path remains the relevant path to inspect.

A second four-second capture inspected the active `OnPreSubmit` argument's vectors at function
entry, for 300 submissions:

| Vector offsets | Element stride | Count on every captured submission |
| --- | ---: | ---: |
| `+0xf0..+0xf8` (wait semaphore/value pairs) | 16 | 1 |
| `+0x410..+0x418` (signal objects) | 8 | 1 |
| `+0x550..+0x558` (alternate wait handles) | 8 | 0 |
| `+0x690..+0x698` (alternate submission objects) | 8 | 0 |

The first two vector meanings are supported by assertion text (`m_waitSemaphores`, signal-point
requirement) and their use by submission code. The last two are reported as raw array sizes;
they have not been fully typed. **The single wait must not be attributed to the overlay** without
mapping its object to the actual imported shared image. It could belong to the scene application
or a synchronization object covering more than one resource.

Raw evidence remains in `/tmp/petplay-re-snapshot/semaphore.trace` and
`semaphore-counts.trace`; capture script `sem-count.sh` is in that same session scratch directory.
All probes from these runs were removed, and global tracing was disabled afterwards.

## The GL scratch image is not necessarily the sampled image

The parent client-side investigation found source-identity caching and a GL-import scratch image.
Client `CVRSharedGLTexture::Update` at `0x3175b0` performs:

1. GL blit at `0x317812`;
2. producer synchronization via `glSignalSemaphoreEXT` at `0x317a5a` and `glFlush` at
   `0x317a6b`, or fallback `glFinish` at `0x31784f`;
3. further copy helper `0x35b920`, called at `0x317919` on the update path, with the imported
   source resource and final output context.

The signal/flush sites occur on a branch before execution returns to the subsequent-copy path;
source addresses alone are not chronological instruction order.

There is no direct call through the object's `+0x150` (`glWaitSemaphoreEXT`) pointer in the
ordinary GL Update assembly range. This is a useful negative result about that function, **not**
a proof that no downstream helper protects either image. The Vulkan copy helper has its own
resource and synchronization methods. Its destination and completion point must be resolved
before diagnosing final-image overwrites.

The compositor-selected handles stayed constant throughout the earlier 749-frame indexed
capture, but that observation identifies final resources only. It does not show the lifetime of
the scratch resources or the ordering of the extra Vulkan copy.

## Consequence for pacing

`WaitFrameSync` happens after compositor CPU state collection and submission, which can avoid
crossing its split pose/texture snapshots. It is **not yet verified as a GPU-safe permission to
rewrite the final shared image**. A producer-completion semaphore can make a consumer wait for
a completed copy; it does not, by itself, force the next producer copy to wait for the previous
consumer read.

The remaining proof needs to connect these specific objects:

- GL-import scratch image/semaphore;
- helper `0x35b920`'s output image and copy completion;
- the final shared handle placed in `+0x548c`;
- the compositor render texture at render-record `+0x20`;
- that texture's wait/signal object in active backend submission.

Until that chain is established, an empirical present window is only a temporary debugging
control, not the requested portable solution. Continue toward explicit publication and ownership
synchronization rather than choosing a fixed time.
The user's observation that 12 ms has less judder is useful empirical evidence; it does not
identify which of these synchronization steps causes the residual judder.

## Runtime-resolved output-resource transition method

A three-second capture placed a uprobe at client `0x35b9ac`, immediately before the copy helper's
first device vcall at `+0x100`. On PetPlay's worker, the call target resolved to **vrclient
`0x54f860`** (using the client's readable `/proc/<tid>/maps` base). Before the copy, arguments are
resource pointer, `edx=1`, `ecx=0`; after the copy (`0x35be62`), `edx=1`, `ecx=3`.

This is not simply an obvious acquire/release boolean:

- `0x54f860` obtains the native resource through resource vcall `+0x18`, maps `edx` through an
  integer table at `0x197bc0`, and tails into `0x54f7e0`.
- `0x54f7e0` iterates resource subimages and calls `0x54f0e0`.
- `0x54f0e0` accesses a resource synchronization/state object at `+0xc8`, calls its vmethods
  `+0xd8` (`0x54f144`), `+0xd0` (`0x54f277`), and `+0xe0` (`0x54f293`), and calls transition
  builder `0x54edb0` (`0x54f258`).

The parent subsequently resolved those methods: `+0xc8` reads the current Vulkan image layout,
`+0xd8` reads queue family, `+0xd0` sets the layout, and `+0xe0` sets queue family.
`0x54edb0` emits the transition. Diagnostics mention image transitions, invalid target queue
modes and missing open command buffers; external/foreign queue identifiers -2/-3 occur.
The outer method is therefore an **image layout / queue ownership barrier**, not a host mutex
or a standalone GPU-completion fence. A semaphore connection still needs separate proof.

The same capture confirmed compositor render-record `+0x20` references two distinct wrapper
objects for the known final shared handles. Both wrappers have vtable **`0x4d23e8`**. Their
wrapper destruction code (`0x3dfce0`) releases an underlying backend resource stored at `+0x68`
and a shared-resource object at `+0x48`. Those are the next pointers to trace when mapping the
sampled image to the producer copy destination.

The active `+0xf0` wait-pair's first field appears to be a raw Vulkan handle, rather than a C++
object pointer; an attempted nested vtable read did not produce a credible C++ vtable. It must
not be used as a typed semaphore-object identity without further validation. Raw capture:
`/tmp/petplay-re-snapshot/semaphore-map.trace`; script `mapsem.sh`. Tracing/probes were cleaned up.

## Sampled resource import bridge (static, full repaired decompilation)

Compositor `ImportTextureFromSharedHandle` at **`0x3e0fa0`** constructs a shared-resource object
through `0x3fa4b0`, imports the supplied shared id, and obtains its native Vulkan image via
shared-resource vcall `+0xb0`. It calls backend `CreateImageWithFlags`, **`0x438b20`**, passing
that native image as its final argument. The backend stores it at image-object **`+0x90`**.
The outer `FacetTexture` wrapper (vtable `0x4d23e8`, RTTI name `FacetTexture`) stores that backend
object at **`+0x68`** and **`+0x40`**, and the imported shared-resource object at **`+0x48`**.

Its native-API wrapper methods `0x3dd720/0x3dd760` assert that it is not directly a Vulkan/D3D
object; reading the outer wrapper as a raw VkImage would therefore be wrong. Wrapper `+0x8`
is copied from backend `+0xa0`; matching it between two textures is not image-identity proof.

Native Vulkan image handles are device-local. **Do not compare a vrclient VkImage number with a
vrcompositor VkImage number to infer physical identity.** Two imports of the same memory may
have different native image values. Cross-process physical identity needs the shared-resource
id, exported/imported memory metadata or backing-fd identity. The pointers/offsets above only
bridge each process's own objects.

The complete repaired decompilations are retained as
`/tmp/petplay-re-snapshot/out/3e0fa0_redo.c` and `438b20_redo.c`. Repair required clearing both
wrong no-return flags **and stale instruction fallthrough overrides**, then re-disassembling and
recreating functions. Clearing function flags alone left important branches truncated.

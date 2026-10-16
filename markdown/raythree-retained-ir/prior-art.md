# Prior art

Systems that solved "one side builds a scene, another side draws it", and what each
contributes to the [plan](./README.md). They agree on one point: **remember what the receiver
already has, find what changed, and don't send or process anything else.** Compression comes
after that and matters much less.

| System | Core idea | What we take |
|---|---|---|
| **Chromium cc property trees** | Layers refer to nodes in separate transform, clip, effect and scroll trees. Commits push changed properties. Compositor-driven animations update tree nodes without the main thread. | The closest match. Items point at spatial nodes. Clip is relative to its node. Tracked poses are compositor-side inputs, like compositor animations. Decisions 2–4. |
| **WebRender** (Firefox) | Display list plus a spatial tree. Animated property bindings change transform or opacity without resubmitting the display list. Retained display lists after full rebuilds proved expensive. | Spatial tree, property bindings for tracked nodes, retained scene vs per-frame culling. |
| **Core Animation** | The app commits layer-tree transactions to a separate render server, which owns the tree and runs animations itself. | Our decoupled renderer is already a render server. The missing part is transactions instead of snapshots. |
| **Pixar Hydra** | Retained render prims. A change tracker with fine dirty bits (transform, topology, material, visibility, primvar). `Sync()` pulls only dirty data. Hydra 2 uses data-source locators for nested fields. | Field-group dirty masks per item kind; renderer reacts per group. |
| **Bevy retained render world (0.15)** | Moved from re-extracting every entity into a fresh render world each frame to a retained render world with explicit sync. | The most direct "snapshot every frame → retained" precedent in a modern engine. Same motivation. |
| **Godot `RenderingServer`** | RID-based retained server API. Calls like `instance_set_transform` happen only on change. Can run on a separate render thread. | Stable IDs and server-owned objects. The API is the protocol. |
| **Unreal scene proxies** | The game thread owns components. The render thread owns `FPrimitiveSceneProxy`. Transforms are pushed only when they move (`UpdatePrimitiveTransform`). | Separating producer state from renderer state; per-change pushes. |
| **MPEG-4 BIFS / BIFS-Anim** | Binary scene stream with insert/delete/replace commands on a retained graph, plus a separate quantized animation stream. | Splitting a structural stream from an animation stream. Mostly relevant if raythree ever streams over a network. Locally, the latest-since-ack approach covers it with one channel. |
| **WireGL / Chromium (Stanford)** | Tracks GL state and sends only the differences, lazily. Buckets geometry so it goes only to the servers that need it. | Even an immediate-mode source benefits from a stateful differencing layer. This is tier 1 change detection. |
| **blue-c distributed scene graph** | Per-node New, State Dirty and Connectivity Dirty flags. Serial numbers drop superseded updates. | Separate state changes from topology changes. Latest value wins. |
| **Late latching (Oculus/Meta)** | The renderer samples the newest pose just before submit. | Tracked spatial nodes. The producer never bakes poses. |
| **Lockstep / rollback netcode checksums** | Peers exchange state hashes to detect desync early. | Receipt checksum and resync on mismatch (decision 9). |

## reactivesurfacecompositor v0.2

`/home/ellie/git/reactivesurfacecompositor/v0.2` (protocol-first, worker-hosted UI surfaces):

- **Take:**
  - the receiver owns the node map;
  - granular `set-prop` commands;
  - `produceFrame()` returns `null` when nothing changed;
  - a dirty effect is queued once per flush, so many writes coalesce into one emission;
  - a per-surface frame budget in the compositor (P6).
- **Take, at the producer layer:**
  - fine-grained reactive invalidation instead of scan-and-diff;
  - uikit is already built on `@preact/signals-core`, so this is a tier 2 dirty-hint source.
- **Avoid:**
  - posting whole JS frame objects as the transport;
  - `keyed()` emitting `insert-node` for every retained row on each run. Reactive execution
    alone isn't enough; emission has to depend on values.

## Not worth it (for now)

- **Quantizing matrices and delta coding** pays off only after change cardinality is
  minimized, and mostly over networks. Revisit with the 10k-movers benchmark.
- **General compression (zstd and similar)** spends CPU on a local pipe to save bytes we
  shouldn't be sending at all.

# Independent image pins and interrupted bank publication

Follow-up on 2026-10-13, same binary BuildIDs as [README](README.md).
This is an isolated public-API experiment and build-specific compositor observation, not a
production presenter or proof of headset pixel generations.

## Independent pins work across overlay handles

[`overlay-banks.ts`](tools/overlay-banks.ts) creates four private 2x2 projection overlays:
`A-left`, `A-right`, `B-left`, `B-right`. It sets alpha to zero before showing any of them,
so they do not add a visible test image to the user's headset. It uses public
`FnTable:IVROverlay_027` and `FnTable:IVROverlayView_003`, in its own process and GL context.

A starts with red textures, B with green. The script acquires exactly one view per handle and
forces GL pixel readback. It then submits blue twenty times to **each** handle. All four pinned
views still read their original colors. Repeated runs passed; the saved probe now asserts the
pixel values. Separate overlays therefore retain independent PID reader pins in this build.
This extends the earlier single-overlay test, where re-acquisition moved that overlay's pin.

These pins prevent producer reuse of the held ring entries. They are **not compositor consumer
pins**, do not reveal which image an earlier compositor submission sampled, and do not tell us
when that submission completes. Readback establishes completion for the acquired image on the
viewing GL context; it does not establish compositor retirement.

## Correction: visibility is a flag, not the input-method field

The previous notes incorrectly labeled `+0x55d4` visibility. Vtable/adapter mapping and assembly
show that `vrclient 0x3aed80` is `SetOverlayInputMethod`. Its value is compared to 1 at
`vrcompositor 0x239ed8` and copied to scenegraph node `+0xc0` for input behavior.

Actual public Show/Hide (`_027` function-table slots 41/42) forward to native `_029` slots
43/44:

| Operation | Native function | Shared-state change |
| --- | --- | --- |
| ShowOverlay | `0x3b0600` | set bit 3 of `state + index*0x614 + 0x5a1d` at `0x3b06cd` |
| HideOverlay | `0x3b04e0` | clear bit 3 at `0x3b05ad` |

Both acquire/release the overlay shared guard. In `PushUpdatesToScenegraph`, **`0x23a130`**
reads this byte, tests bit 3, and sets/clears bit 0 of the associated scenegraph nodes' `+0x18`
flags (`0x23a488` / `0x23a178`). For projection kind 8, this is under the **same guard** as the
projection-pose read at `0x23a06a`. Transform kinds 4/5 have exceptions and are outside this test.
The shared-snapshot conclusion survives, with the corrected field and consumer lineage.

## Interrupting swaps exposes partial states

The script deliberately waits 80 ms between public setter groups. This models a descheduled
producer and establishes a possible all-workload failure; it is not an estimate of ordinary
setter latency and not a pacing recommendation.

It tests these sequences:

1. Show B's two handles, stall, then hide A: both banks are enabled during the stall.
2. Hide B's two handles, stall, then show A: neither bank is enabled during the stall.
3. Swap left eye from A to B, stall, then swap right: the two eyes have different banks enabled.

The corrected uprobe records the actual visibility flag read at `0x23a130` and groups reads by
entry to `PushUpdatesToScenegraph` (`0x239c10`). Confirmation run: 68 complete **projection-kind-8**
snapshots of slots 65/66/67/68. Setup snapshots before configuring projection are excluded.

| A-left / A-right / B-left / B-right | Snapshots | Interpretation |
| --- | ---: | --- |
| 1 / 1 / 0 / 0 | 23 | A enabled |
| 0 / 0 / 1 / 1 | 24 | B enabled |
| 1 / 1 / 1 / 1 | 6 | Both banks enabled |
| 0 / 1 / 1 / 0 | 6 | Different banks enabled for each eye |
| 0 / 0 / 0 / 0 | 9 | Includes the hide-first gap and initial hidden setup |

An earlier corrected run also captured six both-bank and six split-eye snapshots. The overlays
were deliberately transparent, so these results prove partial **CPU scenegraph publication**,
not visible duplicates/blanks or which pixels the headset ultimately sampled. Finishing a
Show/Hide sequence quickly reduces exposure but cannot make independent calls transactional.
Synchronizing its start to `WaitFrameSync` does not prevent a stall between those calls.

## ClearOverlayTexture is not a demonstrated completion wait

Native `_029` slot 62 (`0x3adfd0`) calls shared-state helper `0x560ad0` under the guard. On the
normal owner path, the helper zeros the current entry's shared handle at `0x560b49`; other
branches perform related state updates and optional logging. This inspected path does not
wait for compositor GPU completion or invalidate the client's GL/Vulkan image allocation cache.
The public API return therefore supplies no demonstrated retirement fence. Clearing a handle
also cannot, by itself, prove that a previously imported compositor resource is no longer sampled.

This does not exhaust resource-manager lifetime handling. Dropping references may defer GPU
resource destruction elsewhere; we have not traced that chain far enough to claim whether a
fresh-allocation protocol could rely on it. Avoid treating an allocation/destruction strategy as
proved safe or practical until that lineage and bounded resource usage are established.

## Reproduce

From repository root, with user-owned tracefs and the BuildIDs above:

```sh
bash markdown/projection-overlay-re/tools/bank-switch-probe.sh /tmp/overlay-banks
# Read the four indices printed in /tmp/overlay-banks.pixels.txt, then:
python3 markdown/projection-overlay-re/tools/bank-switch-states.py /tmp/overlay-banks.trace 65 66 67 68
```

Indices may change. The capture refuses to start if tracing is already active, removes only
its own probes, and turns tracing off on exit. The test releases its views, hides/clears/destroys
its own overlays, and shuts down its own client. It does not touch PetPlay's overlay handles or
configuration. SteamVR's attempt to launch `vrmonitor` emitted a missing Qt library message;
OpenVR calls and pixel assertions still succeeded.

Session evidence: `/tmp/petplay-projection-re-20261013/banks-confirm.{trace,pixels.txt}`.
The scripts and findings are durable; scratch traces are not.

## Implication and bounded next question

Independent pins give a usable ownership building block. Ordinary bank Show/Hide sequences
still do not provide coherent stereo publication, and pin release is not a consumer-retirement
signal. This experiment therefore rules out calling a simple double-bank swap the portable fix.

Further RE should answer a concrete remaining question: can a public **single parent visibility
change** publish a group of independently projected eye overlays, or do subview/relative-overlay
rules prevent that? The local public headers expose subviews, but their 2D composition semantics
have not been verified for projection/stereo grouping. Separately, fresh allocation could avoid
in-place image reuse only if runtime resource lifetime and bounded reclamation are proved.
Neither candidate is established here. Continue the current public-API path with its limitations
explicit; do not replace missing guarantees with a millisecond threshold.

The [parent projection follow-up](parent-projection.md) tested that next question: parent
visibility groups texture selection, but the parent association also overrides child projection
shape and pose. The tested subview approach is therefore unsuitable for independent stereo eyes.

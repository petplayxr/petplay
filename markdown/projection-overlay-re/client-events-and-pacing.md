# Client event path, interface boundary, and pacing deadline

Investigated 2026-10-13 against the installed Linux SteamVR binaries, using the existing
Ghidra databases, `objdump`, a fresh OpenVR overlay client, and live tracefs captures.
All addresses below are ELF virtual addresses; Ghidra's image base adds `0x100000`.

## `0x201` is an event, not an established compositor texture-switch command

`VREvent_OverlaySharedTextureChanged` is decimal 513 (`0x201`) in the local OpenVR
bindings. At vrclient `0x3b2ffc`, `SetOverlayTextureXR` constructs the event header
`0xffffffff00000201`: event type 513, tracked-device index -1. The notification is
conditional on the byte at stack `rbp-0x2f9` (`0x3b2fd9`), rather than unconditional
on every texture submit.

A fresh runtime client resolves the event object at `IVROverlay_029.this+0x128`:

| step | address | operation |
| --- | --- | --- |
| event object's vtable | `0x66f348` | slot 2 is `0x1fd330` |
| adjusted-this thunk | `0x1fd330` | subtract 8 from `this`, jump to `0x1fd280` |
| event conversion | `0x1fd280` | call `0x55c8f0`, then `0x1fd200` |
| overlay event routing | `0x1fd200` | nonzero overlay handle calls `0x1fb8f0` |
| event ring insertion | `0x1fb8f0` | take shared-state guard at object `+0xe8` |
| copy | `0x1fb943..0x1fb98d` | copy 80 bytes into event ring, entry stride `0x50` |
| advance | `0x1fb995..0x1fb9a3` | increment state `+0x14000` modulo 1024 |
| notify | `0x1fb9a9..0x1fb9b9` | release guard, call event object's `+0xef0` vtable slot 5 |

This path publishes an overlay event into shared memory. It is not evidence for a
compositor command queue switching the active image. The compositor's own ring-read
path is investigated separately in [compositor-snapshot.md](compositor-snapshot.md).
The ultimate consumers of this notification were not exhaustively traced here.

Ghidra wrongly truncates `0x1fb8f0` at the shared-lock guard; use assembly for the
ring write and notification. The event conversion diagnostic includes
`Unable to convert event in PoseOverlayEvent` (the binary's spelling).

## `_029` has 84 methods, not 89

Runtime vtable boundaries:

| interface | vtable | methods |
| --- | --- | --- |
| `IVROverlay_027` | `0x674798` | 80 |
| `IVROverlay_028` | `0x6744d0` | 82 |
| `IVROverlay_029` | `0x682c60` | 84 |

The `_028` adapter functions `0x201870..0x201d80` map all 82 methods into `_029`.
Only `_029` slots **48** and **68** are skipped:

- Slot 48 is `WaitLatchSync`, native `0x3b2470`.
- Slot 68, native `0x3b0f80`, is a getter. It validates the overlay, checks ownership,
  reads the ring index at overlay-slot `+0x5574`, and returns that entry's `+0x548c`
  64-bit handle through the caller's output pointer (`0x3b1060..0x3b1083`). Its exact
  API name and whether this index tracks compositor consumption remain open.

Entry 84 is `0x6917e0`, outside executable mappings; following entries belong to
neighboring data/tables. The old `ft.ts` read too far. Its dump now stops at 84.
Neither added method is a batched texture-plus-projection setter.

Also, helper `0x3ef6c0` returns a cached process id or calls `getpid` through PLT
`0x1ecca0`. The comparison of its result against `+0x5778` in the new getter is an
**ownership check**, not a comparison of texture ids. This corrects the handoff's
initial interpretation of `+0x5774/+0x5778`.

## Present-window experiment and deadline fix

The original gate rejected an already late frame, then slept/spun until `minMs`.
It never checked `maxMs` again. A scheduler stall during that wait could therefore
present a frame after the deadline without counting it as dropped.

Two consecutive 20-second captures at 75 Hz, before the fix:

| window | presents | counted drops | present-start p50 | p95 | latest start | starts after 17 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 11–17 ms | 1496 | 0 | 11.002 ms | 11.197 ms | 23.893 ms | 1 |
| 12–17 ms | 1498 | 0 | 12.002 ms | 12.120 ms | 20.945 ms | 1 |

The compositor GPU-finished p95 was approximately 10.45 ms in both captures, but
its maximum approached 13.2 ms. A percentile is not a synchronization guarantee.
These traces do not establish headset judder or correct presentation-vsync identity.

`awaitProjectionPresentWindow` now checks the deadline again after waiting and
counts/rejects a late wake. Four source-body checks exercised normal opening,
late waking, an already late frame, and the valid part of the window after the
next vsync. All passed.

Two more 20-second live captures after hot reload found **zero admitted starts
past 17 ms**, with 1341 and 1268 admitted presents respectively. The scene workload
changed after reload (checks p50 10.7/12.1 ms versus 1.6/2.4 ms before), so the
130/183 counted drops are not a controlled measure of the effect of moving the
lower edge. Do not attribute those drop-rate differences to the deadline fix.

The gate still bounds the **start** of submission. Two texture calls, both transform
calls, and any scheduling stalls must all finish before the next pose snapshot.
A late-start check cannot make four independent OpenVR calls atomic, nor roll back
an update if a texture call stalls. A completion margin or a compositor-observed
boundary still needs investigation. The source default remains 11–17 ms. After the captures, the live state was set to
12–17 ms for headset comparison; the user reported less judder, with occasional judder remaining.
That setting is temporary diagnostic state, not the intended scalable solution.

Raw captures, aggregate JSON, runtime vtable dumps, Ghidra excerpts, and the
source-body deadline check are in `/tmp/petplay-projection-re-20261013/` on this
machine. They are session evidence, not durable repository artifacts.

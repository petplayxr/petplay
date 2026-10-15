# Can one parent visibility change publish two projected eyes?

Investigated 2026-10-13 on the BuildIDs in [README](README.md), using public
`FnTable:IVROverlay_028` and compositor uprobes. **The tested subview-parent approach groups
visibility, but overrides the children's independent projection shape and pose. It is not a
usable stereo-projection publication transaction.** Production code/configuration is unchanged.

## Public API experiment

[`overlay-parent.ts`](tools/overlay-parent.ts) creates one parent and two subviews in an isolated
process/hidden GL context. All three overlay alphas are zero before any Show calls. It submits
three distinct 2x2 texture sources, explicitly shows each child, and exercises parent Show/Hide.
It then applies independent projection transforms to the children:

- left child: eye 0, identity matrix with X translation **+0.25**;
- right child: eye 1, identity matrix with X translation **−0.25**.

The setters succeed. `GetOverlayTransformType` changes the children from 9 (Subview) to 8
(Projection). `IsOverlayVisible` reports both children following parent visibility. That API
result initially looked promising, but is not sufficient to prove independent rendering.

As a control, the experiment then sets the **parent** to left-eye projection with X translation
**+0.5**, without changing the child setters. Both child compositor records change to the
parent's left-eye shape and +0.5 pose. The parent's API type and both children's API types are 8.
The final stage toggles only parent visibility twenty times; children remain immutable.

The tool hides/clears/destroys its own overlays and shuts down its own client. It does not modify
PetPlay's overlays. The `vrmonitor` launch emits the same missing-Qt-library diagnostic as the
other isolated probes; OpenVR calls succeed.

## Live compositor results

The final capture groups events by `PushUpdatesToScenegraph` entry. It observes actual node root
enable flags after the visibility loops, later traversal, texture selection, and all six 64-bit
chunks of each render record's 48-byte prepared projection matrix. Earlier setup frames while
children still have subview transform kind 9 are excluded from the final projection counts.

109 complete snapshots with both children configured as kind 8:

| Parent enabled | Texture selections for parent / left / right | Snapshots |
| --- | --- | ---: |
| Yes | yes / yes / yes | 62 |
| No | no / no / no | 47 |

No split-child selection appeared in this capture. This supports grouping visibility for the
observed CPU render records; it does not prove which headset pixels were sampled or establish
all-build guarantees.

More decisive for the proposed stereo protocol:

| Child records | Count |
| --- | ---: |
| Shape 0, matching ordinary parent | 30 |
| Shape 5 (left projection), matching projected parent | 94 |
| Different matrix/shape from parent | **0** |

All **124** child records with a corresponding parent record matched the parent's entire
prepared matrix and shape. The intended right child never had shape 6 in this stage. Neither
child preserved its ±0.25 projection pose in the record. Raw counts include additional earlier
subview-control frames; the analyzer excludes those from these totals.

Thus selecting both child textures is not proof of preserving independent eye projections.
This test uses transparent overlays, so its evidence is CPU record content, not headset image
judder or pixel-generation readback.

## Why the API accepts this but does not produce independent projections

Addresses below are ELF virtual addresses; uprobe text file offsets subtract `0x1000`.

1. `CreateSubviewOverlay` native `0x3b10d0` creates an ordinary overlay, then sets:
   - overlay category `+0x55d8 = 3` at `0x3b11ef`;
   - transform kind `+0x55f0 = 9` at `0x3b11f9`;
   - parent handle `+0x55fc` at `0x3b120d`.
2. `SetOverlayTransformProjection` (`0x3afad0`) writes kind 8, projection shape 5/6, matrices and
   frustum, but **does not remove the category-3 parent association**. A successful setter and
   kind getter therefore do not promise the independent rendering behavior needed here.
3. `IsOverlayVisible` (`0x3afc80 → 0x55fbb0`) checks category 3 at relative slot offset `+0x1cc`
   (absolute `+0x55d8`) and recursively checks the parent at relative `+0x1f0` (absolute
   `+0x55fc`), before testing the child's own visibility flags.
4. `PushUpdatesToScenegraph` retains the association: `0x23a0e0` copies the parent into its
   overlay record `+0x50`; the later association pass `0x23a89a..0x23a8f8` resolves a parent
   and writes its overlay handle into the child leaf's `+0x50` at `0x23a894`.
   The kind-8 projection case falls through to this association path.
5. `BuildRenderLists` (`0x215860`) traverses scenegraph nodes via `0x213470`. Its root enable
   test at `0x213470` can skip a hidden parent's own traversal. A child can have its own root
   enabled while its parent is hidden, so checking child-root flags alone is insufficient.
6. The Panel leaf's virtual visitor resolves to **`0x225d10`** on the live renderer. The
   forwarding method `0x1f1380` calls renderer vtable `+0xe8`; the runtime pointer was checked
   against the compositor ASLR base. `0x225dd2` reads the leaf's associated parent handle.
   `0x227438` and following resolve that parent in the current renderer record map.
7. On the parent-associated path, the visitor copies the resolved parent's prepared shape and
   projection matrix into the child record: shape lineage includes `0x226302`, and the six
   matrix chunks are copied at `0x22639c..0x2263e9`. This is consistent with subviews sharing
   their parent's geometry, and exactly matches the live inheritance control.
8. Final render-record builder `0x23f180` selects each child's texture at `0x23f408`, and copies
   that prepared matrix at `0x23f629..0x23f66d`. The probe at `0x23f671` reads the output matrix
   at `+0x28..+0x50` and prepared shape from input `%r12 + 0x10c`.

Do not confuse the leaf `+0x50` parent **overlay handle** with a native node pointer. Also, the
leaf itself may have enable bit 1 while the earlier root in overlay-record vector `+0x8` is
disabled. The saved probe explicitly observes the first root, not only the leaf.

Ghidra's earlier no-return errors were cleared in read-only scratch sessions for `BuildRenderLists`
and the node factory. Assembly and runtime records substantiate the findings; the source databases
were not changed. Decompiled scratch files are under
`/tmp/petplay-projection-re-20261013/decomp/`.

## Reproduce

From repository root with user-owned tracefs and this build:

```sh
bash markdown/projection-overlay-re/tools/parent-projection-probe.sh /tmp/parent-projection
# Get parent/left/right indices from /tmp/parent-projection.api.txt, then:
python3 markdown/projection-overlay-re/tools/parent-projection-states.py /tmp/parent-projection.trace 65 66 67
```

Indices are session-dependent. The capture refuses active tracing, removes only its own probes,
and leaves tracing off. The final evidence is in
`/tmp/petplay-projection-re-20261013/parent-inheritance.{trace,pixels.txt}`; the historical
`.pixels.txt` suffix contains API output, not pixel readback. The saved tool now uses `.api.txt`.

## Decision

Do not build the presenter around “CreateSubviewOverlay, set child projection, switch parent.”
It preserves the association that groups visibility **and** supplies parent geometry, defeating
independent stereo reprojection on this build. The public header describes subviews as 2D images
composited onto a parent; it does not promise this combination as a stereo layer transaction.

Even a visibility-only group would leave two-parent bank replacement and GPU retirement unresolved.
This RE rules out one concrete candidate; it does not prove that every possible public API
strategy is impossible. The current ordinary projection-overlay path remains an empirical policy
with documented limitations. A subsequent investigation should target a specific alternative
layer/publication contract or resource-lifetime mechanism, rather than add another delay or
promote this parent API acceptance into a correctness claim.

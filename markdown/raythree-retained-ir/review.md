This is a strong proposal. The most important thing Claude did was stop optimizing the abstract “scene streaming problem” and profile **your actual stream** first. The measurements change the priorities substantially.

The core diagnosis looks right: PetPlay is not currently suffering because 114 KB/frame is intrinsically huge; it is suffering because that snapshot forces about **1.8 ms of decode plus allocation/GC and renderer invalidation inside an ~11 ms frame budget**, while most of the contents are unchanged. Pasted text

The bit I like most is P1. I would do that before any ambitious retained-scene work too.

Right now the hand-anchored UI is effectively doing this:

```text
sim hand pose
   ↓
bake panels/text into world space
   ↓
serialize changed world-space values
   ↓
decode
   ↓
renderer notices anchor
   ↓
throw away stale world-space relationship
   ↓
re-anchor to fresh tracked pose
```

So the architecture is literally manufacturing changes that the renderer later corrects. The plan's invariant—

> no field holds a world-space value derived from a node it doesn't own

—is excellent. Pasted text

That is more fundamental than “delta encoding.” It removes false motion from the semantic model.

And it explains your text rebuild problem particularly well. If text geometry/batches are stored in hand-local space and the renderer applies one current hand matrix at draw time, **hand motion should not invalidate text geometry at all**. The proposed renderer rules explicitly get to that: batches remain node-local and are never rebuilt merely because their spatial node moved. Pasted text

I would expect that to help scheduler pressure disproportionately because you're eliminating an entire class of variable work, not merely reducing bytes.

The second particularly good decision is:

> latest state since the last acknowledged receipt, not FIFO deltas

That is exactly right for your failure mode. Pasted text

A naïve retained protocol usually creates a new problem:

```text
producer:
delta 100
delta 101
delta 102
delta 103

renderer falls behind:
process 100
process 101
process 102
process 103
```

which is disastrous when scheduling latency is already your enemy.

Claude's scheme instead makes the packet describe:

```text
everything renderer has not yet acknowledged,
collapsed to latest values
```

So if transform 42 changes twenty times while the renderer is busy, the next useful state still contains **one transform 42**.

That is much better than ordinary command-stream thinking.

I also agree with postponing shared-memory/ultra-special realtime channels for now. My previous response jumped fairly quickly toward that architecture, but these measurements argue you can probably get most of the immediate win without it. If you can turn:

```text
114 KB full snapshot
+ 1.8 ms decode
+ GC
+ text rebuilding
```

into:

```text
a handful of changed records
+ cheap retained-store patches
```

then the transport mechanism may stop mattering enough to justify complexity.

The P3 target—one typed-array slab, no per-item decode objects, typical delta encode+decode under 0.2 ms—is a sensible place to see whether transport remains relevant. Pasted text

There are, however, a few parts I'd modify.

### I would be careful with dynamic promotion/demotion of spatial nodes

This part:

> independently moving subtrees, detected as objects whose `matrixWorld` changes while their parent's doesn't

followed by promotion/demotion of nodes, is clever but potentially more complicated than its payoff. Pasted text

The danger is that the representation itself becomes dynamic based on observed movement:

```text
static
→ moves
→ promote to spatial node
→ stops
→ demote
→ moves again
...
```

You already call out hysteresis later. Pasted text

I might make the first implementation more conservative:

```text
world root
tracked roots
explicit dynamic roots
object roots that have ever demonstrated independent movement
```

and simply **never demote automatically during the object's lifetime**.

A retained spatial node is cheap. Structural churn is not.

You can always compact later.

### I'd avoid tying “version” too tightly to one global acknowledged version

The transaction section says an entity appears when its version exceeds the acknowledged version. Pasted text

That works if versions live in a single globally monotonic version space.

But be careful not to accidentally have:

```text
node.version = 7
material.version = 5
global ack = 1004
```

and then compare incomparable domains.

I would probably make the producer internally maintain:

```text
globalMutationSerial
```

and every mutation records:

```text
lastChangedSerial
```

Then:

```text
item.lastChangedSerial > consumerAckSerial
```

has unambiguous semantics.

Individual asset `revision` can remain the semantic/content revision exposed by raythree.

So distinguish:

```text
revision       = this resource's identity/version
changeSerial   = when the protocol last changed it
```

That'll make dropped packets and multiple consumers much easier to reason about.

### Checksumming the entire state on every receipt may be too expensive

I agree completely with the **resync-on-divergence** idea. The equivalence invariant is one of the strongest parts of the proposal:

> `apply(snapshot₀, deltas…) == snapshotₙ`

with randomized dropped/late packet testing. Pasted text

But I wouldn't necessarily compute a full scene checksum every frame.

If the scene becomes large, that turns your beautiful O(changes) pipeline back into O(scene) validation.

Better choices might be:

```text
incremental scene hash
```

where each table entry contributes a stored hash and updates adjust the aggregate, or:

```text
periodic checksum
```

every N receipts/debug mode, plus stream/sequence consistency all the time.

An incremental XOR-style hash is cheap but weaker; a Merkle-ish table hash is stronger but more elaborate. For accidental implementation drift rather than adversarial integrity, even a reasonably strong incremental noncryptographic hash could be sufficient.

### P1 and P2 should probably preserve the same semantic IR

This is important because P1 could otherwise become temporary PetPlay-specific engineering.

The plan already says generic WebXR tracked roots should live in raythree, which is good. Pasted text

I'd make P1 implement the **actual future spatial-node representation**, even if the surrounding transport is still a full snapshot.

So instead of a temporary:

```ts
renderAnchor
localMatrix
```

special case, introduce:

```ts
SpatialNode
Item.spatialNode
Item.localMatrix
```

now.

Then current snapshot becomes:

```text
full retained-model snapshot every frame
```

and P2 merely changes:

```text
full snapshot every frame
```

into:

```text
snapshot once
then transactions
```

That means P1 doesn't get thrown away.

### “Sorting moves to renderer” is right, with one caveat

The proposal says sorting should happen renderer-side and only rerun when membership or order keys change. Pasted text

That's ideal for stable opaque UI-ish scenes.

But transparencies can sometimes have camera-dependent depth ordering. If raythree eventually supports arbitrary Three scenes, the IR probably needs to distinguish:

```text
stable explicit order
opaque sort key
transparent depth-sort-required
```

because some draw order genuinely changes with the view even when no item changed.

Not a blocker for PetPlay, just something to avoid encoding “sort is purely scene mutation dependent” into the generic IR.

### The most revealing benchmark may actually be missing

The proposed benchmarks are good. Pasted text

Since your real problem appears to be scheduling variance, I'd add:

```text
230 mostly-static items
renderer thread intentionally subjected to scheduler interference
```

and measure:

```text
p50 / p95 / p99
wake → scene-ready
scene-ready → submit
frame interval error
missed presentation windows
```

Because you might improve:

```text
decode 1.8 ms → 0.25 ms
```

and see a **much larger** improvement in motion than the 1.55 ms difference suggests.

That would validate your broader observation that the bottleneck is not CPU saturation but runnable-work timing.

And I'd keep the distinction between:

```text
renderer apply cost
renderer draw cost
scheduler wait
```

very explicit.

If after P1/P2 you get:

```text
apply: 0.15 ms
draw: 1.0 ms
scheduler wake jitter: 2–4 ms
```

then you've exposed the *next* actual boundary cleanly instead of continuing to optimize IR unnecessarily.

The architecture as written also gives you a really nice eventual fast path. Once retained state exists, “frame” stops being a scene object and becomes just:

```text
render whatever state I currently have
```

That is the conceptual milestone I'd aim for.

Right now:

```text
frame exists
→ therefore renderer may draw
```

After this:

```text
scene updates happen asynchronously

renderer:
  sample tracked poses
  apply whatever latest scene mutations are available
  render retained scene
```

And the proposal is already effectively heading there: static state sends nothing, while the renderer keeps drawing with fresh tracked anchors. Pasted text

So overall I'd rate Claude's ordering very highly:

**P1 is the right immediate fix. P2 is the right architectural fix. P3 is the right time to care about wire representation. P4/P5 are where it becomes a genuinely scalable raythree architecture rather than merely fixing PetPlay.**

The strongest idea in the whole plan is arguably not retained IR by itself, but the combination of:

```text
don't bake compositor-owned motion
+
don't retransmit retained state
+
don't queue obsolete states
+
don't rebuild derived render data from motion
```

Those four together attack almost every place where the current architecture can turn a simple hand movement into scheduler-visible work.
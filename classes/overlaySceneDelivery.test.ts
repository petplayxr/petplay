import {
  OverlayAssetCache,
  OverlaySceneCredit,
  OverlaySceneInbox,
} from "./overlaySceneDelivery.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";
import type { AssetBatch, GeometryAsset } from "../submodules/raythree/src/ir.ts";
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function geometry(id: number, revision = 0): GeometryAsset {
  return {
    id,
    revision,
    topology: "triangles",
    attributes: {
      position: {
        itemSize: 3,
        count: 1,
        normalized: false,
        componentType: "float32",
        array: new Float32Array([id, 0, 0]),
      },
    },
  };
}
function batch(...geometries: GeometryAsset[]): AssetBatch {
  return { geometries, materials: [], textures: [] };
}
Deno.test("receipt credit coalesces scenes without losing assets before GPU adoption", () => {
  const inbox = new OverlaySceneInbox();
  function scene(frameCount: number, assets: AssetBatch, epoch = "producer-a") {
    const eye = { assets, frame: { instances: [] } };
    return {
      frame: { frameCount },
      delivery: { epoch },
      leftEye: eye,
      rightEye: eye,
    } as unknown as WebXRRaythreeRenderPayload;
  }
  inbox.receive(scene(1, batch(geometry(1))));
  inbox.receive(scene(2, batch(geometry(2))));
  const latest = inbox.current()!;
  assert(latest.payload.frame.frameCount === 2, "newest scene wins");
  assert(latest.payload.leftEye.assets.geometries.length === 2, "skipped scene's asset retained");
  inbox.markAdopted(latest);
  assert(
    inbox.current()!.payload.leftEye.assets.geometries.length === 0,
    "GPU adopted assets need not resend",
  );
  inbox.invalidateAdoptedAssets();
  assert(
    inbox.current()!.payload.leftEye.assets.geometries.length === 2,
    "GPU reset replays the retained full baseline without another producer update",
  );
  inbox.receive(scene(3, batch(geometry(1, 1)), "producer-b"));
  inbox.markAdopted(latest);
  const restarted = inbox.current()!;
  assert(
    restarted.payload.leftEye.assets.geometries.length === 1,
    "old epoch adoption cannot acknowledge new assets",
  );
  assert(
    restarted.payload.leftEye.assets.geometries[0].revision === 1,
    "new epoch baseline retained",
  );
});
Deno.test("asset deltas from skipped scenes survive delivery backpressure", () => {
  const cache = new OverlayAssetCache(), credit = new OverlaySceneCredit();
  cache.remember(batch(geometry(1)));
  const first = credit.prepare(cache)!;
  cache.remember(batch(geometry(2)));
  assert(credit.prepare(cache) === null, "only one delivery in flight");
  assert(credit.acknowledge(first.delivery), "first ack accepted");
  const next = credit.prepare(cache)!;
  assert(
    next.assets.geometries.length === 1 && next.assets.geometries[0].id === 2,
    "skipped delta reaches next snapshot",
  );
});
Deno.test("two scene credits overlap transport without losing assets or regressing receipts", () => {
  const cache = new OverlayAssetCache(), credit = new OverlaySceneCredit(2);
  cache.remember(batch(geometry(1)));
  const first = credit.prepare(cache)!;
  assert(!credit.busy, "one packet may overlap the next");
  cache.remember(batch(geometry(2)));
  const second = credit.prepare(cache)!;
  assert(credit.busy && credit.prepare(cache) === null, "two-packet bound enforced");
  assert(second.assets.geometries.length === 2, "second packet includes unreceipted dependencies");
  assert(credit.acknowledge(second.delivery), "later receipt can arrive first");
  assert(credit.acknowledge(first.delivery), "older receipt still releases its slot");
  const next = credit.prepare(cache)!;
  assert(next.assets.geometries.length === 0, "older receipt did not regress asset watermark");
  assert(!credit.acknowledge(second.delivery), "duplicate receipt rejected");
});
Deno.test("a lost receipt expires instead of holding its credit forever", () => {
  const cache = new OverlayAssetCache(), credit = new OverlaySceneCredit(2, 1000);
  cache.remember(batch(geometry(1)));
  const lost = credit.prepare(cache, 0)!;
  cache.remember(batch(geometry(2)));
  credit.prepare(cache, 10);
  assert(credit.busy, "both credits held");
  assert(credit.reclaimExpired(999) === 0 && credit.busy, "receipts are not expired early");
  assert(credit.reclaimExpired(1005) === 1 && !credit.busy, "the lost receipt's credit returns");
  const resent = credit.prepare(cache, 1005)!;
  assert(
    resent.assets.geometries.length === 2,
    "assets of the unreceipted packets are carried again",
  );
  assert(!credit.acknowledge(lost.delivery), "a receipt arriving after expiry is ignored");
  assert(credit.expired === 1, "expiries are counted");
});
Deno.test("asset snapshots own extractor buffers and retain latest revisions", () => {
  const cache = new OverlayAssetCache();
  const asset = geometry(1);
  cache.remember(batch(asset));
  (asset.attributes.position.array as Float32Array)[0] = 99;
  assert(
    cache.since(0).geometries[0].attributes.position.array[0] === 1,
    "cache doesn't alias mutable source",
  );
  cache.remember(batch(geometry(1, 1)));
  assert(
    cache.since(0).geometries.length === 1 && cache.since(0).geometries[0].revision === 1,
    "revisions coalesce by ID",
  );
});
Deno.test("late or foreign acknowledgements cannot release a newer delivery", () => {
  const cache = new OverlayAssetCache(), credit = new OverlaySceneCredit();
  cache.remember(batch(geometry(1)));
  const first = credit.prepare(cache)!;
  assert(credit.acknowledge(first.delivery), "first ack");
  const second = credit.prepare(cache)!;
  assert(
    !credit.acknowledge(first.delivery) && credit.busy,
    "old ack cannot release second message",
  );
  assert(!credit.acknowledge({ ...second.delivery, stream: "other" }), "foreign stream rejected");
  assert(credit.acknowledge(second.delivery), "current ack accepted");
});
Deno.test("new consumers receive complete baseline and failed budgets are transactional", () => {
  const cache = new OverlayAssetCache();
  cache.remember(batch(geometry(1), geometry(2)));
  assert(
    new OverlaySceneCredit().prepare(cache)!.assets.geometries.length === 2,
    "late consumer gets full cache",
  );
  const bounded = new OverlayAssetCache(1);
  let failed = false;
  try {
    bounded.remember(batch(geometry(1)));
  } catch {
    failed = true;
  }
  assert(
    failed && bounded.version === 0 && bounded.bytes === 0,
    "budget failure does not partially advance cache",
  );
});

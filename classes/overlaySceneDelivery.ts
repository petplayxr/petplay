import type { AssetBatch } from "../submodules/raythree/src/ir.ts";
import type { WebXRRaythreeRenderPayload } from "./webxrRaythreeScene.ts";

export type SceneDelivery = {
  epoch: string;
  stream: string;
  sequence: number;
  assetVersion: number;
  /** Acknowledged independently by the compact UI-geometry transport. */
  uiGeometryVersion?: number;
};
const kinds = ["geometries", "materials", "textures"] as const;
type Kind = typeof kinds[number];
type Asset = AssetBatch[Kind][number];

function byteSize(value: unknown): number {
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === "string") return value.length * 2;
  if (value && typeof value === "object") {
    return Object.values(value).reduce<number>((sum, v) => sum + byteSize(v), 0);
  }
  return 8;
}

/** Retains the latest revision even when the scene carrying its delta is skipped. */
export class OverlayAssetCache {
  readonly epoch = crypto.randomUUID();
  version = 0;
  bytes = 0;
  private readonly assets = new Map<
    string,
    { kind: Kind; asset: Asset; version: number; bytes: number }
  >();
  constructor(private readonly byteLimit = 256 * 1024 * 1024) {}

  remember(batch: AssetBatch): void {
    const changes = new Map<string, { kind: Kind; asset: Asset; bytes: number }>();
    let bytes = this.bytes;
    for (const kind of kinds) {
      for (const asset of batch[kind]) {
        const key = `${kind}:${asset.id}`;
        const previous = changes.get(key) ?? this.assets.get(key);
        if (previous?.asset.revision === asset.revision) continue;
        const size = byteSize(asset);
        bytes += size - (previous?.bytes ?? 0);
        changes.set(key, { kind, asset, bytes: size });
      }
    }
    if (bytes > this.byteLimit) {
      throw new Error(`IR asset cache exceeds ${this.byteLimit} bytes; scene delivery paused`);
    }
    for (const [key, value] of changes) {
      this.assets.set(key, {
        ...value,
        asset: structuredClone(value.asset),
        version: ++this.version,
      });
    }
    this.bytes = bytes;
  }

  since(version: number): AssetBatch {
    const batch: AssetBatch = { geometries: [], materials: [], textures: [] };
    for (const entry of this.assets.values()) {
      if (entry.version > version) {
        // Kind and asset originate from the same typed batch above.
        (batch[entry.kind] as Asset[]).push(entry.asset);
      }
    }
    return batch;
  }
}

/**
 * Bounded delivery credits. Every packet includes all assets since the highest receipt.
 * A receipt that never arrives expires after `expiryMs`; until then the credit stays held, so a
 * lost receipt costs a bounded pause instead of stopping delivery for good. An expired packet's
 * assets are not counted as received, so the next packet carries them again.
 */
export class OverlaySceneCredit {
  readonly stream = crypto.randomUUID();
  private sequence = 0;
  private acknowledgedAssets = 0;
  private readonly pending = new Map<number, SceneDelivery & { sentAt: number }>();
  /** Receipts that never arrived and whose credit was taken back. */
  expired = 0;
  constructor(private readonly capacity = 1, private readonly expiryMs = 1000) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Invalid scene credit capacity");
    }
  }
  get inFlight(): number {
    return this.pending.size;
  }
  get busy(): boolean {
    return this.pending.size >= this.capacity;
  }
  /** Takes back the credit of deliveries unacknowledged for `expiryMs`; returns how many. */
  reclaimExpired(now = performance.now()): number {
    let reclaimed = 0;
    for (const [sequence, pending] of this.pending) {
      if (now - pending.sentAt < this.expiryMs) continue;
      this.pending.delete(sequence);
      reclaimed++;
    }
    this.expired += reclaimed;
    return reclaimed;
  }
  prepare(
    cache: OverlayAssetCache,
    now = performance.now(),
  ): { delivery: SceneDelivery; assets: AssetBatch } | null {
    if (this.busy) return null;
    const delivery = {
      epoch: cache.epoch,
      stream: this.stream,
      sequence: ++this.sequence,
      assetVersion: cache.version,
    };
    this.pending.set(delivery.sequence, { ...delivery, sentAt: now });
    return { delivery, assets: cache.since(this.acknowledgedAssets) };
  }
  acknowledge(delivery?: SceneDelivery): boolean {
    const pending = delivery && this.pending.get(delivery.sequence);
    if (!pending) return false;
    // Legacy desktop consumers are also upgraded to echo delivery identity.
    if (
      !delivery || delivery.epoch !== pending.epoch || delivery.stream !== this.stream ||
      delivery.assetVersion !== pending.assetVersion
    ) return false;
    this.acknowledgedAssets = Math.max(this.acknowledgedAssets, pending.assetVersion);
    this.pending.delete(delivery.sequence);
    return true;
  }
}

/** Receipt can return credit before drawing: skipped snapshots retain their asset dependencies. */
export class OverlaySceneInbox {
  private cache = new OverlayAssetCache();
  private epoch: string | null = null;
  private adopted = 0;
  private latest: WebXRRaythreeRenderPayload | null = null;

  receive(payload: WebXRRaythreeRenderPayload): void {
    const epoch = payload.delivery?.epoch ?? "legacy";
    if (epoch !== this.epoch) {
      this.cache = new OverlayAssetCache();
      this.adopted = 0;
      this.epoch = epoch;
    }
    this.cache.remember(payload.leftEye.assets);
    this.latest = payload;
  }

  current() {
    if (!this.latest) return null;
    const eye = { ...this.latest.leftEye, assets: this.cache.since(this.adopted) };
    return {
      epoch: this.epoch,
      assetVersion: this.cache.version,
      payload: { ...this.latest, leftEye: eye, rightEye: eye },
    };
  }

  /** Replay the retained baseline after a GPU consumer reset (e.g. a diagnostic scene). */
  invalidateAdoptedAssets(): void {
    this.adopted = 0;
  }

  markAdopted(frame: { epoch: string | null; assetVersion: number }): void {
    if (frame.epoch === this.epoch) this.adopted = Math.max(this.adopted, frame.assetVersion);
  }
}

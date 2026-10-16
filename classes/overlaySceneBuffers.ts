import { Buffer } from "node:buffer";

const TAG = "__petplayTypedView";
const types = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
] as const;
export type PackedScene = { bufferFormat: "petplay-views-v1"; root: unknown; slab: ArrayBuffer };
const LIMIT = 256 * 1024 * 1024;

/** One backing store per packet avoids V8's per-view host-object copies on decode. */
export function packSceneBuffers(
  root: unknown,
  byteLimit = LIMIT,
  unpacked: readonly object[] = [],
): PackedScene {
  const opaque = new WeakSet(unpacked);
  const seen = new WeakMap<object, unknown>();
  const parts: { bytes: Uint8Array; offset: number }[] = [];
  let size = 0;
  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (opaque.has(value)) return value;
    if (ArrayBuffer.isView(value)) {
      const kind = value instanceof DataView
        ? 11
        : Buffer.isBuffer(value)
        ? 12
        : types.findIndex((type) => value instanceof type);
      if (kind < 0) throw new Error("Unsupported scene typed view");
      const offset = Math.ceil(size / 8) * 8;
      size = offset + value.byteLength;
      if (size > byteLimit) throw new Error("Scene buffer budget exceeded");
      const ref = { [TAG]: [kind, offset, value.byteLength] };
      seen.set(value, ref);
      parts.push({
        bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        offset,
      });
      return ref;
    }
    if (value instanceof ArrayBuffer || value instanceof Date) return value;
    if (value instanceof Map) {
      const out = new Map();
      seen.set(value, out);
      for (const [k, v] of value) out.set(visit(k), visit(v));
      return out;
    }
    if (value instanceof Set) {
      const out = new Set();
      seen.set(value, out);
      for (const v of value) out.add(visit(v));
      return out;
    }
    if (Object.hasOwn(value, TAG)) throw new Error("Reserved scene view descriptor");
    const out: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? []
      : Object.create(null);
    seen.set(value, out);
    for (const [key, v] of Object.entries(value)) (out as Record<string, unknown>)[key] = visit(v);
    return out;
  }
  const packedRoot = visit(root);
  const slab = new ArrayBuffer(size), bytes = new Uint8Array(slab);
  for (const part of parts) bytes.set(part.bytes, part.offset);
  return { bufferFormat: "petplay-views-v1", root: packedRoot, slab };
}

/** Mutate owned decoded metadata in place; all reconstructed views share the owned packet slab. */
export function unpackSceneBuffers<T>(packed: PackedScene, byteLimit = LIMIT): T {
  if (
    packed.bufferFormat !== "petplay-views-v1" || !(packed.slab instanceof ArrayBuffer) ||
    packed.slab.byteLength > byteLimit
  ) throw new Error("Invalid packed scene buffers");
  const seen = new WeakMap<object, unknown>();
  function visit(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Object.hasOwn(value, TAG)) {
      const ref = (value as Record<string, unknown>)[TAG];
      if (
        Object.keys(value).length !== 1 || !Array.isArray(ref) || ref.length !== 3 ||
        !ref.every(Number.isSafeInteger)
      ) throw new Error("Invalid scene view descriptor");
      const [kind, offset, bytes] = ref as number[];
      const ctor = types[kind];
      const alignment = kind === 11 || kind === 12 ? 1 : ctor?.BYTES_PER_ELEMENT;
      if (
        !alignment || offset < 0 || bytes < 0 || offset % alignment || bytes % alignment ||
        offset + bytes > packed.slab.byteLength
      ) throw new Error("Invalid scene view range");
      const view = kind === 11
        ? new DataView(packed.slab, offset, bytes)
        : kind === 12
        ? Buffer.from(packed.slab, offset, bytes)
        : new ctor(packed.slab, offset, bytes / alignment);
      seen.set(value, view);
      return view;
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Date) {
      return value;
    }
    seen.set(value, value);
    if (value instanceof Map) {
      const entries = [...value];
      value.clear();
      for (const [k, v] of entries) value.set(visit(k), visit(v));
    } else if (value instanceof Set) {
      const entries = [...value];
      value.clear();
      for (const v of entries) value.add(visit(v));
    } else {
      for (const key of Object.keys(value)) {
        (value as Record<string, unknown>)[key] = visit((value as Record<string, unknown>)[key]);
      }
    }
    return value;
  }
  return visit(packed.root) as T;
}

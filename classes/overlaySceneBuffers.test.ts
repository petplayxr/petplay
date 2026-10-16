import { packSceneBuffers, unpackSceneBuffers } from "./overlaySceneBuffers.ts";
import { deserialize, serialize } from "node:v8";
import { Buffer } from "node:buffer";
function assert(v: unknown, message: string): asserts v {
  if (!v) throw new Error(message);
}
function roundtrip<T>(v: T): T {
  return unpackSceneBuffers(deserialize(serialize(packSceneBuffers(v))));
}
Deno.test("packed buffers preserve numeric view types, subranges, contents and repeated-view aliases", () => {
  const views = [
    new Int8Array([-1]),
    new Uint8Array([255]),
    new Uint8ClampedArray([10]),
    new Int16Array([-500]),
    new Uint16Array([65535]),
    new Int32Array([-999999]),
    new Uint32Array([999999]),
    new Float32Array([.25]),
    new Float64Array([Math.PI]),
    new BigInt64Array([-3n]),
    new BigUint64Array([4n]),
    new DataView(new Uint8Array([7, 8, 9]).buffer, 1, 1),
    Buffer.from([10, 11]),
  ];
  const r = roundtrip({ views, again: views[7] });
  for (let i = 0; i < views.length; i++) {
    assert(r.views[i].constructor === views[i].constructor, "view type lost");
    const a = new Uint8Array(views[i].buffer, views[i].byteOffset, views[i].byteLength),
      b = new Uint8Array(r.views[i].buffer, r.views[i].byteOffset, r.views[i].byteLength);
    assert(a.length === b.length && a.every((v, j) => v === b[j]), "view bytes changed");
  }
  assert(r.again === r.views[7], "repeated view alias lost");
  assert(
    r.views.every((v) => v.buffer === r.views[0].buffer),
    "transient views do not share packet slab",
  );
});
Deno.test("packed scene graph retains stereo aliases, cycles, ownership and separate packet storage", () => {
  const eye = { matrix: new Float32Array([1, 2, 3]) };
  const a: { left: typeof eye; right: typeof eye; self?: unknown } = { left: eye, right: eye };
  a.self = a;
  const packed = packSceneBuffers(a);
  eye.matrix[0] = 99;
  const b = unpackSceneBuffers<typeof a>(deserialize(serialize(packed)));
  assert(b.left === b.right && b.self === b, "graph aliases lost");
  assert(b.left.matrix[0] === 1, "producer mutation leaked");
  const c = roundtrip(a);
  b.left.matrix[0] = 5;
  assert(c.left.matrix[0] === 99 && eye.matrix[0] === 99, "packets alias one another");
});
Deno.test("persistent asset buffers can stay outside transient slabs", () => {
  const asset = { data: new Float32Array([1, 2, 3]) },
    v = { asset, frame: new Float32Array([4, 5]) };
  const packed = packSceneBuffers(v, 1024, [asset]);
  const r = unpackSceneBuffers<typeof v>(deserialize(serialize(packed)));
  assert(r.asset.data.buffer !== r.frame.buffer, "long-lived asset retained transient packet slab");
});
Deno.test("invalid descriptors, reserved fields and budget violations fail closed", () => {
  for (const ref of [[7, 0, 100], [8, 1, 8], [99, 0, 4], [7, -4, 4], [7, 0, 3], [7, 0, NaN]]) {
    let failed = false;
    try {
      unpackSceneBuffers({
        bufferFormat: "petplay-views-v1",
        root: { __petplayTypedView: ref },
        slab: new ArrayBuffer(16),
      });
    } catch {
      failed = true;
    }
    assert(failed, "invalid range accepted");
  }
  let failed = false;
  try {
    packSceneBuffers({ __petplayTypedView: [7, 0, 4] });
  } catch {
    failed = true;
  }
  assert(failed, "reserved descriptor input accepted");
  failed = false;
  try {
    packSceneBuffers(new Float64Array(10), 16);
  } catch {
    failed = true;
  }
  assert(failed, "encoder budget ignored");
  failed = false;
  try {
    unpackSceneBuffers(packSceneBuffers(new Float64Array(10)), 16);
  } catch {
    failed = true;
  }
  assert(failed, "decoder budget ignored");
});

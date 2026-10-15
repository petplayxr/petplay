// Isolated transparent parent/subviews: check projection conversion and parent publication.
// Run from the repository: deno run -A --no-check markdown/projection-overlay-re/tools/overlay-parent.ts
import raylib from "../../../submodules/raylib_ts_bindings_deno/raylib_bindings.ts";
import { getOpenVrLibraryPath, getRaylibLibraryPath } from "../../../classes/nativeLibraryPaths.ts";
const lib = Deno.dlopen(getOpenVrLibraryPath(), {
  VR_InitInternal: { parameters: ["buffer", "i32"], result: "u32" },
  VR_GetGenericInterface: { parameters: ["buffer", "buffer"], result: "pointer" },
  VR_ShutdownInternal: { parameters: [], result: "void" },
});
const e = new Uint8Array(4), cs = (s: string) => new TextEncoder().encode(s + "\0");
const fn = (
  table: Deno.PointerObject,
  slot: number,
  parameters: Deno.NativeType[],
  result: Deno.NativeResultType,
) =>
  new Deno.UnsafeFnPointer(
    Deno.UnsafePointer.create(new Deno.UnsafePointerView(table).getBigUint64(slot * 8))!,
    { parameters, result },
  );
let overlay = 0n;
const banks: bigint[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let initialized = false, window = false;
let cleanup = () => {};
const textures: raylib.Texture2D[] = [];
try {
  lib.symbols.VR_InitInternal(e, 2);
  initialized = true;
  if (new DataView(e.buffer).getUint32(0, true)) throw Error("OpenVR init failed");
  const table = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlay_028"), e)!;
  const create = fn(table, 1, ["buffer", "buffer", "buffer"], "i32"),
    destroy = fn(table, 3, ["u64"], "i32");
  const createSubview = fn(table, 2, ["u64", "buffer", "buffer", "buffer"], "i32");
  const getType = fn(table, 32, ["u64", "buffer"], "i32");
  const visible = fn(table, 45, ["u64"], "bool");
  const show = fn(table, 43, ["u64"], "i32"), hide = fn(table, 44, ["u64"], "i32");
  const projection = fn(table, 41, ["u64", "i32", "buffer", "buffer", "i32"], "i32");
  const alpha = fn(table, 16, ["u64", "f32"], "i32");
  const check = (r: unknown) => {
    if (r !== 0) throw Error("overlay call " + r);
  };
  const set = fn(table, 60, ["u64", "buffer"], "i32"), clear = fn(table, 61, ["u64"], "i32");
  cleanup = () => {
    for (const h of banks) hide.call(h);
    for (const h of banks) {
      clear.call(h);
      destroy.call(h);
    }
    if (overlay !== 0n && !banks.includes(overlay)) destroy.call(overlay);
  };
  raylib.loadRaylib(getRaylibLibraryPath());
  raylib.SetTraceLogLevel(raylib.TraceLogLevel.LOG_WARNING);
  raylib.SetConfigFlags(raylib.ConfigFlags.FLAG_WINDOW_HIDDEN);
  raylib.H.InitWindow(32, 32, "PetPlay hidden overlay ownership probe");
  window = true;
  for (
    const color of [{ r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 255, b: 0, a: 255 }, {
      r: 0,
      g: 0,
      b: 255,
      a: 255,
    }]
  ) {
    const image = raylib.H.GenImageColor(2, 2, color);
    textures.push(raylib.H.LoadTextureFromImage(image));
    raylib.H.UnloadImage(image);
  }
  const handle = new BigUint64Array(1);
  const key = "petplay.re.parent." + Deno.pid;
  const code = create.call(cs(key), cs(key), new Uint8Array(handle.buffer));
  if (code !== 0) throw Error("create " + code);
  overlay = handle[0];
  const submit = (id: number) => {
    const texture = new Uint8Array(16);
    const v = new DataView(texture.buffer);
    v.setBigUint64(0, BigInt(id), true);
    v.setInt32(8, 1, true);
    v.setInt32(12, 0, true);
    const r = set.call(overlay, texture);
    if (r !== 0) throw Error("submit " + r);
  };
  const parent = overlay;
  banks.push(parent);
  check(alpha.call(parent, 0));
  submit(textures[0].id);
  for (let i = 0; i < 2; i++) {
    const k = key + ".child." + i;
    check(createSubview.call(parent, cs(k), cs(k), new Uint8Array(handle.buffer)));
    banks.push(handle[0]);
    check(alpha.call(handle[0], 0));
    overlay = handle[0];
    submit(textures[i + 1].id);
    check(show.call(overlay));
  }
  const types = () =>
    banks.map((h) => {
      const data = new Uint8Array(4);
      check(getType.call(h, data));
      return new DataView(data.buffer).getInt32(0, true);
    });
  const report = (label: string) =>
    console.log(label, {
      types: types(),
      visible: banks.map((h) => visible.call(h)),
    });
  console.log("parent/child indices", banks.map((h) => Number(h & 0xffffffffn)));
  report("created subviews");
  check(show.call(parent));
  await pause(200);
  report("ordinary subviews, parent shown");
  check(hide.call(parent));
  await pause(200);
  report("ordinary subviews, parent hidden");
  for (let i = 0; i < 2; i++) {
    const matrix = new Float32Array([1, 0, 0, i === 0 ? 0.25 : -0.25, 0, 1, 0, 0, 0, 0, 1, 0]);
    const frustum = new Float32Array([-1, 1, -1, 1]);
    const h = banks[i + 1];
    check(projection.call(h, 1, new Uint8Array(matrix.buffer), new Uint8Array(frustum.buffer), i));
    check(show.call(h));
  }
  report("projection conversion, parent hidden");
  check(show.call(parent));
  await pause(200);
  report("projection conversion, parent shown");
  check(hide.call(parent));
  await pause(200);
  report("projection conversion, parent hidden again");
  if (types().slice(1).some((t) => t !== 8)) throw Error("children are not projection overlays");
  const parentMatrix = new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 0, 0, 0, 1, 0]);
  const parentFrustum = new Float32Array([-1, 1, -1, 1]);
  check(
    projection.call(
      parent,
      1,
      new Uint8Array(parentMatrix.buffer),
      new Uint8Array(parentFrustum.buffer),
      0,
    ),
  );
  check(show.call(parent));
  await pause(200);
  report("parent changed to left projection as an inheritance control");
  check(hide.call(parent));
  // Leave child poses/images unchanged while exercising only the one parent visibility bit.
  for (let n = 0; n < 20; n++) {
    check(show.call(parent));
    await pause(20);
    check(hide.call(parent));
    await pause(20);
  }
} finally {
  cleanup();
  if (initialized) lib.symbols.VR_ShutdownInternal();
  if (window) {
    for (const t of textures) raylib.H.UnloadTexture(t);
    raylib.CloseWindow();
  }
  lib.close();
}

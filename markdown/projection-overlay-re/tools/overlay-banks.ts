// Isolated transparent banks: test independent pins and interrupted visibility swaps.
// Run from the repository: deno run -A --no-check markdown/projection-overlay-re/tools/overlay-banks.ts
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
const pins: Uint8Array[] = [];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let initialized = false, window = false;
let cleanup = () => {};
const textures: raylib.Texture2D[] = [];
try {
  lib.symbols.VR_InitInternal(e, 2);
  initialized = true;
  if (new DataView(e.buffer).getUint32(0, true)) throw Error("OpenVR init failed");
  const table = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlay_027"), e)!;
  const views = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlayView_003"), e)!;
  const create = fn(table, 1, ["buffer", "buffer", "buffer"], "i32"),
    destroy = fn(table, 6, ["u64"], "i32");
  const show = fn(table, 41, ["u64"], "i32"), hide = fn(table, 42, ["u64"], "i32");
  const projection = fn(table, 40, ["u64", "i32", "buffer", "buffer", "i32"], "i32");
  const alpha = fn(table, 15, ["u64", "f32"], "i32");
  const check = (r: unknown) => {
    if (r !== 0) throw Error("overlay call " + r);
  };
  const set = fn(table, 58, ["u64", "buffer"], "i32"), clear = fn(table, 59, ["u64"], "i32");
  const acquire = fn(views, 0, ["u64", "pointer", "buffer", "u32"], "i32"),
    release = fn(views, 1, ["buffer"], "i32");
  cleanup = () => {
    for (const h of banks) hide.call(h);
    for (const pin of pins) release.call(pin);
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
  const key = "petplay.re.banks." + Deno.pid;
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
  const texture = (view: Uint8Array) => {
    const v = new DataView(view.buffer);
    return {
      id: Number(v.getBigUint64(8, true)),
      width: 2,
      height: 2,
      mipmaps: 1,
      format: raylib.PixelFormat.PIXELFORMAT_UNCOMPRESSED_R8G8B8A8,
    };
  };
  const pixel = (view: Uint8Array) => {
    const im = raylib.H.LoadImageFromTexture(texture(view));
    try {
      return raylib.H.GetImageColor(im, 0, 0);
    } finally {
      raylib.H.UnloadImage(im);
    }
  };
  banks.push(overlay);
  for (let i = 1; i < 4; i++) {
    const k = key + "." + i;
    check(create.call(cs(k), cs(k), new Uint8Array(handle.buffer)));
    banks.push(handle[0]);
  }
  console.log("bank indices", banks.map((h) => Number(h & 0xffffffffn)));
  // Alpha zero keeps these experiment overlays invisible to the headset user.
  for (let i = 0; i < banks.length; i++) {
    overlay = banks[i];
    check(alpha.call(overlay, 0));
    const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const frustum = new Float32Array([-1, 1, -1, 1]);
    check(
      projection.call(
        overlay,
        1,
        new Uint8Array(matrix.buffer),
        new Uint8Array(frustum.buffer),
        i % 2,
      ),
    );
    submit(textures[i < 2 ? 0 : 1].id);
    const pin = new Uint8Array(40);
    check(acquire.call(overlay, null, pin, 40));
    pins.push(pin);
  }
  const expected = [255, 255, 0, 0];
  const verify = (label: string) => {
    const pixels = pins.map(pixel);
    console.log(label, pixels);
    if (pixels.some((p, i) => p.r !== expected[i] || p.g !== 255 - expected[i] || p.b !== 0)) {
      throw Error("independent bank pins did not retain their initial pixels");
    }
  };
  verify("initial pinned pixels");
  for (let i = 0; i < banks.length; i++) {
    overlay = banks[i];
    for (let n = 0; n < 20; n++) submit(textures[2].id);
  }
  verify("after all banks receive blue");
  // Each group is two handles: the API has no stereo visibility transaction.
  for (const h of banks.slice(0, 2)) check(show.call(h));
  await pause(150);
  console.log("overlap start");
  for (const h of banks.slice(2)) check(show.call(h));
  await pause(80); // Deliberately stall between show and hide.
  for (const h of banks.slice(0, 2)) check(hide.call(h));
  await pause(150);
  console.log("blank start");
  for (const h of banks.slice(2)) check(hide.call(h));
  await pause(80); // Reverse order demonstrates the missing bank alternative.
  for (const h of banks.slice(0, 2)) check(show.call(h));
  await pause(150);
  console.log("stereo split start");
  check(show.call(banks[2]));
  check(hide.call(banks[0]));
  await pause(80); // Stall after left-eye swap, before right-eye swap.
  check(show.call(banks[3]));
  check(hide.call(banks[1]));
  await pause(150);
} finally {
  cleanup();
  if (initialized) lib.symbols.VR_ShutdownInternal();
  if (window) {
    for (const t of textures) raylib.H.UnloadTexture(t);
    raylib.CloseWindow();
  }
  lib.close();
}

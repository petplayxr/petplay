// Isolated, hidden 2x2 overlay: pin a submitted image and test reuse after re-acquisition.
// Run from the repository: deno run -A --no-check markdown/projection-overlay-re/tools/overlay-view.ts
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
const held = new Uint8Array(40), next = new Uint8Array(40);
let initialized = false, window = false;
const textures: raylib.Texture2D[] = [];
try {
  lib.symbols.VR_InitInternal(e, 2);
  initialized = true;
  if (new DataView(e.buffer).getUint32(0, true)) throw Error("OpenVR init failed");
  const table = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlay_027"), e)!;
  const views = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlayView_003"), e)!;
  const create = fn(table, 1, ["buffer", "buffer", "buffer"], "i32"),
    destroy = fn(table, 6, ["u64"], "i32");
  const set = fn(table, 58, ["u64", "buffer"], "i32"), clear = fn(table, 59, ["u64"], "i32");
  const acquire = fn(views, 0, ["u64", "pointer", "buffer", "u32"], "i32"),
    release = fn(views, 1, ["buffer"], "i32");
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
  const key = "petplay.re.lockedview." + Deno.pid;
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
  submit(textures[0].id);
  let r = acquire.call(overlay, null, held, 40);
  console.log("acquire red", r, "view", Array.from(new BigUint64Array(held.buffer)));
  if (r !== 0) throw Error("acquire " + r);
  console.log("held before", pixel(held));
  for (let i = 0; i < 20; i++) submit(textures[1].id);
  console.log("held after 20 green submits", pixel(held));
  r = acquire.call(overlay, null, next, 40);
  console.log("acquire green", r, "view", Array.from(new BigUint64Array(next.buffer)));
  if (r === 0) console.log("new view", pixel(next));
  for (let i = 0; i < 20; i++) submit(textures[2].id);
  console.log("first view after second acquisition and blue submits", pixel(held));
  console.log("second view after blue submits", pixel(next));
  release.call(next);
  release.call(held);
  clear.call(overlay);
  destroy.call(overlay);
  overlay = 0n;
} finally {
  if (overlay !== 0n) {
    console.log("probe failed; shutting down its OpenVR client to release owned overlay");
  }
  if (initialized) lib.symbols.VR_ShutdownInternal();
  if (window) {
    for (const t of textures) raylib.H.UnloadTexture(t);
    raylib.CloseWindow();
  }
  lib.close();
}

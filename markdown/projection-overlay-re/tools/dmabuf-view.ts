// Read transparent DMA-BUF generations through public OverlayView; not compositor output.
// Run from the repository: deno run -A --no-check markdown/projection-overlay-re/tools/dmabuf-view.ts <publisher-pid>
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
const retained: Uint8Array[] = [];
let initialized = false, window = false;
const textures: raylib.Texture2D[] = [];
try {
  lib.symbols.VR_InitInternal(e, 2);
  initialized = true;
  if (new DataView(e.buffer).getUint32(0, true)) throw Error("OpenVR init failed");
  const table = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlay_027"), e)!;
  const views = lib.symbols.VR_GetGenericInterface(cs("FnTable:IVROverlayView_003"), e)!;
  const find = fn(table, 0, ["buffer", "buffer"], "i32");
  const acquire = fn(views, 0, ["u64", "pointer", "buffer", "u32"], "i32"),
    release = fn(views, 1, ["buffer"], "i32");
  raylib.loadRaylib(getRaylibLibraryPath());
  raylib.SetTraceLogLevel(raylib.TraceLogLevel.LOG_WARNING);
  raylib.SetConfigFlags(raylib.ConfigFlags.FLAG_WINDOW_HIDDEN);
  raylib.H.InitWindow(32, 32, "PetPlay hidden overlay ownership probe");
  window = true;
  const handle = new BigUint64Array(1);
  const key = "petplay.re.dmabuf." + Deno.args[0];
  const r = find.call(cs(key), new Uint8Array(handle.buffer));
  if (r !== 0) throw Error("find " + r);
  overlay = handle[0];
  const texture = (view: Uint8Array) => {
    const v = new DataView(view.buffer);
    return {
      id: Number(v.getBigUint64(8, true)),
      width: 16,
      height: 16,
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
  for (let generation = 1; generation <= 3; generation++) {
    const view = new Uint8Array(40);
    const r = acquire.call(overlay, null, view, 40);
    if (r !== 0) throw Error("acquire " + r);
    retained.push(view);
    console.log("view", generation, pixel(view));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  console.log("retained generation pixels", retained.map(pixel));
  for (const view of retained) release.call(view);
  overlay = 0n;
} finally {
  if (overlay !== 0n) {
    console.log("reader failed; shutting down its own OpenVR client");
  }
  if (initialized) lib.symbols.VR_ShutdownInternal();
  if (window) {
    for (const t of textures) raylib.H.UnloadTexture(t);
    raylib.CloseWindow();
  }
  lib.close();
}

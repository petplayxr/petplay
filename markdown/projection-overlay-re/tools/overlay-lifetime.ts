// Isolated transparent overlay lifetimes: source swaps, clear/resubmit, and handle recreation.
// Run from the repository: deno run -A --no-check markdown/projection-overlay-re/tools/overlay-lifetime.ts
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
    const color of [{ r: 255, g: 0, b: 0, a: 0 }, { r: 0, g: 255, b: 0, a: 0 }, {
      r: 0,
      g: 0,
      b: 255,
      a: 0,
    }]
  ) {
    const image = raylib.H.GenImageColor(2, 2, color);
    textures.push(raylib.H.LoadTextureFromImage(image));
    raylib.H.UnloadImage(image);
  }
  const handle = new BigUint64Array(1);
  // Transparent texels with overlay alpha 1 exercise imports/draws without a visible image.
  const key = "petplay.re.lifetime." + Deno.pid;
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
  banks.push(overlay);
  const configure = () => {
    check(alpha.call(overlay, 1));
    const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    const frustum = new Float32Array([-1, 1, -1, 1]);
    check(
      projection.call(overlay, 1, new Uint8Array(matrix.buffer), new Uint8Array(frustum.buffer), 0),
    );
  };
  console.log("probe pid", Deno.pid);
  configure();
  for (let i = 0; i < 3; i++) {
    console.log(
      "source swap",
      i,
      "overlay",
      overlay.toString(),
      "index",
      Number(overlay & 0xffffffffn),
    );
    submit(textures[i].id);
    check(show.call(overlay));
    await pause(180);
  }
  check(hide.call(overlay));
  check(clear.call(overlay));
  submit(textures[0].id);
  check(show.call(overlay));
  console.log("clear/resubmit", overlay.toString());
  await pause(180);
  for (let n = 0; n < 4; n++) {
    check(hide.call(overlay));
    check(clear.call(overlay));
    check(destroy.call(overlay));
    banks.length = 0;
    overlay = 0n;
    const k = key + ".recreate." + n;
    check(create.call(cs(k), cs(k), new Uint8Array(handle.buffer)));
    overlay = handle[0];
    banks.push(overlay);
    configure();
    submit(textures[n % textures.length].id);
    check(show.call(overlay));
    console.log(
      "recreate",
      n,
      "overlay",
      overlay.toString(),
      "index",
      Number(overlay & 0xffffffffn),
    );
    await pause(180);
  }
  check(hide.call(overlay));
  check(clear.call(overlay));
  check(destroy.call(overlay));
  banks.length = 0;
  overlay = 0n;
  await pause(1200); // Capture deferred cleanup after these diagnostic releases.
} finally {
  cleanup();
  if (initialized) lib.symbols.VR_ShutdownInternal();
  if (window) {
    for (const t of textures) raylib.H.UnloadTexture(t);
    raylib.CloseWindow();
  }
  lib.close();
}

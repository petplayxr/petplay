const lib = Deno.dlopen("/usr/lib/libopenvr_api.so", {
  VR_InitInternal: { parameters: ["buffer", "i32"], result: "pointer" },
  VR_ShutdownInternal: { parameters: [], result: "void" },
  VR_GetGenericInterface: { parameters: ["buffer", "buffer"], result: "pointer" },
});
const cstr = (s: string) => new TextEncoder().encode(s + "\0");
const err = new Uint8Array(4);
lib.symbols.VR_InitInternal(err, 2);
const base = BigInt("0x" + Deno.readTextFileSync("/proc/self/maps").split("\n").find((l) => l.includes("vrclient.so"))!.split("-")[0]);
const ft = lib.symbols.VR_GetGenericInterface(cstr("FnTable:IVROverlay_027"), err)!;
const v = new Deno.UnsafePointerView(ft);
for (const [n, i] of [["SetOverlayTransformProjection", 40], ["SetOverlayTexture", 58], ["WaitFrameSync", 45]] as const)
  console.log(n, (v.getBigUint64(i * 8) - base).toString(16));
const ov = lib.symbols.VR_GetGenericInterface(cstr("IVROverlay_029"), err)!;
const vt = new Deno.UnsafePointerView(Deno.UnsafePointer.create(new Deno.UnsafePointerView(ov).getBigUint64(0))!);
// _029 has 84 methods. Entry 84 is RTTI for the neighboring table, not a method.
console.log("029:", Array.from({ length: 84 }, (_, i) => `${i}:${(vt.getBigUint64(i * 8) - base).toString(16)}`).join(" "));
lib.symbols.VR_ShutdownInternal();

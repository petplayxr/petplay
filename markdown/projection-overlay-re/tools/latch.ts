const lib = Deno.dlopen("/usr/lib/libopenvr_api.so", {
  VR_InitInternal: { parameters: ["buffer", "i32"], result: "pointer" },
  VR_ShutdownInternal: { parameters: [], result: "void" },
  VR_GetGenericInterface: { parameters: ["buffer", "buffer"], result: "pointer" },
});
const cstr = (s: string) => new TextEncoder().encode(s + "\0");
const err = new Uint8Array(4);
lib.symbols.VR_InitInternal(err, 2);
const sysTable = lib.symbols.VR_GetGenericInterface(cstr("FnTable:IVRSystem_023"), err) ??
  lib.symbols.VR_GetGenericInterface(cstr("FnTable:IVRSystem_022"), err);
const sinceVsync = new Deno.UnsafeFnPointer(
  Deno.UnsafePointer.create(new Deno.UnsafePointerView(sysTable!).getBigUint64(5 * 8))!,
  { parameters: ["buffer", "buffer"], result: "bool" } as const,
);
const ov = lib.symbols.VR_GetGenericInterface(cstr("IVROverlay_029"), err)!;
const vt = new Deno.UnsafePointerView(Deno.UnsafePointer.create(new Deno.UnsafePointerView(ov).getBigUint64(0))!);
const slot = (i: number) =>
  new Deno.UnsafeFnPointer(Deno.UnsafePointer.create(vt.getBigUint64(i * 8))!, { parameters: ["pointer", "u32"], result: "i32" } as const);
const waits = { frameSync: slot(47), latchSync: slot(48) };
const s = new Float32Array(1), fc = new BigUint64Array(1);
const phase = () => { sinceVsync.call(new Uint8Array(s.buffer), new Uint8Array(fc.buffer)); return [s[0] * 1000, Number(fc[0])]; };
const q = (v: number[]) => { v.sort((a, b) => a - b); const p = (f: number) => v[Math.floor(f * (v.length - 1))].toFixed(2); return `min ${p(0)} p5 ${p(.05)} p50 ${p(.5)} p95 ${p(.95)} max ${p(1)}`; };
for (const [name, fn] of Object.entries(waits)) {
  const ms: number[] = [], codes = new Map<number, number>(), frames = new Set<number>();
  for (let i = 0; i < (name === "latchSync" ? 20 : 300); i++) { const t0 = performance.now();
    const r = fn.call(ov, 100);
    const [p, f] = phase();
    codes.set(r, (codes.get(r) ?? 0) + 1); if (name === "latchSync" && i < 5) console.log("latch r", r, "took", (performance.now() - t0).toFixed(1)); ms.push(p); frames.add(f);
  }
  console.log(name, "codes", JSON.stringify([...codes]), "distinct frames", frames.size, "/n |", q(ms));
}
lib.symbols.VR_ShutdownInternal();

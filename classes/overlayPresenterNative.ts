import { IVROverlay_Version } from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import { fromFileUrl } from "@std/path";
import { writeEyeFromTracking, writeProjectionTangents } from "./openVrProjectionOverlays.ts";
export type RenderCameras = {
  leftEyeViewMatrix: Float32Array;
  rightEyeViewMatrix: Float32Array;
  leftEyeProjectionMatrix: Float32Array;
  rightEyeProjectionMatrix: Float32Array;
};
const symbols = {
  pp_overlay_abi: { parameters: [], result: "u32" },
  pp_overlay_present: {
    parameters: ["pointer", "u64", "u64", "u32", "u32", "buffer", "buffer", "u32", "u32", "buffer"],
    result: "i32",
  },
} as const;
/** Synchronous FFI deliberately keeps GL and OpenVR submission on the context owner. */
export class OverlayPresenterNative {
  private readonly library: Deno.DynamicLibrary<typeof symbols>;
  private readonly views = new Float32Array(24);
  private readonly frusta = new Float32Array(8);
  private readonly stats = new Float64Array(6);
  private visible = false;
  constructor(private readonly table: Deno.PointerValue) {
    if (IVROverlay_Version !== "FnTable:IVROverlay_027") {
      throw new Error("Native presenter requires FnTable:IVROverlay_027");
    }
    const path = Deno.env.get("PETPLAY_OVERLAY_PRESENTER_LIBRARY") ??
      fromFileUrl(new URL("../resources/libpetplay_overlay_presenter.so", import.meta.url));
    this.library = Deno.dlopen(path, symbols);
    if (this.library.symbols.pp_overlay_abi() !== 27) {
      this.library.close();
      throw new Error("Native presenter ABI mismatch");
    }
  }
  present(
    handles: readonly [bigint, bigint],
    textures: { left: number; right: number },
    cameras: RenderCameras,
  ) {
    writeEyeFromTracking(cameras.leftEyeViewMatrix, this.views.subarray(0, 12));
    writeEyeFromTracking(cameras.rightEyeViewMatrix, this.views.subarray(12));
    writeProjectionTangents(cameras.leftEyeProjectionMatrix, true, this.frusta.subarray(0, 4));
    writeProjectionTangents(cameras.rightEyeProjectionMatrix, true, this.frusta.subarray(4));
    const error = this.library.symbols.pp_overlay_present(
      this.table,
      handles[0],
      handles[1],
      textures.left,
      textures.right,
      this.views,
      this.frusta,
      100,
      this.visible ? 0 : 1,
      this.stats,
    );
    if (!error) this.visible = true;
    return {
      error,
      gpuFinishMs: this.stats[0],
      waitMs: this.stats[1],
      publicationMs: this.stats[2],
      completedSetters: this.stats[3],
      waitResult: this.stats[5],
      partial: error !== 0 && this.stats[3] > 0,
    };
  }
  /** The overlays were destroyed or hidden elsewhere; show them again on the next present. */
  resetVisibility() {
    this.visible = false;
  }
  close() {
    this.library.close();
  }
}

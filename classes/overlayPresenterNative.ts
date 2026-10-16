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
  pp_overlay_present_texture: {
    parameters: ["pointer", "u64", "u32", "u32", "buffer"],
    result: "i32",
  },
  // Split phases (optional: older builds lack them and keep the blocking path).
  pp_overlay_finish: { parameters: ["buffer"], result: "i32", optional: true },
  pp_overlay_wait: {
    parameters: ["pointer", "u32"],
    result: "i32",
    nonblocking: true,
    optional: true,
  },
  pp_overlay_wait_blocking: {
    name: "pp_overlay_wait",
    parameters: ["pointer", "u32"],
    result: "i32",
    optional: true,
  },
  pp_overlay_publish: {
    parameters: ["pointer", "u64", "u64", "u32", "u32", "buffer", "buffer", "u32", "buffer"],
    result: "i32",
    optional: true,
  },
  pp_overlay_publish_texture: {
    parameters: ["pointer", "u64", "u32", "buffer"],
    result: "i32",
    optional: true,
  },
} as const;
const WAIT_TIMEOUT_MS = 100;
/**
 * GL finish and OpenVR submission stay on the context owner. The synchronous `present*` calls
 * also block that thread in `WaitFrameSync`; the `*Async` variants run only the wait on an FFI
 * worker thread, so scene messages and GC can use the wait instead of the next frame's budget.
 */
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
  /**
   * `beforePublish` runs after the frame-sync wait; returning false drops the frame instead of
   * submitting it late (the compositor reprojects the previous one).
   */
  present(
    handles: readonly [bigint, bigint],
    textures: { left: number; right: number },
    cameras: RenderCameras,
    beforePublish?: () => boolean,
  ) {
    writeEyeFromTracking(cameras.leftEyeViewMatrix, this.views.subarray(0, 12));
    writeEyeFromTracking(cameras.rightEyeViewMatrix, this.views.subarray(12));
    writeProjectionTangents(cameras.leftEyeProjectionMatrix, true, this.frusta.subarray(0, 4));
    writeProjectionTangents(cameras.rightEyeProjectionMatrix, true, this.frusta.subarray(4));
    if (beforePublish && this.canWaitAsync) {
      let error = this.finishAndWaitBlocking();
      if (!error && !beforePublish()) return { ...this.result(0, false), dropped: true };
      if (!error) error = this.publishProjection(handles, textures);
      return { ...this.result(error, error !== 0 && this.stats[3] > 0), dropped: false };
    }
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
    return { ...this.result(error, error !== 0 && this.stats[3] > 0), dropped: false };
  }
  /** One overlay's texture through the same finish, frame-sync and publish sequence. */
  presentTexture(handle: bigint, texture: number, beforePublish?: () => boolean) {
    if (beforePublish && this.canWaitAsync) {
      let error = this.finishAndWaitBlocking();
      if (!error && !beforePublish()) return { ...this.result(0, false), dropped: true };
      if (!error) {
        error = this.library.symbols.pp_overlay_publish_texture!(
          this.table,
          handle,
          texture,
          this.stats,
        );
      }
      return { ...this.result(error, false), dropped: false };
    }
    const error = this.library.symbols.pp_overlay_present_texture(
      this.table,
      handle,
      texture,
      100,
      this.stats,
    );
    return { ...this.result(error, false), dropped: false };
  }
  /** Whether the library exports the split phases the async variants need. */
  get canWaitAsync(): boolean {
    const s = this.library.symbols;
    return !!(s.pp_overlay_finish && s.pp_overlay_wait && s.pp_overlay_wait_blocking &&
      s.pp_overlay_publish && s.pp_overlay_publish_texture);
  }
  /** `present` with the frame-sync wait off the context thread. */
  async presentAsync(
    handles: readonly [bigint, bigint],
    textures: { left: number; right: number },
    cameras: RenderCameras,
  ) {
    writeEyeFromTracking(cameras.leftEyeViewMatrix, this.views.subarray(0, 12));
    writeEyeFromTracking(cameras.rightEyeViewMatrix, this.views.subarray(12));
    writeProjectionTangents(cameras.leftEyeProjectionMatrix, true, this.frusta.subarray(0, 4));
    writeProjectionTangents(cameras.rightEyeProjectionMatrix, true, this.frusta.subarray(4));
    let error = await this.finishAndWait();
    if (!error) error = this.publishProjection(handles, textures);
    return this.result(error, error !== 0 && this.stats[3] > 0);
  }
  /** `presentTexture` with the frame-sync wait off the context thread. */
  async presentTextureAsync(handle: bigint, texture: number) {
    let error = await this.finishAndWait();
    if (!error) {
      error = this.library.symbols.pp_overlay_publish_texture!(
        this.table,
        handle,
        texture,
        this.stats,
      );
    }
    return this.result(error, false);
  }
  private publishProjection(
    handles: readonly [bigint, bigint],
    textures: { left: number; right: number },
  ): number {
    const error = this.library.symbols.pp_overlay_publish!(
      this.table,
      handles[0],
      handles[1],
      textures.left,
      textures.right,
      this.views,
      this.frusta,
      this.visible ? 0 : 1,
      this.stats,
    );
    if (!error) this.visible = true;
    return error;
  }
  private finishAndWaitBlocking(): number {
    const s = this.library.symbols;
    const finished = s.pp_overlay_finish!(this.stats);
    if (finished) return finished;
    const start = performance.now();
    const wait = s.pp_overlay_wait_blocking!(this.table, WAIT_TIMEOUT_MS);
    this.stats[1] = performance.now() - start;
    this.stats[5] = wait;
    if (wait) this.stats[4] = wait;
    return wait;
  }
  private async finishAndWait(): Promise<number> {
    const s = this.library.symbols;
    const finished = s.pp_overlay_finish!(this.stats);
    if (finished) return finished;
    const start = performance.now();
    const wait = await s.pp_overlay_wait!(this.table, WAIT_TIMEOUT_MS);
    this.stats[1] = performance.now() - start;
    this.stats[5] = wait;
    if (wait) this.stats[4] = wait;
    return wait;
  }
  private result(error: number, partial: boolean) {
    return {
      error,
      gpuFinishMs: this.stats[0],
      waitMs: this.stats[1],
      publicationMs: this.stats[2],
      completedSetters: this.stats[3],
      waitResult: this.stats[5],
      partial,
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

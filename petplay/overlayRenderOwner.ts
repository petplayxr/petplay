/** Experimental projection renderer: own process, tracking, GL resources, and render cadence. */
import { actorState, PostMan } from "../submodules/stageforge/mod.ts";
import * as OpenVR from "../submodules/OpenVR_TS_Bindings_Deno/openvr_bindings.ts";
import * as THREE from "three";
import { OpenVrRuntime } from "../classes/openVrRuntime.ts";
import { OpenVrOverlayFramePacer } from "../classes/openVrOverlayFramePacing.ts";
import { OpenVrControllerTipPoseResolver } from "../classes/openVrControllerTipPose.ts";
import { OpenVrProjectionOverlays } from "../classes/openVrProjectionOverlays.ts";
import { OpenVrOverlayTexture } from "../classes/openVrOverlayTexture.ts";
import { OverlayPresenterNative, type RenderCameras } from "../classes/overlayPresenterNative.ts";
import { trackingMatrix34, writeStereoRenderViews } from "../classes/overlayRenderCamera.ts";
import {
  type RenderAnchors,
  resolveRenderAnchors,
  setRenderHandAnchors,
} from "../classes/overlayRenderTracking.ts";
import { WebXROverlayRaylib } from "../classes/webxrOverlayRaylib.ts";
import type { WebXRRaythreeRenderPayload } from "../classes/webxrRaythreeScene.ts";
import {
  OverlaySceneWireDecoder,
  OVERLAY_SCENE_WIRE_FORMAT,
  type OverlayScenePacket,
} from "../classes/overlaySceneWire.ts";
import { wait } from "../classes/utils.ts";
import { setCurrentThreadNice } from "../classes/linuxScheduling.ts";
import { OverlayWristMotionProbe } from "../classes/overlayWristMotionProbe.ts";
import { motionProbeFrame, OverlayMotionProbe } from "../classes/overlayMotionProbe.ts";
import { OverlaySceneInbox } from "../classes/overlaySceneDelivery.ts";

/**
 * `projection`: per-eye projection overlays, reprojected by SteamVR, but SteamVR draws them
 * behind every quad overlay (PetPlay's display screens included).
 * `panorama`: both eyes side by side on one HMD-attached stereo-panorama overlay, as the
 * in-worker renderer did: sorts with other overlays normally, no reprojection.
 */
export type PresentMode = "projection" | "panorama";
type PanoramaPacing = "vsync" | "frame-sync" | "presenter";
type Start = {
  webxrTarget?: string;
  overlayKey?: string;
  overlayName?: string;
  eyeSize?: number;
  presentMode?: PresentMode;
  overlayWidthInMeters?: number;
  overlayDistance?: number;
};
const state = actorState({
  name: "overlay_renderer",
  running: false,
  stopRequested: false,
  webxrTarget: null as string | null,
  error: null as string | null,
  sceneVersion: 0,
  renderFrameId: 0,
  publishedFrames: 0,
  waitTimeouts: 0,
  trackingInvalid: 0,
  resolvedAnchors: 0,
  receivedScenes: 0,
  lastDecodeMs: 0,
  lastPacketBytes: 0,
  lastSceneIntervalMs: 0,
  freezeScene: false,
  freezeRendering: false,
  /**
   * Run the compositor frame-sync wait on an FFI worker thread instead of blocking the render
   * thread in it. Scene messages that arrive during the wait are then handled during it, not
   * between the next pose sample and its deadline.
   */
  asyncFrameWait: false,
  /**
   * Projection only. `frame-sync`: sample and render right after the previous publication, so
   * the frame is shown one display frame after the vsync its poses are predicted for, and any
   * message work queued during the blocking publication delays the next pose sample. `vsync`:
   * sample at the vsync, as panorama does, publish at that frame's sync, and leave the idle time
   * after publication for scene messages.
   */
  projectionPacing: "frame-sync" as "frame-sync" | "vsync",
  /**
   * Hold incoming scene packets undecoded and decode the newest at a fixed point in the frame,
   * right after drawing, instead of whenever the message arrives. The receipt is sent on decode,
   * so the producer still sends about one packet per rendered frame.
   */
  deferDecode: false,
  /**
   * Presenter paths: after the frame-sync wait, drop a frame that would reach the display a
   * vsync later than its poses were predicted for, instead of submitting it late. The compositor
   * reprojects the previous frame; the next frame samples fresh poses.
   */
  dropLateFrames: false,
  /** Render thread niceness, read back after setting (null until set). */
  renderThreadNice: null as { tid: number; nice: number; error?: string } | null,
  droppedLateFrames: 0,
  // Preserve the established raster/publication calibration while asymmetric frusta are audited.
  // This chooses optical parameters only; render eye views remain independent of IR-time poses.
  projectionMode: "scene-compatible" as "headset" | "scene-compatible",
  presentMode: "projection" as PresentMode,
  /**
   * Panorama only: whole display frames to predict the head pose beyond the next vsync. The
   * panorama is head-locked and never reprojected, so any gap between the predicted and the
   * displayed pose shows up as the world swimming with the head.
   */
  panoramaExtraPredictionFrames: 0,
  /**
   * Panorama only. `vsync`: start each frame at the vsync, as the in-worker renderer did, so every
   * frame reaches the compositor at the same point. `frame-sync`: start at `WaitFrameSync`, which
   * returns anywhere from 1 to 10 ms after the vsync. `presenter`: exactly the projection path's
   * loop (fast pacer, render, native GPU finish + `WaitFrameSync` + publish), so the two modes
   * differ only in the combine pass and the overlay type.
   */
  panoramaPacing: "vsync" as PanoramaPacing,
  /**
   * Vsync-paced panorama: hold each present until this many ms after the frame's vsync. The
   * compositor latches overlays 4-7 ms after a vsync, and a render finishing around 5 ms
   * straddles that, so frames alternate between two display frames. Presenting past the latch
   * puts every frame on the same one, as the in-worker renderer did by running the sim first.
   */
  panoramaPresentMinMs: 0,
  /** Diagnostic only: match projection's alternating submitted source images. */
  panoramaTextureRotation: false,
  lastRenderImages: null as { left: number; right: number; output: number } | null,
  lastPresent: null as unknown,
  motionProbe: false,
  wristMotionProbe: false,
  /** Anchored items per tracking space in the last rendered scene. */
  anchorSpaces: {} as Record<string, number>,
  /** `GetEyeToHeadTransform` per eye (column-major), as the render eye views use it. */
  eyeToHead: null as { left: number[]; right: number[] } | null,
  lastRenderTracking: null as { head: number[]; predictedSecondsToPhotons: number } | null,
  transport: "OpenGL baseline (compositor image reuse is not resolved)",
});
let latest: WebXRRaythreeRenderPayload | null = null;
/** Panorama frames: [ms after vsync at frame sync, ms after vsync at present, vsyncs between them, predicted ms]. */
const panoramaPhase: [number, number, number, number][] = [];
let loop: Promise<void> | null = null;
let registered = false;
let receivedStream: string | null = null;
let receivedSequence = 0;
let receivedAt = 0;
let inbox = new OverlaySceneInbox();
let wireDecoder = new OverlaySceneWireDecoder();
let motionProbe: OverlayMotionProbe | null = null;
let wristProbe: OverlayWristMotionProbe | null = null;
let workProbe = false;
const workRows: Record<string, unknown>[] = [];
/**
 * Frame timeline probe: `[ms, kind, ...fields]` rows for loop phases and message handling, so a
 * missed compositor frame can be attributed to render, GPU/compositor wait, decode or GC. Heap
 * readings bracket each phase; a drop between two readings means a GC ran in between.
 */
let timeline: unknown[][] | null = null;
const TIMELINE_LIMIT = 60000;
function mark(kind: string, ...fields: unknown[]) {
  if (timeline && timeline.length < TIMELINE_LIMIT) {
    timeline.push([performance.now(), kind, Deno.memoryUsage().heapUsed, ...fields]);
  }
}
/** Render thread's cumulative [on-CPU ns, runqueue-wait ns, timeslices] from schedstat. */
function schedstat(): number[] {
  return Deno.readTextFileSync("/proc/thread-self/schedstat").trim().split(" ").map(Number);
}
// Open only for the native-controller diagnostic; shared with Vulkan capture's
// CLOCK_MONOTONIC domain. Ordinary rendering keeps no extra FFI clock calls.
function createProbeClock() {
  const library = Deno.dlopen(
    "libc.so.6",
    {
      clock_gettime: { parameters: ["i32", "buffer"], result: "i32" },
    } as const,
  );
  const time = new BigInt64Array(2);
  return {
    close: () => library.close(),
    now: () => {
      if (library.symbols.clock_gettime(1, time)) throw new Error("Probe CLOCK_MONOTONIC failed");
      return Number(time[0]) + Number(time[1]) / 1e9;
    },
  };
}
let probeClock: ReturnType<typeof createProbeClock> | null = null;
let probeStartMs = 0;
let probeDurationMs = 0;
let probeHead: THREE.Matrix4 | null = null;
let probeGeneration = 0;
// Bounded, diagnostic-only CPU publication log. It does not measure compositor consumption.
const probeRows: Record<string, unknown>[] = [];
const runtime = new OpenVrRuntime("PetPlay independent renderer");
function health() {
  return { ...state, pid: Deno.pid, latestSceneFrame: latest?.frame.frameCount ?? null };
}
new PostMan(
  state,
  {
    __INIT__: () => {},
    __HEALTH__: () => health(),
    STARTOVERLAYRENDERER: (options: Start) => {
      if (loop) throw new Error("Renderer already started; stop it before reconfiguration");
      state.webxrTarget = options.webxrTarget ?? null;
      state.presentMode = options.presentMode ?? "projection";
      state.stopRequested = false;
      state.error = null;
      latest = null;
      inbox = new OverlaySceneInbox();
      wireDecoder = new OverlaySceneWireDecoder();
      pendingPacket = null;
      receivedStream = null;
      receivedSequence = 0;
      loop = run(options).catch((error) => {
        state.error = String(error);
        console.error("[overlay_renderer]", error);
        if (state.webxrTarget) {
          PostMan.PostMessage({
            target: state.webxrTarget,
            type: "OVERLAYRENDERSTATUS",
            payload: { actorId: state.id, status: health() },
          });
        }
      })
        .finally(() => {
          loop = null;
          state.running = false;
        });
      return health();
    },
    WEBXRVIEWFRAME: receiveScene,
    WEBXRVIEWFRAMEPACKET: (packet: OverlayScenePacket) => {
      if (state.freezeScene) return;
      if (state.deferDecode) {
        // Credit capacity is one, so a second packet before the drain is unexpected; keep
        // both ordered rather than drop the older one's dependencies.
        if (pendingPacket) decodePacket(pendingPacket);
        pendingPacket = packet;
        mark("stash", packet.data.length);
        return;
      }
      decodePacket(packet);
    },
    SETPRESENTMODE: (mode: PresentMode) => {
      if (mode !== "projection" && mode !== "panorama") {
        throw new Error(`Unknown present mode ${mode}`);
      }
      state.presentMode = mode;
      return health();
    },
    GETPANORAMAPHASE: () => panoramaPhase.slice(),
    /** `durationMs`, or `{ durationMs, intervalUs }` for finer sampling than 1 ms. */
    PROFILECPU: async (request: number | { durationMs: number; intervalUs?: number }) => {
      const { captureCpuProfile } = await import("../classes/cpuProfile.ts");
      return typeof request === "number"
        ? await captureCpuProfile(request)
        : await captureCpuProfile(request.durationMs, request.intervalUs);
    },
    SETRENDERWORKPROBE: (enabled: boolean) => {
      workProbe = enabled;
      workRows.length = 0;
      return { enabled };
    },
    GETRENDERWORKPROBE: () => ({enabled: workProbe, rows: workRows.slice()}),
    SETFRAMETIMELINE: (enabled: boolean) => {
      timeline = enabled ? [] : null;
      return { enabled };
    },
    /** Returns and clears collected rows; collection continues while enabled. */
    TAKEFRAMETIMELINE: () => {
      mark("take");
      const rows = timeline ?? [];
      if (timeline) timeline = [];
      return rows;
    },
    SETWRISTMOTIONPROBE: (enabled: boolean) => {
      if (motionProbe) throw new Error("Disable isolated motion probe first");
      wristProbe = enabled ? new OverlayWristMotionProbe() : null;
      state.wristMotionProbe = enabled;
      if (enabled) inbox.invalidateAdoptedAssets();
      probeClock?.close();
      probeClock = enabled ? createProbeClock() : null;
      return { enabled, scope: "Full scene with wrist marker and render-generation tag" };
    },
    GETWRISTMOTIONPROBE: () => ({ enabled: !!wristProbe, rows: wristProbe?.rows.slice() ?? [] }),
    SETMOTIONPROBE: (
      options: { enabled: boolean; durationMs?: number; nativeController?: boolean },
    ) => {
      if (options.enabled && wristProbe) throw new Error("Disable full-scene wrist probe first");
      probeClock?.close();
      probeClock = options.enabled && options.nativeController ? createProbeClock() : null;
      if (options.enabled) {
        const duration = options.durationMs ?? 30000;
        if (!Number.isFinite(duration) || duration < 100 || duration > 60000) {
          throw new Error("Probe duration must be 100..60000 ms");
        }
        // Use established optics if available; no IR-time camera or hand pose is used.
        motionProbe = new OverlayMotionProbe(
          latest?.frame ?? motionProbeFrame(256),
          options.nativeController ?? false,
        );
        probeStartMs = performance.now();
        probeDurationMs = duration;
        probeHead = null;
        probeGeneration = 0;
        probeRows.length = 0;
      } else motionProbe = null;
      state.motionProbe = !!motionProbe;
      return health();
    },
    GETMOTIONPROBE: () => ({
      scope: "CPU render/publication only; compositor capture required to measure delivery",
      active: state.motionProbe,
      rows: probeRows.slice(),
    }),
    SETRENDERERDEBUG: (value: {
      panoramaExtraPredictionFrames?: number;
      panoramaPacing?: PanoramaPacing;
      panoramaPresentMinMs?: number;
      panoramaTextureRotation?: boolean;
      freezeScene?: boolean;
      freezeRendering?: boolean;
      asyncFrameWait?: boolean;
      deferDecode?: boolean;
      dropLateFrames?: boolean;
      renderThreadNice?: number;
      projectionPacing?: "frame-sync" | "vsync";
      projectionMode?: "headset" | "scene-compatible";
    }) => {
      state.panoramaExtraPredictionFrames = value.panoramaExtraPredictionFrames ??
        state.panoramaExtraPredictionFrames;
      state.panoramaPresentMinMs = value.panoramaPresentMinMs ?? state.panoramaPresentMinMs;
      state.panoramaTextureRotation = value.panoramaTextureRotation ??
        state.panoramaTextureRotation;
      if (value.panoramaPacing != null) {
        if (!["vsync", "frame-sync", "presenter"].includes(value.panoramaPacing)) {
          throw new Error("Unknown panorama pacing");
        }
        state.panoramaPacing = value.panoramaPacing;
      }
      const wasFrozen = state.freezeScene;
      state.freezeScene = value.freezeScene ?? state.freezeScene;
      state.freezeRendering = value.freezeRendering ?? state.freezeRendering;
      state.asyncFrameWait = value.asyncFrameWait ?? state.asyncFrameWait;
      state.deferDecode = value.deferDecode ?? state.deferDecode;
      state.dropLateFrames = value.dropLateFrames ?? state.dropLateFrames;
      // Handlers run on the render loop's own thread, so this targets the render thread.
      if (value.renderThreadNice != null) {
        state.renderThreadNice = setCurrentThreadNice(value.renderThreadNice);
      }
      if (!state.deferDecode) drainPendingPacket();
      if (value.projectionPacing != null) {
        if (!["frame-sync", "vsync"].includes(value.projectionPacing)) {
          throw new Error(`Unknown projection pacing ${value.projectionPacing}`);
        }
        state.projectionPacing = value.projectionPacing;
      }
      if (value.projectionMode != null) {
        if (value.projectionMode !== "headset" && value.projectionMode !== "scene-compatible") {
          throw new Error("Unknown projection comparison mode");
        }
        state.projectionMode = value.projectionMode;
      }
      // Re-prime the complete asset baseline after rejecting frozen deliveries.
      if (wasFrozen && !state.freezeScene && registered) register();
      return health();
    },
    STOPOVERLAYRENDERER: async () => {
      state.stopRequested = true;
      await loop;
      return health();
    },
    __SHUTDOWN__: async () => {
      state.stopRequested = true;
      await loop;
    },
  } as const,
);
let pendingPacket: OverlayScenePacket | null = null;
function decodePacket(packet: OverlayScenePacket) {
  mark("decode0", packet.data.length);
  const start = performance.now();
  const decoded = wireDecoder.decode(packet);
  state.lastDecodeMs = performance.now() - start;
  mark("decode1", decoded.stale);
  state.lastPacketBytes = packet.data.length;
  if (decoded.stale) acknowledge(decoded);
  else receiveScene(decoded.payload);
}
function drainPendingPacket() {
  const packet = pendingPacket;
  pendingPacket = null;
  if (packet) decodePacket(packet);
}
function receiveScene(payload: WebXRRaythreeRenderPayload) {
  // Hold credit while frozen; a new registration supplies a full baseline on resume.
  if (state.freezeScene) return;
  if (
    payload.delivery?.stream === receivedStream && payload.delivery.sequence <= receivedSequence
  ) {
    // A newer scene already arrived and carried these assets too. Still return the credit:
    // the sender holds it until this receipt, and both credits lost stalls every scene.
    acknowledge(payload);
    return;
  }
  // Persist dependencies before returning credit: a newer snapshot may replace this one
  // before drawing, including the scene that first introduced an asset.
  mark("inbox0");
  inbox.receive(payload);
  mark("inbox1");
  latest = payload;
  receivedStream = payload.delivery?.stream ?? null;
  receivedSequence = payload.delivery?.sequence ?? 0;
  state.sceneVersion = payload.frame.frameCount;
  const now = performance.now();
  state.lastSceneIntervalMs = receivedAt ? now - receivedAt : 0;
  receivedAt = now;
  state.receivedScenes++;
  acknowledge(payload);
}
function register() {
  if (!state.webxrTarget) return;
  PostMan.PostMessage({
    target: state.webxrTarget,
    type: "REGISTERWEBXRVIEW",
    payload: {
      actorId: state.id,
      label: "projection-renderer",
      wireFormat: OVERLAY_SCENE_WIRE_FORMAT,
      // Eye views and anchored items come from this renderer's own tracking.
      ownsTracking: true,
    },
  });
  registered = true;
}
function acknowledge(payload: Pick<WebXRRaythreeRenderPayload, "delivery">) {
  PostMan.PostMessage({
    target: state.webxrTarget!,
    type: "WEBXRVIEWFRAMEACK",
    payload: { actorId: state.id, delivery: payload.delivery },
  });
}
function projection(system: OpenVR.IVRSystem, eye: OpenVR.Eye) {
  const rows = system.GetProjectionMatrix(eye, .05, 100).m;
  const data = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) data[c * 4 + r] = rows[r][c];
  return data;
}
async function run(options: Start) {
  let renderer: WebXROverlayRaylib | null = null;
  let overlays: OpenVrProjectionOverlays | null = null;
  let presenter: OverlayPresenterNative | null = null;
  let panorama: OpenVrOverlayTexture | null = null;
  try {
    const pointers = runtime.initialize({
      system: "required",
      overlay: "required",
      renderModels: "required",
    });
    const system = new OpenVR.IVRSystem(pointers.system!);
    const fastPacer = new OpenVrOverlayFramePacer(
      system,
      null,
      false,
      "fast",
      "independent-renderer",
    );
    const vsyncPacer = new OpenVrOverlayFramePacer(
      system,
      null,
      false,
      "vsync",
      "independent-panorama",
    );
    const tip = new OpenVrControllerTipPoseResolver(pointers.system!, pointers.renderModels!);
    // Load the native helper before allocating graphics resources, so missing builds fail cleanly.
    presenter = new OverlayPresenterNative(pointers.overlay!);
    renderer = new WebXROverlayRaylib(options.eyeSize);
    renderer.initialize(options.overlayName ?? "PetPlay independent renderer");
    const overlayKey = options.overlayKey ?? `petplay.independent.${Deno.pid}`;
    const overlayName = options.overlayName ?? "PetPlay independent renderer";
    const overlayInterface = new OpenVR.IVROverlay(pointers.overlay!);
    overlays = new OpenVrProjectionOverlays(Deno.UnsafePointer.value(pointers.overlay!));
    panorama = new OpenVrOverlayTexture(Deno.UnsafePointer.value(pointers.overlay!));
    let panoramaReady = false;
    let activeMode: PresentMode | null = null;
    const leftEye = trackingMatrix34(system.GetEyeToHeadTransform(OpenVR.Eye.Eye_Left).m);
    const rightEye = trackingMatrix34(system.GetEyeToHeadTransform(OpenVR.Eye.Eye_Right).m);
    state.eyeToHead = { left: leftEye.toArray(), right: rightEye.toArray() };
    const headsetProjections = {
      leftEyeProjectionMatrix: projection(system, OpenVR.Eye.Eye_Left),
      rightEyeProjectionMatrix: projection(system, OpenVR.Eye.Eye_Right),
    };
    const cameras: RenderCameras = {
      leftEyeViewMatrix: new Float32Array(16),
      rightEyeViewMatrix: new Float32Array(16),
      leftEyeProjectionMatrix: new Float32Array(16),
      rightEyeProjectionMatrix: new Float32Array(16),
    };
    const lookRotation = new Float32Array(16);
    const lookRotationMatrix = new THREE.Matrix4();
    const zFlip = new THREE.Matrix4().makeScale(1, 1, -1);
    let shownLeft = 0;
    let shownPanorama = 0;
    let registeredAt = performance.now();
    let activeEpoch: string | null = null;
    let activeProbe: OverlayMotionProbe | null = null;
    let activeWristProbe: OverlayWristMotionProbe | null = null;
    let lastReportAt = 0;
    state.running = true;
    register();
    while (!state.stopRequested) {
      if (runtime.pollRuntimeEvents().exiting) {
        state.error = "SteamVR requested renderer shutdown";
        break;
      }
      // Re-register while empty; a scene-worker reload can replace the registry.
      if (!state.freezeScene && performance.now() - Math.max(registeredAt, receivedAt) > 5000) {
        register();
        registeredAt = performance.now();
      }
      if (motionProbe && performance.now() - probeStartMs > probeDurationMs) {
        motionProbe = null;
        state.motionProbe = false;
      }
      const probe = motionProbe;
      const wrist = wristProbe;
      if (wrist !== activeWristProbe) {
        inbox.invalidateAdoptedAssets();
        activeWristProbe = wrist;
      }
      if (probe !== activeProbe) {
        renderer.resetSceneAssets();
        inbox.invalidateAdoptedAssets();
        activeEpoch = null;
        activeProbe = probe;
      }
      // Deferred packets normally drain after drawing; drain here only until a first scene.
      if (!inbox.current()) drainPendingPacket();
      const scene = inbox.current();
      const payload = probe?.payload ?? scene?.payload;
      if (!payload || state.freezeRendering) {
        await wait(10);
        continue;
      }
      if (payload.delivery && activeEpoch !== payload.delivery.epoch) {
        renderer.resetSceneAssets();
        activeEpoch = payload.delivery.epoch;
      }
      if (activeMode !== state.presentMode) {
        if (state.presentMode === "panorama") {
          overlays.cleanup();
          presenter.resetVisibility();
        } else {
          panorama.cleanup();
          panoramaReady = false;
          overlays.initialize({ key: overlayKey, name: overlayName, sortOrder: 20 });
        }
        shownLeft = 0;
        shownPanorama = 0;
        activeMode = state.presentMode;
      }
      const panoramaMode = activeMode === "panorama";
      // Vsync pacing starts each frame at the display vsync (panorama's default, projection's
      // option); otherwise projection frames start right after the native presenter's wait.
      const vsyncPaced = panoramaMode
        ? state.panoramaPacing === "vsync"
        : state.projectionPacing === "vsync";
      const pacer = vsyncPaced ? vsyncPacer : fastPacer;
      pacer.extraPredictionFrames = panoramaMode ? state.panoramaExtraPredictionFrames : 0;
      mark("pace0");
      if (vsyncPaced) await pacer.paceToDisplayAndRefreshPosesYielding();
      else {
        if (panoramaMode && state.panoramaPacing === "frame-sync") {
          overlayInterface.WaitFrameSync(100);
        }
        pacer.paceToDisplayAndRefreshPoses();
      }
      const syncPhase = pacer.sampleVsyncPhase();
      mark("sample", syncPhase ? Number(syncPhase.frameIndex) : null, syncPhase?.msSinceVsync);
      const hmd = pacer.getCachedHmdEmulation();
      if (!hmd) {
        state.trackingInvalid++;
        await wait(10);
        continue;
      }
      const sampleMs = performance.now();
      const sampleMonotonicSeconds = probeClock?.now();
      const predictionMs = pacer.getLastPredictedSecondsToPhotons() * 1000;
      const sampledHead = new THREE.Matrix4().fromArray(hmd.matrix);
      if (probe && !probeHead) probeHead = sampledHead.clone();
      const head = probe ? probeHead! : sampledHead;
      state.lastRenderTracking = {
        head: head.toArray(),
        predictedSecondsToPhotons: pacer.getLastPredictedSecondsToPhotons(),
      };
      writeStereoRenderViews(head, leftEye, rightEye, cameras);
      // The panorama combine resamples around the head rotation the eyes were rendered from.
      lookRotation.set(lookRotationMatrix.copy(head).invert().multiply(zFlip).elements);
      // Compare only the optical frusta; eye views always come from fresh render tracking.
      const projections = state.projectionMode === "scene-compatible"
        ? payload.frame
        : headsetProjections;
      for (let i = 0; i < 16; i++) {
        cameras.leftEyeProjectionMatrix[i] = projections.leftEyeProjectionMatrix[i];
        cameras.rightEyeProjectionMatrix[i] = projections.rightEyeProjectionMatrix[i];
      }
      let probeSample = probe?.sample(
        sampleMs - probeStartMs + predictionMs,
        head,
        ++probeGeneration,
      );
      if (probe?.nativeController && probeSample) {
        const index = system.GetTrackedDeviceIndexForControllerRole(
          OpenVR.TrackedControllerRole.TrackedControllerRole_LeftHand,
        );
        const pose = pacer.getCachedTrackedDevicePose(index);
        if (!pose) throw new Error("Motion image probe requires a valid left controller");
        // Deliberately use the raw device transform: matches the native relative-quad
        // baseline without introducing render-model tip offsets or IR-time input.
        probeSample = {
          x: pose.matrix[12],
          anchors: { head: head.elements, "right-ray": pose.matrix },
        };
      }
      const anchors: RenderAnchors = probeSample?.anchors ?? { head: hmd.matrix };
      if (!probe) {
        for (
          const [hand, role] of [[
            "left",
            OpenVR.TrackedControllerRole.TrackedControllerRole_LeftHand,
          ], ["right", OpenVR.TrackedControllerRole.TrackedControllerRole_RightHand]] as const
        ) {
          const index = system.GetTrackedDeviceIndexForControllerRole(role);
          const pose = pacer.getCachedTrackedDevicePose(index);
          if (pose) {
            const resolved = tip.resolve(index, pose);
            setRenderHandAnchors(anchors, hand, resolved.matrix, payload.renderGripOffsets?.[hand]);
          }
        }
      }
      state.anchorSpaces = {};
      state.resolvedAnchors = resolveRenderAnchors(payload, anchors, state.anchorSpaces);
      if (!renderer.useEyeTargetsOtherThan([shownLeft])) {
        throw new Error("No eligible render targets");
      }
      if (
        panoramaMode && state.panoramaTextureRotation &&
        !renderer.useOutputTargetOtherThan([shownPanorama])
      ) {
        throw new Error("No eligible panorama output targets");
      }
      const wristMarker = wrist?.marker(payload, { ...cameras, ...headsetProjections });
      const restoreWristTag = wrist?.append(payload, head);
      mark("render0", scene?.assetVersion ?? null, state.receivedScenes, ...(timeline ? schedstat() : []));
      const renderStartMs = performance.now();
      const publishedBefore = state.publishedFrames;
      let renderWork: ReturnType<typeof renderer.renderRaythreeFrame>;
      try {
        renderWork = renderer.renderRaythreeFrame(payload, {
          skipCombine: !panoramaMode,
          cameras,
          lookRotation,
        });
      } finally {
        restoreWristTag?.();
      }
      const renderEndMs = performance.now();
      // A frame predicted for the vsync after its sample that would only be submitted after the
      // following one shows stale poses; dropping it lets the compositor reproject instead.
      const onTime = state.dropLateFrames
        ? () => {
          const now = pacer.sampleVsyncPhase();
          return !syncPhase || !now || now.frameIndex - syncPhase.frameIndex < 2n;
        }
        : undefined;
      mark(
        "render1",
        renderWork!.textBatchRebuilds,
        renderWork!.textGeometryBuilds,
        renderWork!.batchGeometries,
        renderWork!.batchMaterials,
        renderWork!.textVerticesUploaded,
        ...(timeline ? schedstat() : []),
      );
      if (!probe && scene) inbox.markAdopted(scene);
      // After markAdopted: the drained scene's assets stay pending for the next frame.
      drainPendingPacket();
      state.renderFrameId++;
      const renderedEyes = renderer.getEyeTextureHandles();
      state.lastRenderImages = renderedEyes
        ? { ...renderedEyes, output: renderer.getTextureHandle() }
        : null;
      if (panoramaMode) {
        const texture = renderer.getTextureHandle();
        if (!panoramaReady) {
          panorama.initialize(texture, {
            key: `${overlayKey}.panorama`,
            name: `${overlayName} (panorama)`,
            widthInMeters: options.overlayWidthInMeters,
            distance: options.overlayDistance,
            mode: "stereo-panorama",
            sortOrder: 20,
            attachToHmd: true,
            flipVertical: false,
          });
          panoramaReady = true;
        }
        panorama.setTextureHandle(texture);
        const presenterPaced = state.panoramaPacing === "presenter";
        let published = true;
        if (vsyncPaced && syncPhase) {
          for (;;) {
            const now = pacer.sampleVsyncPhase();
            if (!now || now.frameIndex !== syncPhase.frameIndex) break;
            const remainingMs = state.panoramaPresentMinMs - now.msSinceVsync;
            if (remainingMs <= 0) break;
            await wait(remainingMs > 1.5 ? remainingMs - 1 : 0);
          }
        }
        if (presenterPaced) {
          const result = state.asyncFrameWait && presenter.canWaitAsync
            ? await presenter.presentTextureAsync(panorama.getHandle(), texture)
            : presenter.presentTexture(panorama.getHandle(), texture, onTime);
          state.lastPresent = { mode: "panorama-presenter", ...result };
          if ("dropped" in result && result.dropped) {
            state.droppedLateFrames++;
            published = false;
          } else if (result.waitResult === OpenVR.OverlayError.VROverlayError_TimedOut) {
            state.waitTimeouts++;
            published = false;
          } else if (result.error) {
            throw new Error(`Panorama publication failed: ${JSON.stringify(result)}`);
          }
        } else if (!panorama.present()) throw new Error("Panorama texture rejected");
        else state.lastPresent = { mode: "panorama", texture };
        const presentPhase = pacer.sampleVsyncPhase();
        const presented = presenterPaced
          ? state.lastPresent as { gpuFinishMs?: number; waitMs?: number; publicationMs?: number }
          : {};
        mark(
          published ? "present" : "drop",
          presentPhase ? Number(presentPhase.frameIndex) : null,
          presentPhase?.msSinceVsync,
          presented.gpuFinishMs,
          presented.waitMs,
          presented.publicationMs,
          published ? 0 : -1,
        );
        if (published && syncPhase && presentPhase) {
          panoramaPhase.push([
            syncPhase.msSinceVsync,
            presentPhase.msSinceVsync,
            Number(presentPhase.frameIndex - syncPhase.frameIndex),
            pacer.getLastPredictedSecondsToPhotons() * 1000,
          ]);
          if (panoramaPhase.length > 600) panoramaPhase.shift();
        }
        if (published) {
          shownPanorama = texture;
          state.publishedFrames++;
        }
      } else {
        const textures = renderer.getEyeTextureHandles();
        if (!textures) throw new Error("Missing eye targets");
        const result = state.asyncFrameWait && presenter.canWaitAsync
          ? await presenter.presentAsync(overlays.getHandles(), textures, cameras)
          : presenter.present(overlays.getHandles(), textures, cameras, onTime);
        state.lastPresent = result;
        const dropped = "dropped" in result && result.dropped;
        if (dropped) state.droppedLateFrames++;
        const phase = timeline ? pacer.sampleVsyncPhase() : null;
        mark(
          dropped ? "drop" : "present",
          phase ? Number(phase.frameIndex) : null,
          phase?.msSinceVsync,
          result.gpuFinishMs,
          result.waitMs,
          result.publicationMs,
          result.waitResult,
        );
        if (dropped) { /* the compositor keeps reprojecting the previous frame */ }
        else if (result.waitResult === OpenVR.OverlayError.VROverlayError_TimedOut) {
          state.waitTimeouts++;
        } else if (result.error) {
          throw new Error(`Projection publication failed: ${JSON.stringify(result)}`);
        } else {
          shownLeft = textures.left;
          state.publishedFrames++;
        }
      }
      if (workProbe && workRows.length < 2000) workRows.push({
        sceneVersion: state.sceneVersion, freezeScene: state.freezeScene,
        sampleMs, publicationEndMs: performance.now(), renderStartMs, renderEndMs,
        decodeMs: state.lastDecodeMs, packetBase64Bytes: state.lastPacketBytes, receivedScenes: state.receivedScenes,
        ...renderWork!,
      });
      if (wrist && wrist.rows.length < 10000) {
        const phase = pacer.sampleVsyncPhase();
        wrist.rows.push({
          generation: wrist.generation,
          sampleMonotonicSeconds,
          publicationMonotonicSeconds: probeClock?.now(),
          predictionMs,
          marker: wristMarker,
          head: head.toArray(),
          leftProjection: Array.from(headsetProjections.leftEyeProjectionMatrix),
          sourceLeftProjection: Array.from(cameras.leftEyeProjectionMatrix),
          sampleVsync: syncPhase ? String(syncPhase.frameIndex) : null,
          samplePhaseMs: syncPhase?.msSinceVsync,
          publicationVsync: phase ? String(phase.frameIndex) : null,
          publicationPhaseMs: phase?.msSinceVsync,
          renderStartMs,
          renderEndMs,
          published: state.publishedFrames > publishedBefore,
          textures: state.lastRenderImages,
        });
      }
      if (probe && probeRows.length < 10000) {
        const endPhase = pacer.sampleVsyncPhase();
        probeRows.push({
          generation: probeGeneration,
          hmdActivity: system.GetTrackedDeviceActivityLevel(OpenVR.k_unTrackedDeviceIndex_Hmd),
          sampleVsync: syncPhase ? String(syncPhase.frameIndex) : null,
          samplePhaseMs: syncPhase?.msSinceVsync,
          publicationVsync: endPhase ? String(endPhase.frameIndex) : null,
          publicationPhaseMs: endPhase?.msSinceVsync,
          mode: activeMode,
          pacing: panoramaMode ? state.panoramaPacing : "presenter",
          sampleMs,
          sampleMonotonicSeconds,
          publicationMonotonicSeconds: probeClock?.now(),
          elapsedMs: sampleMs - probeStartMs,
          predictionMs,
          targetMs: sampleMs - probeStartMs + predictionMs,
          x: probeSample!.x,
          renderStartMs,
          renderEndMs,
          publicationEndMs: performance.now(),
          published: state.publishedFrames > publishedBefore,
          textures: state.lastRenderImages,
          present: state.lastPresent,
        });
      }
      if (state.webxrTarget && performance.now() - lastReportAt > 500) {
        mark("status");
        PostMan.PostMessage({
          target: state.webxrTarget!,
          type: "OVERLAYRENDERSTATUS",
          payload: { actorId: state.id, status: health() },
        });
        lastReportAt = performance.now();
      }
      mark("yield", ...(timeline ? schedstat() : []));
      await wait(0);
      mark("resume", ...(timeline ? schedstat() : []));
    }
  } finally {
    if (registered && state.webxrTarget) {
      PostMan.PostMessage({
        target: state.webxrTarget,
        type: "UNREGISTERWEBXRVIEW",
        payload: { actorId: state.id },
      });
    }
    registered = false;
    motionProbe = null;
    wristProbe = null;
    state.wristMotionProbe = false;
    probeClock?.close();
    probeClock = null;
    state.motionProbe = false;
    latest = null;
    overlays?.cleanup();
    panorama?.cleanup();
    presenter?.close();
    renderer?.cleanup();
    // This child owns all native dependants; avoid the known Linux library-teardown race.
    runtime.deferReleaseToProcessExit();
  }
}

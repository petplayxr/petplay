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
  decodeOverlayScene,
  OVERLAY_SCENE_WIRE_FORMAT,
  type OverlayScenePacket,
} from "../classes/overlaySceneWire.ts";
import { wait } from "../classes/utils.ts";
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
  webxrTarget: string;
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
  lastSceneIntervalMs: 0,
  freezeScene: false,
  freezeRendering: false,
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
  lastPresent: null as unknown,
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
      state.webxrTarget = options.webxrTarget;
      state.presentMode = options.presentMode ?? "projection";
      state.stopRequested = false;
      state.error = null;
      latest = null;
      inbox = new OverlaySceneInbox();
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
      const start = performance.now();
      const payload = decodeOverlayScene(packet);
      state.lastDecodeMs = performance.now() - start;
      receiveScene(payload);
    },
    SETPRESENTMODE: (mode: PresentMode) => {
      if (mode !== "projection" && mode !== "panorama") {
        throw new Error(`Unknown present mode ${mode}`);
      }
      state.presentMode = mode;
      return health();
    },
    GETPANORAMAPHASE: () => panoramaPhase.slice(),
    SETRENDERERDEBUG: (value: {
      panoramaExtraPredictionFrames?: number;
      panoramaPacing?: PanoramaPacing;
      panoramaPresentMinMs?: number;
      freezeScene?: boolean;
      freezeRendering?: boolean;
      projectionMode?: "headset" | "scene-compatible";
    }) => {
      state.panoramaExtraPredictionFrames = value.panoramaExtraPredictionFrames ??
        state.panoramaExtraPredictionFrames;
      state.panoramaPresentMinMs = value.panoramaPresentMinMs ?? state.panoramaPresentMinMs;
      if (value.panoramaPacing != null) {
        if (!["vsync", "frame-sync", "presenter"].includes(value.panoramaPacing)) {
          throw new Error("Unknown panorama pacing");
        }
        state.panoramaPacing = value.panoramaPacing;
      }
      const wasFrozen = state.freezeScene;
      state.freezeScene = value.freezeScene ?? state.freezeScene;
      state.freezeRendering = value.freezeRendering ?? state.freezeRendering;
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
  inbox.receive(payload);
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
    },
  });
  registered = true;
}
function acknowledge(payload: WebXRRaythreeRenderPayload) {
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
    let registeredAt = performance.now();
    let activeEpoch: string | null = null;
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
      const scene = inbox.current();
      const payload = scene?.payload;
      if (!scene || !payload || state.freezeRendering) {
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
        activeMode = state.presentMode;
      }
      const panoramaMode = activeMode === "panorama";
      // The panorama is head-locked, so it paces on the compositor's frame start like the old
      // in-worker renderer; projection presents wait inside the native presenter instead.
      const vsyncPaced = panoramaMode && state.panoramaPacing === "vsync";
      const pacer = vsyncPaced ? vsyncPacer : fastPacer;
      pacer.extraPredictionFrames = panoramaMode ? state.panoramaExtraPredictionFrames : 0;
      if (vsyncPaced) await pacer.paceToDisplayAndRefreshPosesYielding();
      else {
        if (panoramaMode && state.panoramaPacing === "frame-sync") {
          overlayInterface.WaitFrameSync(100);
        }
        pacer.paceToDisplayAndRefreshPoses();
      }
      const syncPhase = panoramaMode ? pacer.sampleVsyncPhase() : null;
      const hmd = pacer.getCachedHmdEmulation();
      if (!hmd) {
        state.trackingInvalid++;
        await wait(10);
        continue;
      }
      const head = new THREE.Matrix4().fromArray(hmd.matrix);
      state.lastRenderTracking = {
        head: Array.from(hmd.matrix),
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
      const anchors: RenderAnchors = { head: hmd.matrix };
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
      state.resolvedAnchors = resolveRenderAnchors(payload, anchors);
      if (!renderer.useEyeTargetsOtherThan([shownLeft])) {
        throw new Error("No eligible render targets");
      }
      renderer.renderRaythreeFrame(payload, {
        skipCombine: !panoramaMode,
        cameras,
        lookRotation,
      });
      inbox.markAdopted(scene);
      state.renderFrameId++;
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
          const result = presenter.presentTexture(panorama.getHandle(), texture);
          state.lastPresent = { mode: "panorama-presenter", ...result };
          if (result.waitResult === OpenVR.OverlayError.VROverlayError_TimedOut) {
            state.waitTimeouts++;
          } else if (result.error) {
            throw new Error(`Panorama publication failed: ${JSON.stringify(result)}`);
          }
        } else if (!panorama.present()) throw new Error("Panorama texture rejected");
        else state.lastPresent = { mode: "panorama", texture };
        const presentPhase = pacer.sampleVsyncPhase();
        if (syncPhase && presentPhase) {
          panoramaPhase.push([
            syncPhase.msSinceVsync,
            presentPhase.msSinceVsync,
            Number(presentPhase.frameIndex - syncPhase.frameIndex),
            pacer.getLastPredictedSecondsToPhotons() * 1000,
          ]);
          if (panoramaPhase.length > 600) panoramaPhase.shift();
        }
        state.publishedFrames++;
      } else {
        const textures = renderer.getEyeTextureHandles();
        if (!textures) throw new Error("Missing eye targets");
        const result = presenter.present(overlays.getHandles(), textures, cameras);
        state.lastPresent = result;
        if (result.waitResult === OpenVR.OverlayError.VROverlayError_TimedOut) state.waitTimeouts++;
        else if (result.error) {
          throw new Error(`Projection publication failed: ${JSON.stringify(result)}`);
        } else {
          shownLeft = textures.left;
          state.publishedFrames++;
        }
      }
      if (performance.now() - lastReportAt > 500) {
        PostMan.PostMessage({
          target: state.webxrTarget!,
          type: "OVERLAYRENDERSTATUS",
          payload: { actorId: state.id, status: health() },
        });
        lastReportAt = performance.now();
      }
      await wait(0);
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
    latest = null;
    overlays?.cleanup();
    panorama?.cleanup();
    presenter?.close();
    renderer?.cleanup();
    // This child owns all native dependants; avoid the known Linux library-teardown race.
    runtime.deferReleaseToProcessExit();
  }
}

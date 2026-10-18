/** Settings → Camera, driven with synthetic pointers and camera OSC, without SteamVR. */
import * as THREE from "three";
import { type PlaytestContext, type PlaytestStep, WRIST_MAIN } from "../../utils/playtest.ts";
import { getAgentReplBaseUrl } from "../../classes/utils.ts";
import { vrcCameraStore } from "../../classes/environment/vrcCameraStore.ts";
import { getSetting } from "../../classes/settings.ts";
import {
  WebXRRaythreeSceneBridge,
  withoutVrcCameraHelpers,
} from "../../classes/webxrRaythreeScene.ts";

function menu(ctx: PlaytestContext): THREE.Object3D {
  let found: THREE.Object3D | null = null;
  ctx.scene().traverse((o) => {
    if (o.userData?.wristMenuActor !== undefined) found = o.parent;
  });
  if (!found) throw new Error("missing wrist menu");
  return found;
}
async function click(ctx: PlaytestContext, text: string) {
  const root = menu(ctx);
  const object = ctx.textObject(root, text);
  if (!object) throw new Error(`missing ${text}`);
  root.updateWorldMatrix(true, true);
  const p = root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
  await ctx.t.clickWristMenu([p.x / 0.001, p.y / 0.001]);
}
const camera = () => vrcCameraStore.get()!;

export const steps: PlaytestStep[] = [
  {
    name: "camera-page",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      await click(ctx, "CAMERA");
      await ctx.waitFor(() => ctx.textObject(menu(ctx), "VRC CAMERA"), "camera page opens");
      ctx.expect(ctx.textObject(menu(ctx), "VRChat camera · not seen"), "no OSC is explained");
      await click(ctx, "OFF");
      ctx.expect(camera().tracker.live, "switch starts open-ended calibration");
    },
  },
  {
    name: "live-fit-and-ball",
    run: async (ctx) => {
      let position: [number, number, number] = [0, 0, 0];
      // Different positions and all three rotation axes make scale, yaw and grip observable.
      for (let i = 0; i < 36; i++) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            Math.sin(i * 1.1) * 0.7,
            i * 0.6,
            Math.cos(i * 0.8) * 0.5,
          ),
        );
        const p = new THREE.Vector3(
          Math.sin(i * 0.9) * 0.3,
          1.3 + Math.cos(i) * 0.2,
          -0.4 + Math.sin(i * 0.7) * 0.3,
        );
        ctx.t.input.right.position = p.toArray();
        ctx.t.input.right.quaternion = q.toArray();
        position = p.add(new THREE.Vector3(0.03, -0.05, -0.12).applyQuaternion(q)).toArray();
        await ctx.settle();
        for (let j = 0; j < 2; j++) {
          await fetch(`${getAgentReplBaseUrl()}/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              target: "webxr",
              type: "VRCCAMERADEBUGUPDATE",
              reply: false,
              payload: {
                cameraPose: {
                  position: [position[0], position[1], -position[2]],
                  rotationDeg: [0, 0, 0],
                  receivedAt: Date.now(),
                },
                zoom: 45,
              },
            }),
          }).then(async (r) => {
            const b = await r.json();
            if (!b.ok) throw new Error(JSON.stringify(b));
          });
          await ctx.sleep(105);
        }
      }
      await ctx.waitFor(() => camera().tracker.liveFit, "worker publishes a live fit", 5000);
      const fit = camera().tracker.liveFit;
      ctx.expect(fit?.hand === "right", "holding hand detected");
      ctx.expect(fit != null && fit.rmsErrorMeters < 0.001, "fit error below 1 mm");
      await ctx.settle();
      const ball = ctx.scene().getObjectByName("vrc-camera-calibration-ball");
      ctx.expect(ball?.visible, "green ball shows during calibration");
      ctx.expect(
        ball && ball.position.distanceTo(new THREE.Vector3(...position)) < 0.001,
        "ball predicts camera position",
      );
      const context = (ctx.host as unknown as {
        getRaythreeSceneContext(): Parameters<WebXRRaythreeSceneBridge["buildPayload"]>[0];
      }).getRaythreeSceneContext();
      const bridge = new WebXRRaythreeSceneBridge();
      const payload = bridge.buildPayload(context, {} as never);
      ctx.expect(
        payload.leftEye.frame.instances.some((i) =>
          (i as { vrcCameraHidden?: boolean }).vrcCameraHidden
        ),
        "VR extraction includes marked ball",
      );
      const recording = withoutVrcCameraHelpers(payload.leftEye);
      ctx.expect(
        recording.frame.instances.length === payload.leftEye.frame.instances.length - 1,
        "recording extraction excludes exactly the calibration ball",
      );
      ctx.expect(
        payload.leftEye.frame.instances.length > recording.frame.instances.length,
        "filter leaves headset extraction intact",
      );
      await ctx.t.faceWristMenu();
    },
  },
  {
    name: "freeze-calibration",
    run: async (ctx) => {
      const ball = ctx.scene().getObjectByName("vrc-camera-calibration-ball");
      await click(ctx, "ON");
      ctx.expect(!camera().tracker.live && camera().tracker.calibration, "switch off keeps fit");
      ctx.expect(!ball?.visible, "switch off hides ball");
    },
  },
  {
    name: "recording-controls",
    run: async (ctx) => {
      await click(ctx, "1920x1080");
      ctx.expect(getSetting("vrcCameraResolution") === "1280x720", "resolution saved");
      await click(ctx, "START");
      await ctx.waitFor(() => camera().layer.running, "recording layer starts", 15000);
      const ball = ctx.scene().getObjectByName("vrc-camera-calibration-ball");
      await ctx.waitFor(() => ball?.visible, "recording shows the ball after calibration is off");
      ctx.expect(
        camera().layer.width === 1280 && camera().layer.height === 720,
        "layer uses saved resolution",
      );
      await ctx.waitFor(() => ctx.textObject(menu(ctx), "STOP"), "start completes", 15000);
      await click(ctx, "STOP");
      await ctx.waitFor(() => !camera().layer.running, "recording layer stops", 15000);
      await ctx.waitFor(() => !ball?.visible, "ball hides when recording and calibration are both off");
      await ctx.waitFor(() => ctx.textObject(menu(ctx), "START"), "stop completes", 15000);
      await click(ctx, "CLEAR");
      ctx.expect(camera().tracker.calibration == null, "clear drops calibration");
    },
  },
];

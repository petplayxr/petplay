/**
 * Measurement: frames between the commanded controller aim and the
 * laser beam / hit cursor drawn for it.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestStep } from "../../utils/playtest.ts";
import { aim, display, LEFT_ORIGIN, showWindows, worldOf } from "./lib/steps.ts";

function fitLag(seen: number[], step: number, skip: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (let i = skip; i < seen.length; i++) {
    xs.push(i);
    ys.push(seen[i]);
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // seen[i] = step * (i - lag) when slope == step.
  return -intercept / step + (1 - slope / step) * 0;
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "laser-lag",
    run: async (ctx) => {
      const target = display(ctx);
      const { position: centre, right } = worldOf(target);
      const start = centre.clone().addScaledVector(right, -0.15);
      aim(ctx, "left", LEFT_ORIGIN, start);
      await ctx.sleep(600);
      // The left beam: a visible HUD box under the left controller, nearest the hand origin.
      const beams: THREE.Mesh[] = [];
      ctx.scene().traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (
          mesh.isMesh && mesh.matrixAutoUpdate === false && mesh.userData?.raythreeHudOverUi &&
          (mesh.geometry as THREE.BufferGeometry)?.type === "BoxGeometry"
        ) beams.push(mesh);
      });
      const beam =
        beams.filter((b) => b.visible).sort((a, b) =>
          worldOf(a).position.distanceTo(LEFT_ORIGIN) - worldOf(b).position.distanceTo(LEFT_ORIGIN)
        )[0];
      if (beam == null) {
        ctx.expect(false, `no visible beam (${beams.length} candidates)`);
        return;
      }
      // deno-lint-ignore no-explicit-any
      const internal = (ctx.host as any).rootStore.getState().internal;
      const step = 0.003; // m along the window per frame
      const beamSeen: number[] = [];
      const hitSeen: number[] = [];
      let k = 0;
      const stop = internal.scheduler.register(() => {
        // What this frame draws: beam direction and far end, projected onto the sweep.
        const w = worldOf(beam);
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quaternion);
        const origin = LEFT_ORIGIN.clone();
        // Where the beam direction crosses the window plane through `centre` facing the hand.
        const normal = new THREE.Vector3().subVectors(origin, centre).normalize();
        const t = normal.dot(new THREE.Vector3().subVectors(centre, origin)) / normal.dot(forward);
        const crossing = origin.clone().addScaledVector(forward, t);
        beamSeen.push(crossing.sub(start).dot(right));
        const end = w.position.clone().addScaledVector(forward, w.scale.z / 2);
        hitSeen.push(end.sub(start).dot(right));
        k++;
        const next = start.clone().addScaledVector(right, step * k);
        aim(ctx, "left", LEFT_ORIGIN, next);
      }, { priority: -1e9, rootId: internal.rootId });
      await ctx.waitFor(() => k >= 90, "90 frames of sweep", 5000);
      stop();
      ctx.t.parkLeftHand();
      // Aim set in frame k is sampled in frame k+1: zero lag reads step*k in frame k+1, i.e.
      // seen[i] = step * i at index i (the callback pushes before commanding).
      ctx.note(`beam lag ${fitLag(beamSeen, step, 15).toFixed(2)} frames`);
      ctx.note(`hit-end lag ${fitLag(hitSeen, step, 15).toFixed(2)} frames`);
      ctx.note(
        `beam/step 15..25 ${beamSeen.slice(15, 25).map((v) => (v / step).toFixed(1)).join(" ")}`,
      );
      ctx.note(
        `hit/step 15..25 ${hitSeen.slice(15, 25).map((v) => (v / step).toFixed(1)).join(" ")}`,
      );
    },
  },
];

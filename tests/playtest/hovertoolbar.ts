/**
 * Measurement: frames from a laser landing on a window to its context
 * toolbar being fully built, on whatever server runs it.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import type { PlaytestContext, PlaytestStep } from "../../utils/playtest.ts";
import { aim, LEFT_ORIGIN, showWindows, toolbarOf, worldOf } from "./lib/steps.ts";
import { getSpatialGraph } from "../../classes/environment/workspaceLayoutStore.ts";

function displays(ctx: PlaytestContext): THREE.Object3D[] {
  const graph = getSpatialGraph();
  return Object.values(graph?.nodes ?? {})
    .filter((node) => node.kind === "display")
    .map((node) => ctx.nodeObject(node.id))
    .filter((object): object is THREE.Object3D => object != null);
}

function visibleMeshes(root: THREE.Object3D | null): number {
  if (root == null) return -1;
  let count = 0;
  root.traverseVisible((node) => {
    if ((node as THREE.Mesh).isMesh) count++;
  });
  return count;
}

export const steps: PlaytestStep[] = [
  showWindows,
  {
    name: "toolbar-appear",
    run: async (ctx) => {
      const list = displays(ctx);
      ctx.note(`displays ${list.length}`);
      if (list.length < 2) {
        ctx.expect(false, "need two displays to switch hover between");
        return;
      }
      // deno-lint-ignore no-explicit-any
      const internal = (ctx.host as any).rootStore.getState().internal;
      for (let round = 0; round < 4; round++) {
        const [from, to] = round % 2 === 0 ? [list[0], list[1]] : [list[1], list[0]];
        aim(ctx, "left", LEFT_ORIGIN, worldOf(from).position);
        await ctx.sleep(700);
        const trace: number[] = [];
        const snapshots: string[][] = [];
        let frame = 0;
        let aimed = false;
        const stop = internal.scheduler.register(() => {
          // Read at the end of the update phase, so this is what this frame renders.
          if (aimed) {
            trace.push(visibleMeshes(toolbarOf(to)));
            const bar = toolbarOf(to);
            if (bar != null && round === 0) {
              const now: string[] = [];
              bar.traverseVisible((node) => {
                if (!(node as THREE.Mesh).isMesh) return;
                let path = "";
                for (let n: THREE.Object3D | null = node; n != null && n !== bar; n = n.parent) {
                  path = `${n.constructor.name}${n.name ? `(${n.name})` : ""}/` + path;
                }
                now.push(path);
              });
              snapshots.push(now);
            }
          }
          if (!aimed) {
            aim(ctx, "left", LEFT_ORIGIN, worldOf(to).position);
            aimed = true;
          }
          frame++;
        }, { priority: -1e9, rootId: internal.rootId });
        await ctx.waitFor(() => trace.length >= 40, "40 frames after the hover", 5000);
        stop();
        // trace[0] is the frame that samples the new aim.
        const first = trace.findIndex((n) => n > 0);
        const final = trace.at(-1)!;
        const settled = trace.findIndex((n, i) => trace.slice(i).every((m) => m === final));
        ctx.note(
          `round ${round}: toolbar first drawn at frame ${first}, complete (${final} meshes) at ` +
            `frame ${settled}; trace ${trace.slice(0, 14).join(" ")}`,
        );
        if (round === 0 && snapshots.length > 2) {
          const early = new Set(snapshots[0]);
          ctx.note(`late meshes: ${snapshots.at(-1)!.filter((m) => !early.has(m)).join(" | ")}`);
          ctx.note(`early meshes: ${snapshots[0].slice(0, 6).join(" | ")}`);
        }
      }
      ctx.t.parkLeftHand();
    },
  },
];

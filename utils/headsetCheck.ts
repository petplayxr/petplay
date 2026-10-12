/**
 * Guided headset check: the things only a person in the headset can judge, asked one at a time.
 *
 * Each step sets something up (curves a display, anchors it to the head, ...), asks a yes/no
 * question as a toast, and undoes its setup once answered. Answer on the LEFT stick: up = yes,
 * down = no, left = skip. The right stick is left alone because it scrolls displays. Results go
 * to `logs/headset-check-<time>.json`, so an agent can read them afterwards.
 *
 * Run it from the agent REPL `/eval` in the `webxr` actor:
 *
 *     const c = await import("file:///…/utils/headsetCheck.ts");
 *     return await c.runHeadsetCheck(host);
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { pushToast, toastQueue } from "../classes/environment/toastStore.ts";
import { editSpatialGraph, getSpatialGraph } from "../classes/environment/workspaceLayoutStore.ts";
import {
  getSpatialRootId,
  setSpatialNodeCurvature,
  setSpatialNodeMouseBlocked,
  setSpatialNodeOpacity,
  setSpatialRootOrigin,
  type SpatialGraph,
} from "../classes/environment/spatialGraph.ts";
import { anchoredRootTransform } from "../classes/environment/scene.tsx";
import { getHeadObject, type SpatialOriginId } from "../classes/environment/trackedOrigins.ts";
import { getSetting, setSetting } from "../classes/settings.ts";
import {
  getWindowLayerVisible,
  setWindowLayerVisible,
} from "../classes/environment/windowLayerMode.ts";

export type Answer = "yes" | "no" | "skip";

export type CheckStep = {
  id: string;
  question: string;
  /** Returns the undo, run once the step is answered (or the run stops). */
  setup?: () => (() => void) | void;
};

export type CheckResult = { id: string; question: string; answer: Answer };

/**
 * Runs the steps in order; one step's failure is recorded as a skip, the rest still run.
 * `settle` runs after each undo: graph edits land on the next render, and the next step's setup
 * reads the graph and scene, so it must not see the previous step's changes still in place.
 */
export async function runSteps(
  steps: readonly CheckStep[],
  ask: (step: CheckStep, index: number) => Promise<Answer>,
  settle: () => Promise<void> = () => Promise.resolve(),
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [index, step] of steps.entries()) {
    let undo: (() => void) | void = undefined;
    let answer: Answer = "skip";
    try {
      undo = step.setup?.();
      answer = await ask(step, index);
    } catch (error) {
      console.warn(`[headsetCheck] ${step.id}:`, error);
    } finally {
      try {
        undo?.();
      } catch (error) {
        console.warn(`[headsetCheck] undo ${step.id}:`, error);
      }
    }
    results.push({ id: step.id, question: step.question, answer });
    await settle();
  }
  return results;
}

/** Maps a stick position to an answer, or null while it is near the middle. */
export function answerFromStick(x: number, y: number): Answer | null {
  if (y > 0.7) return "yes";
  if (y < -0.7) return "no";
  if (x < -0.7) return "skip";
  return null;
}

type StickSource = {
  getSnapshot(): { controllers: { left: { joystick: Float32Array } | null } };
};

type CheckHost = {
  rootStore: { getState(): { scene: THREE.Object3D; camera: THREE.Camera; gl: unknown } };
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits for the stick to come back to the middle, then for a deliberate push. */
async function askOnStick(
  source: StickSource,
  step: CheckStep,
  index: number,
  total: number,
): Promise<Answer> {
  const stick = () => source.getSnapshot().controllers.left?.joystick;
  const centred = () => {
    const s = stick();
    return s == null || answerFromStick(s[0], s[1]) == null;
  };
  while (!centred()) await sleep(50);
  let toast = null as ReturnType<typeof pushToast> | null;
  let shownAt = 0;
  try {
    for (;;) {
      // Toasts cap at 30 s, so put the question back up before it expires.
      if (toast == null || Date.now() - shownAt > 25_000) {
        if (toast != null) toastQueue.dismiss(toast.id);
        toast = pushToast({
          title: `${index + 1}/${total}: ${step.question}`,
          content: "Left stick: up = yes, down = no, left = skip",
          source: "Headset check",
          timeoutMs: 30_000,
        });
        shownAt = Date.now();
      }
      const s = stick();
      const answer = s == null ? null : answerFromStick(s[0], s[1]);
      if (answer != null) return answer;
      await sleep(50);
    }
  } finally {
    if (toast != null) toastQueue.dismiss(toast.id);
  }
}

/** The display nearest the middle of the view: the one the steps change. */
function displayInView(host: CheckHost, graph: SpatialGraph): string | null {
  const { scene, camera, gl } = host.rootStore.getState();
  const head = getHeadObject(gl, camera);
  head.updateWorldMatrix(true, false);
  const eye = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
  const forward = new THREE.Vector3(0, 0, -1).transformDirection(head.matrixWorld);
  let best: string | null = null;
  let bestDot = -Infinity;
  scene.traverse((object) => {
    const id = object.userData?.spatialElementId;
    if (typeof id !== "string" || graph.nodes[id]?.kind !== "display") return;
    object.updateWorldMatrix(true, false);
    const toward = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).sub(eye)
      .normalize();
    const dot = toward.dot(forward);
    if (dot > bestDot) {
      bestDot = dot;
      best = id;
    }
  });
  return best;
}

/** Changes a node field for the step, and puts the old value back after. */
function withGraph(
  apply: (graph: SpatialGraph) => SpatialGraph,
  restore: (graph: SpatialGraph) => SpatialGraph,
): () => void {
  editSpatialGraph(apply);
  return () => editSpatialGraph(restore);
}

function anchorStep(
  host: CheckHost,
  displayId: string,
  originId: SpatialOriginId,
  id: string,
  question: string,
): CheckStep {
  return {
    id,
    question,
    setup: () => {
      const graph = getSpatialGraph();
      if (graph == null) throw new Error("no spatial graph");
      const rootId = getSpatialRootId(graph, displayId);
      const before = graph.nodes[rootId];
      const { scene, camera, gl } = host.rootStore.getState();
      const local = anchoredRootTransform(scene, getHeadObject(gl, camera), rootId, originId);
      if (local == null || local === "untracked") throw new Error(`${originId}: ${local}`);
      editSpatialGraph((current) => setSpatialRootOrigin(current, rootId, originId, local));
      // Back to exactly where it was, not wherever the head or hand left it.
      return () =>
        editSpatialGraph((current) =>
          setSpatialRootOrigin(current, rootId, before.originId, before.localTransform)
        );
    },
  };
}

/** The checks that need eyes in the headset, against the display currently in view. */
export function headsetSteps(host: CheckHost, displayId: string): CheckStep[] {
  const node = () => getSpatialGraph()?.nodes[displayId];
  const curved = () => {
    const before = node()?.curvature ?? 0;
    return withGraph(
      (g) => setSpatialNodeCurvature(g, displayId, 0.2),
      (g) => setSpatialNodeCurvature(g, displayId, before),
    );
  };
  const setting = <K extends "wristMenuHand" | "wristMenuScale">(
    key: K,
    value: ReturnType<typeof getSetting<K>>,
  ) =>
  () => {
    const before = getSetting(key);
    setSetting(key, value);
    return () => setSetting(key, before);
  };
  return [
    {
      id: "curve-direction",
      question: "The display in front of you is now curved. Do its edges bend TOWARD you?",
      setup: curved,
    },
    {
      id: "curve-pointer",
      question:
        "Point at its far left and right edges. Does the mouse cursor sit under your laser?",
      setup: curved,
    },
    {
      id: "opacity",
      question: "Is the display now half see-through?",
      setup: () => {
        const before = node()?.opacity ?? 1;
        return withGraph(
          (g) => setSpatialNodeOpacity(g, displayId, 0.5),
          (g) => setSpatialNodeOpacity(g, displayId, before),
        );
      },
    },
    {
      id: "mouse-block",
      question:
        "Sweep your laser across the display and pull the trigger. Does the mouse stay still?",
      setup: () => {
        const before = node()?.mouseBlocked ?? false;
        return withGraph(
          (g) => setSpatialNodeMouseBlocked(g, displayId, true),
          (g) => setSpatialNodeMouseBlocked(g, displayId, before),
        );
      },
    },
    anchorStep(
      host,
      displayId,
      "head",
      "anchor-head",
      "Turn your head. Does the display stay put in front of you?",
    ),
    anchorStep(
      host,
      displayId,
      "left-hand",
      "anchor-left-hand",
      "Move your left hand. Does the display move with it?",
    ),
    {
      id: "wrist-left",
      question: "Is the wrist menu now on the inside of your LEFT wrist, facing you?",
      setup: setting("wristMenuHand", "left"),
    },
    {
      id: "wrist-size",
      question: "Is the wrist menu now bigger (125%), and still comfortable?",
      setup: setting("wristMenuScale", 1.25),
    },
    {
      id: "wrist-move",
      question:
        "Grab the wrist menu with your other hand, move it, let go. Does it stay where you left it?",
      setup: () => {
        const before = getSetting("wristMenuOffset");
        return () => setSetting("wristMenuOffset", before);
      },
    },
    {
      id: "haptics",
      question: "Sweep your laser over the wrist menu buttons. Does the controller buzz on each?",
    },
    {
      id: "battery",
      question: "Does the wrist show battery for both controllers and the headset?",
    },
    {
      id: "replace-wayvr",
      question: "Overall: would you use PetPlay instead of WayVR today?",
    },
  ];
}

/** Runs the whole check in the headset and writes the answers to `logs/`. */
export async function runHeadsetCheck(
  host: CheckHost & { directOpenVrInputSource?: StickSource },
  { steps }: { steps?: CheckStep[] } = {},
): Promise<{ path: string; results: CheckResult[] }> {
  const source = (host as unknown as { directOpenVrInputSource: StickSource })
    .directOpenVrInputSource;
  const graph = getSpatialGraph();
  if (graph == null) throw new Error("the scene has no spatial graph yet");
  // Hidden displays are not in the scene, and there would be nothing to look at.
  if (!getWindowLayerVisible()) {
    setWindowLayerVisible(true);
    await sleep(500);
  }
  const displayId = displayInView(host, graph);
  if (displayId == null) throw new Error("no display in the layout");
  const plan = steps ?? headsetSteps(host, displayId);
  const results = await runSteps(
    plan,
    (step, index) => askOnStick(source, step, index, plan.length),
    () => sleep(300),
  );
  pushToast({ title: "Headset check done, thanks", source: "Headset check", timeoutMs: 4000 });
  const path = `logs/headset-check-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await Deno.mkdir("logs", { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify({ displayId, results }, null, 2) + "\n");
  return { path, results };
}

/**
 * Scripted playtesting without a headset: in-isolate helpers that drive the wrist menu with the
 * same synthetic controller input as `utils/overlay-perf-harness.ts`, so clicks travel the
 * production path (IWER poses -> XRSpace -> pmndrs pointers -> uikit handlers).
 *
 * Load it inside the `webxr` actor through the agent REPL, against a `dev --novr` server:
 *
 *   POST /eval {"target":"webxr","code":"
 *     const p = await import('file:///…/utils/playtest.ts');
 *     const t = await p.startPlaytest(host);
 *     await t.faceWristMenu();
 *     await t.clickWristMenu(p.WRIST_MAIN.settings);
 *     return 'ok';"}
 *
 * then `deno run -A petplay/client.ts capture --path=…` to look at the result. The session handle
 * is kept on `globalThis`, so later evals continue it (`startPlaytest` returns the same one).
 *
 * Wrist-menu coordinates are panel pixels from the panel centre, y up (the uikit root is 528px
 * square at 0.001 m/px before the wrist scale).
 *
 * Scripted runs (`deno task playtest <name>`, `utils/playtest-run.ts`) go through
 * `runPlaytestStep`: a script in `tests/playtest/<name>.ts` exports `steps`, and the runner calls
 * them one at a time, capturing the view after each.
 */
import * as THREE from "three";
import {
  aimAt,
  installSyntheticInput,
  type SynthInput,
  type WebXrHostLike,
} from "./overlay-perf-harness.ts";

export type PanelPoint = readonly [number, number];

/** Home screen tiles (`classes/environment/ui/wristOverlay.tsx`). */
export const WRIST_MAIN = {
  layout: [-201, -66],
  edit: [-67, -66],
  settings: [67, -66],
  recenter: [201, -66],
} as const satisfies Record<string, PanelPoint>;

/** Settings page rows' right-hand pills, and the sub-page row (`classes/environment/wristMenu/ui.tsx`). */
export const WRIST_SETTINGS = {
  back: [-197, 195],
  grabboxOutline: [189, 125],
  controllerLaser: [189, 47],
  haptics: [189, -31],
  desktopNotifications: [189, -109],
  wrist: [-158, -187],
  monitors: [0, -187],
  layouts: [158, -187],
} as const satisfies Record<string, PanelPoint>;

/** Settings → Wrist menu page: the right-hand pill of each row. */
export const WRIST_WRIST = {
  back: [-197, 156],
  hand: [189, 86],
  scale: [189, 8],
  opacity: [189, -70],
  resetPosition: [189, -148],
} as const satisfies Record<string, PanelPoint>;

/** Saved layouts page: SAVE and LOAD pills per slot row. */
export const WRIST_LAYOUTS = {
  back: [-210, 124],
  save: (slot: 1 | 2 | 3): PanelPoint => [137, 133 - 83 * slot],
  load: (slot: 1 | 2 | 3): PanelPoint => [201, 133 - 83 * slot],
} as const;

/** Where the panel is held for a capture: in front of the IWER default head at 1.6 m. */
const VIEW_TARGET = new THREE.Vector3(0, 1.6, -0.2);
/** Pointer origin for clicks: just below and left of the head, like a resting left hand. */
const CLICK_ORIGIN: readonly [number, number, number] = [-0.1, 1.5, 0.1];
/** The menu's local z for the uikit surface (the grab box is 0.04 deep). */
const PANEL_SURFACE_Z = 0.02;
const SETTLE_MS = 300;

type PlaytestScene = THREE.Object3D;
type PlaytestHost = Omit<WebXrHostLike, "rootStore"> & {
  rootStore: { getState: () => { scene: PlaytestScene } };
};

export type PlaytestSession = {
  input: SynthInput;
  /** Holds the right wrist so the menu faces the head at `VIEW_TARGET`. */
  faceWristMenu: () => Promise<void>;
  /** Aims the left ray at a panel point and leaves it there (hover). */
  hoverWristMenu: (point: PanelPoint) => Promise<void>;
  /** Hover, trigger press/release, then park the left hand out of view. */
  clickWristMenu: (point: PanelPoint) => Promise<void>;
  parkLeftHand: () => void;
  /** Gives the app back its own controller bridge. */
  stop: () => void;
};

const SESSION_KEY = "__petplayPlaytest";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findWristMenu(scene: PlaytestScene): THREE.Object3D {
  let menu: THREE.Object3D | null = null;
  scene.traverse((node) => {
    if (menu == null && node.userData?.wristMenuActor !== undefined) menu = node.parent;
  });
  if (menu == null) throw new Error("playtest: no wrist menu in the scene");
  return menu;
}

export function startPlaytest(host: PlaytestHost): PlaytestSession {
  const existing = (globalThis as Record<string, unknown>)[SESSION_KEY] as
    | PlaytestSession
    | undefined;
  if (existing != null) return existing;

  // The harness only reads `directOpenVrInputSource` and the controller bridge from the host.
  const input = installSyntheticInput(host as unknown as WebXrHostLike);
  const scene = () => host.rootStore.getState().scene;
  const menuWorld = () => {
    const root = scene();
    root.updateMatrixWorld(true);
    const menu = findWristMenu(root);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    menu.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
    return { menu, position, quaternion };
  };

  const parkLeftHand = () => {
    input.left.position = [-0.3, 0.8, -0.2];
    input.left.quaternion = [0, 0, 0, 1];
  };

  const faceWristMenu = async () => {
    // The menu hangs off the right grip at a fixed offset: measure it with an identity hand pose,
    // then solve for the hand pose that puts the menu at the target, facing +z (the head).
    // Twice, because the first read after input install can see a not-yet-updated XRSpace.
    for (let pass = 0; pass < 2; pass++) {
      const base = new THREE.Vector3(0, 1.2, -0.3);
      input.right.position = [base.x, base.y, base.z];
      input.right.quaternion = [0, 0, 0, 1];
      await sleep(SETTLE_MS * 2);
      const { position, quaternion } = menuWorld();
      const handQuaternion = quaternion.clone().invert();
      const offset = position.sub(base).applyQuaternion(handQuaternion);
      const handPosition = VIEW_TARGET.clone().sub(offset);
      input.right.position = [handPosition.x, handPosition.y, handPosition.z];
      input.right.quaternion = [
        handQuaternion.x,
        handQuaternion.y,
        handQuaternion.z,
        handQuaternion.w,
      ];
      await sleep(SETTLE_MS);
    }
    parkLeftHand();
  };

  const hoverWristMenu = async ([x, y]: PanelPoint) => {
    const { menu } = menuWorld();
    const target = menu.localToWorld(new THREE.Vector3(x * 0.001, y * 0.001, PANEL_SURFACE_Z));
    aimAt(input, "left", CLICK_ORIGIN, [target.x, target.y, target.z]);
    await sleep(SETTLE_MS);
  };

  const clickWristMenu = async (point: PanelPoint) => {
    await hoverWristMenu(point);
    input.left.trigger = true;
    await sleep(150);
    input.left.trigger = false;
    await sleep(SETTLE_MS);
    parkLeftHand();
    await sleep(SETTLE_MS);
  };

  const session: PlaytestSession = {
    input,
    faceWristMenu,
    hoverWristMenu,
    clickWristMenu,
    parkLeftHand,
    stop: () => {
      input.restore();
      delete (globalThis as Record<string, unknown>)[SESSION_KEY];
    },
  };
  (globalThis as Record<string, unknown>)[SESSION_KEY] = session;
  return session;
}

/** Everything a playtest step gets: the input session, scene lookups and the expectation log. */
export type PlaytestContext = {
  host: PlaytestHost;
  t: PlaytestSession;
  scene: () => THREE.Object3D;
  /** The scene object drawing a spatial node, or null when it is not in the scene. */
  nodeObject: (id: string) => THREE.Object3D | null;
  /** The first object under `root` drawing `text`. */
  textObject: (root: THREE.Object3D, text: string) => THREE.Object3D | null;
  /** Points the left ray at `target` from `distance` m in front of `face`, and pulls the trigger. */
  clickObject: (target: THREE.Object3D, face?: THREE.Object3D, distance?: number) => Promise<void>;
  /** Records a failure when `condition` is falsy; the step carries on. */
  expect: (condition: unknown, message: string) => boolean;
  note: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Polls until `check` is truthy; a timeout is a failed expectation. */
  waitFor: (check: () => unknown, message: string, timeoutMs?: number) => Promise<boolean>;
  /** Kept across steps, for values a later step compares against. */
  memo: Record<string, unknown>;
};

export type PlaytestStep = {
  name: string;
  run: (ctx: PlaytestContext) => Promise<void>;
};

export type PlaytestStepResult = {
  name: string;
  ok: boolean;
  ms: number;
  notes: string[];
  failures: string[];
};

const MEMO_KEY = "__petplayPlaytestMemo";

/**
 * Runs step `index` of the script at `scriptUrl`. A throw counts as a failure, so the runner always
 * gets a result back and can still capture the view.
 */
export async function runPlaytestStep(
  host: PlaytestHost,
  scriptUrl: string,
  index: number,
): Promise<PlaytestStepResult> {
  const { steps } = await import(scriptUrl) as { steps: PlaytestStep[] };
  const step = steps[index];
  if (step == null) throw new Error(`playtest: no step ${index} in ${scriptUrl}`);
  const notes: string[] = [];
  const failures: string[] = [];
  const memo = ((globalThis as Record<string, unknown>)[MEMO_KEY] ??= {}) as Record<
    string,
    unknown
  >;
  const t = startPlaytest(host);
  const scene = () => host.rootStore.getState().scene;
  const findObject = (root: THREE.Object3D, match: (object: THREE.Object3D) => boolean) => {
    root.updateMatrixWorld(true);
    let found: THREE.Object3D | null = null;
    root.traverse((object) => {
      if (found == null && match(object)) found = object;
    });
    return found as THREE.Object3D | null;
  };
  const expect = (condition: unknown, message: string) => {
    if (!condition) failures.push(message);
    return Boolean(condition);
  };
  const ctx: PlaytestContext = {
    host,
    t,
    scene,
    nodeObject: (id) => findObject(scene(), (object) => object.userData?.spatialElementId === id),
    textObject: (root, text) =>
      findObject(root, (object) => object.userData?.raythreeUiText?.text === text),
    clickObject: async (target, face = target, distance = 0.6) => {
      const point = target.getWorldPosition(new THREE.Vector3());
      const facing = face.getWorldQuaternion(new THREE.Quaternion());
      const from = new THREE.Vector3(0, 0, distance).applyQuaternion(facing).add(point);
      aimAt(t.input, "left", [from.x, from.y, from.z], [point.x, point.y, point.z]);
      await sleep(SETTLE_MS);
      t.input.left.trigger = true;
      await sleep(150);
      t.input.left.trigger = false;
      await sleep(SETTLE_MS);
      t.parkLeftHand();
      await sleep(SETTLE_MS);
    },
    expect,
    note: (message) => notes.push(message),
    sleep,
    waitFor: async (check, message, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (check()) return true;
        await sleep(50);
      }
      return expect(check(), message);
    },
    memo,
  };
  const started = performance.now();
  try {
    await step.run(ctx);
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack ?? error.message : error}`);
  }
  return {
    name: step.name,
    ok: failures.length === 0,
    ms: Math.round(performance.now() - started),
    notes,
    failures,
  };
}

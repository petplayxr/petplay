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
/**
 * Frames for an aim or a trigger change to land: the next frame samples the input, moves the
 * XRSpace and the pointer, and React commits what the handlers set a frame or two after.
 */
const SETTLE_FRAMES = 4;
/** Frames a trigger stays down for a click. */
const PRESS_FRAMES = 2;

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

/**
 * Resolves after `count` r3f frames. Steps wait in frames, not milliseconds: what they wait for is
 * the input reaching the scene, which takes frames however long a frame is.
 */
export function waitFrames(host: PlaytestHost, count: number): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const internal = (host.rootStore.getState() as any).internal;
  if (internal?.scheduler?.register == null) return sleep(count * 20);
  return new Promise((resolve) => {
    let seen = 0;
    const unregister = internal.scheduler.register(() => {
      if (++seen < count) return;
      unregister();
      resolve();
    }, { priority: -1e9, rootId: internal.rootId });
  });
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
      await waitFrames(host, SETTLE_FRAMES * 2);
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
      await waitFrames(host, SETTLE_FRAMES);
    }
    parkLeftHand();
  };

  const hoverWristMenu = async ([x, y]: PanelPoint) => {
    const { menu } = menuWorld();
    const target = menu.localToWorld(new THREE.Vector3(x * 0.001, y * 0.001, PANEL_SURFACE_Z));
    aimAt(input, "left", CLICK_ORIGIN, [target.x, target.y, target.z]);
    await waitFrames(host, SETTLE_FRAMES);
  };

  const clickWristMenu = async (point: PanelPoint) => {
    await hoverWristMenu(point);
    input.left.trigger = true;
    await waitFrames(host, PRESS_FRAMES);
    input.left.trigger = false;
    await waitFrames(host, SETTLE_FRAMES);
    parkLeftHand();
    await waitFrames(host, SETTLE_FRAMES);
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
  /** Real time, for what the app itself times (a debounce, an animation); input waits use `frames`. */
  sleep: (ms: number) => Promise<void>;
  /** Waits `count` frames. */
  frames: (count: number) => Promise<void>;
  /** Waits for an aim or a trigger change to land. */
  settle: () => Promise<void>;
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
  /** Frame pacing over the step; absent when the scene has no r3f scheduler to time. */
  frames?: PlaytestFrameStats;
  /** With a profile path: what ran during each stall of at least `STALL_PROFILE_MIN_MS`. */
  stallProfiles?: PlaytestStallProfile[];
};

/** Where a stalled frame's time went, in ms per function, from a CPU profile of the step. */
export type PlaytestStallProfile = {
  at: number;
  ms: number;
  /** Time with the function on top of the stack. */
  self: [string, number][];
  /** Time with the function anywhere on the stack. */
  total: [string, number][];
  /** `total` for PetPlay's own code only, which is usually where a fix goes. */
  app: [string, number][];
};

const STALL_PROFILE_MIN_MS = 40;
const PROFILE_WARMUP_FRAMES = 30;

type CpuProfile = {
  nodes: {
    id: number;
    callFrame: { functionName: string; url: string; lineNumber: number };
    children?: number[];
  }[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
};

/** Starts V8's sampler on this isolate; the returned stop writes the profile to `path`. */
async function startProfile(
  path: string,
): Promise<() => Promise<{ profile: CpuProfile; perfAtStop: number }>> {
  const { Session } = await import("node:inspector");
  const session = new Session();
  session.connect();
  const post = (method: string, params?: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) =>
      session.post(
        method,
        params ?? {},
        (error, result) =>
          error != null ? reject(error) : resolve(result as Record<string, unknown>),
      )
    );
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 250 });
  await post("Profiler.start");
  return async () => {
    try {
      const perfAtStop = performance.now();
      const { profile } = await post("Profiler.stop") as { profile: CpuProfile };
      await Deno.writeTextFile(path, JSON.stringify(profile));
      return { profile, perfAtStop };
    } finally {
      session.disconnect();
    }
  };
}

const projectUrl = new URL("../", import.meta.url).href;

function isAppFrame(url: string): boolean {
  return url.startsWith(projectUrl) && !/\/(node_modules|submodules|utils|tests)\//.test(url);
}

function frameLabel(frame: CpuProfile["nodes"][number]["callFrame"]): string {
  const file = frame.url.split("/").slice(-2).join("/");
  const name = frame.functionName || "(anonymous)";
  return file ? `${name} ${file}:${frame.lineNumber + 1}` : name;
}

/** Self and inclusive time per function for the samples inside each stalled frame. */
function profileStalls(
  { profile, perfAtStop }: { profile: CpuProfile; perfAtStop: number },
  started: number,
  stalls: [number, number][],
): PlaytestStallProfile[] {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  // Sample i lands at startTime + sum(timeDeltas[0..i]) µs. Anchored at the stop: starting the
  // profiler blocks the isolate for a while, so its resolving is well after startTime.
  // Deltas can be negative, so weigh each sample by the gap to the next one in time order.
  const times: number[] = [];
  let clock = profile.startTime;
  for (const delta of profile.timeDeltas) {
    times.push(perfAtStop - (profile.endTime - (clock += delta)) / 1000);
  }
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const weights: number[] = [];
  order.forEach((i, k) => weights[i] = k + 1 < order.length ? times[order[k + 1]] - times[i] : 0);
  const top = (map: Map<string, number>) =>
    [...map].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, ms]) =>
      [label, Math.round(ms * 10) / 10] as [string, number]
    );
  return stalls.filter(([, ms]) => ms >= STALL_PROFILE_MIN_MS).map(([at, ms]) => {
    const end = started + at;
    const self = new Map<string, number>();
    const total = new Map<string, number>();
    const app = new Map<string, number>();
    for (let i = 0; i < profile.samples.length; i++) {
      if (times[i] < end - ms || times[i] > end) continue;
      const weight = weights[i];
      let node = byId.get(profile.samples[i]);
      if (node == null) continue;
      const leaf = frameLabel(node.callFrame);
      self.set(leaf, (self.get(leaf) ?? 0) + weight);
      const seen = new Set<string>();
      while (node != null) {
        const label = frameLabel(node.callFrame);
        if (label !== "(root)" && !seen.has(label)) {
          seen.add(label);
          total.set(label, (total.get(label) ?? 0) + weight);
          if (isAppFrame(node.callFrame.url)) app.set(label, (app.get(label) ?? 0) + weight);
        }
        const up = parent.get(node.id);
        node = up == null ? undefined : byId.get(up);
      }
    }
    return { at, ms, self: top(self), total: top(total), app: top(app) };
  });
}

export type PlaytestFrameStats = {
  count: number;
  medianMs: number;
  maxMs: number;
  /** Frames that took at least twice the median: `[ms into the step, frame interval ms]`. */
  stalls: [number, number][];
};

/**
 * Times every frame while a step runs, from the end of one r3f update to the next, so a stall
 * anywhere on the thread (a React commit, a texture upload, the render) shows up as a long
 * interval.
 */
function watchFrames(host: PlaytestHost, started: number): () => PlaytestFrameStats | undefined {
  // deno-lint-ignore no-explicit-any
  const internal = (host.rootStore.getState() as any).internal;
  if (internal?.scheduler?.register == null) return () => undefined;
  const intervals: [number, number][] = [];
  let last = 0;
  // r3f v10 scheduler: higher priority runs earlier, so this is the last job of the update.
  const unregister = internal.scheduler.register(() => {
    const now = performance.now();
    if (last > 0) intervals.push([Math.round(now - started), now - last]);
    last = now;
  }, { priority: -1e9, rootId: internal.rootId });
  return () => {
    unregister();
    if (intervals.length === 0) return undefined;
    const sorted = intervals.map(([, ms]) => ms).sort((a, b) => a - b);
    const medianMs = sorted[sorted.length >> 1];
    const round = (ms: number) => Math.round(ms * 10) / 10;
    return {
      count: intervals.length,
      medianMs: round(medianMs),
      maxMs: round(sorted.at(-1)!),
      stalls: intervals.filter(([, ms]) => ms >= medianMs * 2).map(([at, ms]) => [at, round(ms)]),
    };
  };
}

const MEMO_KEY = "__petplayPlaytestMemo";

/**
 * Runs step `index` of the script at `scriptUrl`. A throw counts as a failure, so the runner always
 * gets a result back and can still capture the view.
 */
export async function runPlaytestStep(
  host: PlaytestHost,
  scriptUrl: string,
  index: number,
  options: { profilePath?: string } = {},
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
      await waitFrames(host, SETTLE_FRAMES);
      t.input.left.trigger = true;
      await waitFrames(host, PRESS_FRAMES);
      t.input.left.trigger = false;
      await waitFrames(host, SETTLE_FRAMES);
      t.parkLeftHand();
      await waitFrames(host, SETTLE_FRAMES);
    },
    expect,
    note: (message) => notes.push(message),
    sleep,
    frames: (count) => waitFrames(host, count),
    settle: () => waitFrames(host, SETTLE_FRAMES),
    waitFor: async (check, message, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (check()) return true;
        await waitFrames(host, 1);
      }
      return expect(check(), message);
    },
    memo,
  };
  const stopProfile = options.profilePath ? await startProfile(options.profilePath) : null;
  // Starting the sampler stalls the isolate; let that pass before the step acts.
  if (stopProfile != null) await waitFrames(host, PROFILE_WARMUP_FRAMES);
  const started = performance.now();
  const stopWatching = watchFrames(host, started);
  try {
    await step.run(ctx);
  } catch (error) {
    failures.push(`threw: ${error instanceof Error ? error.stack ?? error.message : error}`);
  }
  const ms = Math.round(performance.now() - started);
  const frames = stopWatching();
  const profile = await stopProfile?.();
  return {
    name: step.name,
    ok: failures.length === 0,
    ms,
    notes,
    failures,
    frames,
    stallProfiles: profile && frames ? profileStalls(profile, started, frames.stalls) : undefined,
  };
}

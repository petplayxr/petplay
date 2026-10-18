import {
  applyVrcCameraCalibration,
  type Quat,
  quatMultiply,
  quatToMatrix,
  solveVrcCameraCalibration,
  type TrackedPose,
  unityPoseToRightHanded,
  type Vec3,
  type VrcCameraCalibration,
  type VrcCameraCalibrationSample,
  VrcCameraCalibrator,
  VrcCameraTracker,
} from "./vrcCameraCalibration.ts";
import { createVrcCameraWorkerSolver } from "./vrcCameraSolver.ts";

function assertNear(actual: number, expected: number, epsilon = 1e-6): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function forward(q: Quat): Vec3 {
  const m = quatToMatrix(q);
  return [-m[0][2], -m[1][2], -m[2][2]];
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

/** Deterministic pseudo-random sequence so a failing fit reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

Deno.test("unityPoseToRightHanded keeps Unity's forward direction", () => {
  const yawed = unityPoseToRightHanded({ position: [1, 2, 3], rotationDeg: [0, 90, 0] });
  assertNear(yawed.position[2], -3);
  const yawedForward = forward(yawed.quaternion);
  assertNear(yawedForward[0], 1);
  assertNear(yawedForward[2], 0);

  // Positive Unity pitch looks down.
  const pitched = unityPoseToRightHanded({ position: [0, 0, 0], rotationDeg: [30, 0, 0] });
  const pitchedForward = forward(pitched.quaternion);
  assertNear(pitchedForward[1], -0.5);
  // Unity +z forward is right-handed -z.
  assertNear(pitchedForward[2], -Math.cos(Math.PI / 6));
});

Deno.test("solveVrcCameraCalibration recovers yaw, scale, translation and grip offset", () => {
  const truth = { yawRad: 0.65, scale: 1.25, translation: [0.4, -0.2, 1.7] as Vec3 };
  const grip: Vec3 = [0.03, -0.05, -0.12];
  const next = random(7);
  const samples: VrcCameraCalibrationSample[] = [];
  for (let i = 0; i < 40; i++) {
    const position: Vec3 = [next() - 0.5, 1 + next() * 0.6, next() - 0.5];
    const quaternion = quatMultiply(
      axisAngle([0, 1, 0], next() * 6),
      axisAngle([1, 0, 0], (next() - 0.5) * 2),
    );
    const m = quatToMatrix(quaternion);
    const cameraTracking: Vec3 = [0, 1, 2].map((row) =>
      position[row] + m[row][0] * grip[0] + m[row][1] * grip[1] + m[row][2] * grip[2]
    ) as Vec3;
    // Invert p_track = s·R(yaw)·p_world + t.
    const local = cameraTracking.map((v, axis) => (v - truth.translation[axis]) / truth.scale);
    const c = Math.cos(-truth.yawRad);
    const s = Math.sin(-truth.yawRad);
    const world: Vec3 = [c * local[0] + s * local[2], local[1], -s * local[0] + c * local[2]];
    samples.push({ world, left: null, right: { position, quaternion } });
  }

  const fit = solveVrcCameraCalibration(samples, 0);
  if (fit == null) throw new Error("expected a calibration");
  if (fit.hand !== "right") throw new Error(`expected the right hand, got ${fit.hand}`);
  assertNear(fit.yawRad, truth.yawRad, 1e-3);
  assertNear(fit.scale, truth.scale, 1e-3);
  for (let axis = 0; axis < 3; axis++) {
    assertNear(fit.translation[axis], truth.translation[axis], 1e-3);
    assertNear(fit.gripOffset[axis], grip[axis], 1e-3);
  }
  if (fit.rmsErrorMeters > 1e-3) throw new Error(`rms ${fit.rmsErrorMeters}`);

  const mapped = applyVrcCameraCalibration(fit, {
    position: samples[0].world,
    quaternion: [0, 0, 0, 1],
  });
  const controller = samples[0].right!;
  const m = quatToMatrix(controller.quaternion);
  for (let axis = 0; axis < 3; axis++) {
    const expected = controller.position[axis] + m[axis][0] * grip[0] + m[axis][1] * grip[1] +
      m[axis][2] * grip[2];
    assertNear(mapped.position[axis], expected, 1e-3);
  }
});

Deno.test("solveVrcCameraCalibration drops a sample taken after the camera was let go", () => {
  const grip: Vec3 = [0.02, -0.03, -0.1];
  const samples: VrcCameraCalibrationSample[] = [];
  for (let i = 0; i < 30; i++) {
    const position: Vec3 = [0.1 * Math.sin(i * 0.3), 1.2, 0.1 * Math.cos(i * 0.2)];
    const quaternion = quatMultiply(
      axisAngle([0, 1, 0], i * 0.2),
      axisAngle([1, 0, 0], Math.sin(i)),
    );
    const m = quatToMatrix(quaternion);
    const world: Vec3 = [0, 1, 2].map((row) =>
      position[row] + m[row][0] * grip[0] + m[row][1] * grip[1] + m[row][2] * grip[2]
    ) as Vec3;
    samples.push({ world, left: null, right: { position, quaternion } });
  }
  const last = samples.at(-1)!;
  samples.push({ world: [1.5, 1.6, 2], left: null, right: last.right });

  const fit = solveVrcCameraCalibration(samples, 0);
  if (fit == null) throw new Error("expected a calibration");
  assertNear(fit.yawRad, 0, 1e-3);
  assertNear(fit.scale, 1, 1e-3);
  if (fit.samples !== 30) throw new Error(`expected the outlier dropped, kept ${fit.samples}`);
});

Deno.test("solveVrcCameraCalibration refuses a camera that was never turned", () => {
  const samples: VrcCameraCalibrationSample[] = [];
  for (let i = 0; i < 20; i++) {
    const position: Vec3 = [i * 0.03, 1, 0];
    samples.push({
      world: [...position],
      left: null,
      right: { position, quaternion: [0, 0, 0, 1] },
    });
  }
  if (solveVrcCameraCalibration(samples, 0) != null) {
    throw new Error("a translation-only capture cannot separate grip offset from translation");
  }
});

/** A camera held by `holder` at `grip`, with the other hand moving independently; identity world. */
function heldCameraSamples(
  count: number,
  holder: "left" | "right",
  seed = 11,
): VrcCameraCalibrationSample[] {
  const grip: Vec3 = [0.03, -0.05, -0.12];
  const next = random(seed);
  const pose = (): TrackedPose => ({
    position: [next() - 0.5, 1 + next() * 0.6, next() - 0.5],
    quaternion: quatMultiply(
      axisAngle([0, 1, 0], next() * 6),
      axisAngle([1, 0, 0], (next() - 0.5) * 2),
    ),
  });
  const samples: VrcCameraCalibrationSample[] = [];
  for (let i = 0; i < count; i++) {
    const held = pose();
    const other = pose();
    const m = quatToMatrix(held.quaternion);
    const world = [0, 1, 2].map((row) =>
      held.position[row] + m[row][0] * grip[0] + m[row][1] * grip[1] + m[row][2] * grip[2]
    ) as Vec3;
    samples.push(
      holder === "right"
        ? { world, left: other, right: held }
        : { world, left: held, right: other },
    );
  }
  return samples;
}

Deno.test("solveVrcCameraCalibration picks the hand whose movement matches the camera", () => {
  for (const holder of ["left", "right"] as const) {
    const fit = solveVrcCameraCalibration(heldCameraSamples(40, holder), 0);
    if (fit == null) throw new Error("expected a calibration");
    if (fit.hand !== holder) throw new Error(`expected ${holder}, got ${fit.hand}`);
    if (fit.otherHandRmsErrorMeters != null && fit.otherHandRmsErrorMeters < 0.05) {
      throw new Error(`the free hand should fit badly, got ${fit.otherHandRmsErrorMeters} m`);
    }
  }
});

Deno.test("VrcCameraCalibrator keeps its sample cap by dropping the most redundant sample", () => {
  const calibrator = new VrcCameraCalibrator({
    maxSamples: 10,
    maxSpeedMetersPerSecond: 0.2,
    maxAngularDegPerSecond: 45,
    minSampleDistanceMeters: 0.02,
    minSampleAngleDeg: 4,
  });
  const still = (at: number, x: number) => {
    const controller: TrackedPose = { position: [x, 1, 0], quaternion: [0, 0, 0, 1] };
    const world: TrackedPose = { position: [x, 1, 0], quaternion: [0, 0, 0, 1] };
    calibrator.add(at, world, null, controller); // after a jump: not still
    return calibrator.add(at + 100, world, null, controller); // held: taken
  };
  // Nine spread out, then one squeezed next to the first and three more spread out.
  for (let i = 0; i < 9; i++) still(i * 1000, i * 0.5);
  still(9000, 0.03);
  for (let i = 0; i < 3; i++) still(10_000 + i * 1000, 10 + i);
  if (calibrator.samples.length !== 10) {
    throw new Error(`cap not kept: ${calibrator.samples.length}`);
  }
  const xs = calibrator.samples.map((sample) => sample.world[0]);
  for (const x of [10, 11, 12]) {
    if (!xs.includes(x)) throw new Error(`new sample ${x} missing: ${xs}`);
  }
  if (xs.includes(0) && xs.includes(0.03)) throw new Error(`kept both near-duplicates: ${xs}`);
});

/** Feeds `samples` to a tracker as OSC poses, each held still for 100 ms so it is taken. */
function feed(tracker: VrcCameraTracker, samples: VrcCameraCalibrationSample[], start = 0): number {
  let at = start;
  for (const sample of samples) {
    // Right-handed world → the Unity pose VRChat would send.
    const pose = {
      position: [sample.world[0], sample.world[1], -sample.world[2]] as Vec3,
      rotationDeg: [0, 0, 0] as Vec3,
    };
    tracker.onWorldPose(pose, sample, at);
    tracker.onWorldPose(pose, sample, at + 100);
    at += 1000;
  }
  return at;
}

Deno.test("VrcCameraTracker live calibration solves as samples grow and keeps the fit at the end", async () => {
  const fits: (VrcCameraCalibration | null)[] = [];
  const tracker = new VrcCameraTracker(undefined, (fit) => fits.push(fit));
  tracker.beginLiveCalibration();
  // One sample at a time with a turn of the event loop between, as OSC poses arrive.
  let at = 0;
  for (const sample of heldCameraSamples(40, "right")) {
    at = feed(tracker, [sample], at);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const status = tracker.status();
  if (!status.live || status.liveFit == null) throw new Error("expected a live fit");
  if (fits.length < 2) throw new Error(`expected repeated solves, got ${fits.length}`);
  if (status.liveFit.hand !== "right") throw new Error(`wrong hand ${status.liveFit.hand}`);
  const kept = tracker.endLiveCalibration();
  if (kept == null || tracker.status().live) {
    throw new Error("expected the live fit kept and live off");
  }
  if (tracker.status().calibration !== kept) throw new Error("calibration not adopted");
});

Deno.test("VrcCameraTracker ignores a live solve that finishes after the switch went off", async () => {
  let release: (fit: VrcCameraCalibration | null) => void = () => {};
  const tracker = new VrcCameraTracker(() => new Promise((resolve) => (release = resolve)));
  tracker.beginLiveCalibration();
  feed(tracker, heldCameraSamples(30, "right"));
  tracker.endLiveCalibration();
  release(solveVrcCameraCalibration(heldCameraSamples(30, "right"), 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (tracker.status().calibration != null || tracker.status().liveFit != null) {
    throw new Error("a stale solve was adopted");
  }
  if (tracker.status().lastError == null) throw new Error("expected a no-fit error");
});

Deno.test("createVrcCameraWorkerSolver solves in a worker", async () => {
  const solver = createVrcCameraWorkerSolver();
  try {
    const fit = await solver(heldCameraSamples(30, "left"));
    if (fit == null || fit.hand !== "left") {
      throw new Error(`unexpected fit ${JSON.stringify(fit)}`);
    }
  } finally {
    solver.dispose();
  }
});

Deno.test("live solver keeps updating after the sample cap", async () => {
  let solves = 0;
  const tracker = new VrcCameraTracker(async () => {
    solves++;
    return null;
  });
  tracker.beginLiveCalibration();
  let at = 0;
  for (const sample of heldCameraSamples(306, "left")) {
    at = feed(tracker, [sample], at);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  if (tracker.status().samples !== 300) throw new Error("expected sample cap");
  if (solves < 280) throw new Error(`solver stopped at the cap: ${solves} solves`);
});

Deno.test("a rejected obsolete solve cannot overwrite the next calibration's status", async () => {
  let reject: (error: Error) => void = () => {};
  const tracker = new VrcCameraTracker(() =>
    new Promise((_resolve, fail) => {
      reject = fail;
    })
  );
  tracker.beginLiveCalibration();
  feed(tracker, heldCameraSamples(30, "right"));
  tracker.endLiveCalibration();
  tracker.beginLiveCalibration();
  reject(new Error("old failure"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (tracker.status().lastError != null) throw new Error("obsolete failure leaked");
});

async function feedLive(
  tracker: VrcCameraTracker,
  samples: VrcCameraCalibrationSample[],
  start = 0,
): Promise<number> {
  let at = start;
  for (const sample of samples) {
    at = feed(tracker, [sample], at);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return at;
}

Deno.test("live calibration retains its best fit through released-hand motion and resumes", async () => {
  const tracker = new VrcCameraTracker();
  const clean = heldCameraSamples(40, "right");
  tracker.beginLiveCalibration();
  let at = await feedLive(tracker, clean);
  const before = tracker.status();
  if (!before.liveFit) throw new Error("missing clean fit");
  const expected = tracker.currentViewPose()!.position;
  const bad = heldCameraSamples(45, "left", 99).map((s) => ({ ...s, world: clean.at(-1)!.world }));
  at = await feedLive(tracker, bad, at);
  const paused = tracker.status();
  if (!paused.samplingPaused) throw new Error("release was not detected");
  if (paused.liveFit!.rmsErrorMeters > before.liveFit.rmsErrorMeters) {
    throw new Error("accuracy regressed");
  }
  if (paused.acceptedSamples !== before.acceptedSamples) {
    throw new Error("released-hand samples poisoned capture");
  }
  if (Math.hypot(...tracker.currentViewPose()!.position.map((x, i) => x - expected[i])) > 0.001) {
    throw new Error("ball moved off the parked camera");
  }
  await feedLive(tracker, heldCameraSamples(30, "right", 77), at);
  const resumed = tracker.status();
  if (resumed.samplingPaused || resumed.acceptedSamples <= paused.acceptedSamples) {
    throw new Error("did not resume");
  }
  if (resumed.liveFit!.rmsErrorMeters > before.liveFit.rmsErrorMeters) {
    throw new Error("best accuracy lost");
  }
});

Deno.test("live calibration switches holding hands and grip offsets without resetting progress", async () => {
  const tracker = new VrcCameraTracker();
  tracker.beginLiveCalibration();
  let at = await feedLive(tracker, heldCameraSamples(40, "right"));
  const before = tracker.status();
  if (!before.liveFit) throw new Error("missing clean fit");
  const left = heldCameraSamples(55, "left", 87);
  // Re-grab with an extra 12 cm offset in the new controller's local X.
  for (const s of left) {
    const m = quatToMatrix(s.left!.quaternion);
    s.world = s.world.map((x, i) => x + m[i][0] * 0.12) as Vec3;
  }
  const errors: number[] = [];
  for (const sample of left) {
    at = await feedLive(tracker, [sample], at);
    errors.push(tracker.status().liveFit!.rmsErrorMeters);
  }
  const after = tracker.status();
  if (after.liveFit?.hand !== "left") throw new Error("did not detect the new hand");
  if (after.samplingPaused || after.acceptedSamples <= before.acceptedSamples) {
    throw new Error("new hand did not resume capture");
  }
  if (after.acceptedSamples < before.acceptedSamples) throw new Error("progress reset");
  for (let i = 1; i < errors.length; i++) {
    if (errors[i] > errors[i - 1]) throw new Error("error increased");
  }
  if (after.liveFit.rmsErrorMeters > before.liveFit.rmsErrorMeters) {
    throw new Error("best error regressed");
  }
  at = await feedLive(tracker, heldCameraSamples(45, "right", 21), at);
  const switchedBack = tracker.status();
  if (switchedBack.liveFit?.hand !== "right" || switchedBack.samplingPaused) {
    throw new Error("switching back stuck");
  }
  if (switchedBack.acceptedSamples <= after.acceptedSamples) {
    throw new Error("second handoff stopped progress");
  }
  if (switchedBack.liveFit.rmsErrorMeters > after.liveFit.rmsErrorMeters) {
    throw new Error("second handoff lost best error");
  }
  tracker.endLiveCalibration();
  if (!tracker.status().calibration) throw new Error("fit not kept on stop");
});

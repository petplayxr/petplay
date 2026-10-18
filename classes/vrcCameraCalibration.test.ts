import {
  applyVrcCameraCalibration,
  type Quat,
  quatMultiply,
  quatToMatrix,
  solveVrcCameraCalibration,
  unityPoseToRightHanded,
  type Vec3,
  type VrcCameraCalibrationSample,
} from "./vrcCameraCalibration.ts";

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

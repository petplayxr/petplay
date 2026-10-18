/**
 * Places VRChat's user camera in PetPlay's tracking space.
 *
 * `/usercamera/Pose` reports the camera in VRChat **world** space (Unity, left-handed,
 * Euler degrees). PetPlay's scene lives in OpenVR **tracking** space. The two differ by a
 * yaw, a translation and — when the avatar is scaled — a uniform scale, and that mapping
 * changes whenever the player locomotes (joystick, snap turn, teleport).
 *
 * Grab-to-calibrate recovers it: while the camera is held, its world position is the
 * holding controller's tracking pose plus a fixed grip offset. For a fixed yaw the
 * relation `s·R·w + t − C·o = c` is linear in scale `s`, translation `t` and grip offset
 * `o`, so the solve is a yaw search over small least-squares fits. Only positions are
 * used: VRChat's camera smoothing and auto-level alter its reported rotation, not where
 * it is. Its rotation is mapped afterwards through the fitted yaw.
 */
export type Vec3 = [number, number, number];
/** XYZW. */
export type Quat = [number, number, number, number];

export type VrcWorldCameraPose = {
  /** Unity world position (left-handed). */
  position: Vec3;
  /** Unity Euler degrees (applied Z, then X, then Y). */
  rotationDeg: Vec3;
};

export type TrackedPose = { position: Vec3; quaternion: Quat };

export type VrcCameraCalibrationSample = {
  /** Camera position in right-handed world space (see {@link unityPoseToRightHanded}). */
  world: Vec3;
  left: TrackedPose | null;
  right: TrackedPose | null;
};

export type VrcCameraCalibration = {
  /** Right-handed world → tracking: `p_track = scale·R(yawRad)·p_world + translation`. */
  yawRad: number;
  scale: number;
  translation: Vec3;
  /** The hand that held the camera, and the camera's offset in that controller's frame. */
  hand: "left" | "right";
  gripOffset: Vec3;
  rmsErrorMeters: number;
  maxErrorMeters: number;
  samples: number;
  solvedAt: number;
};

/** Fewer samples than this cannot separate grip offset, translation and scale reliably. */
export const MIN_CALIBRATION_SAMPLES = 12;

/** Unity left-handed (z forward) → right-handed (z back), the convention three.js and OpenVR use. */
export function unityPoseToRightHanded(pose: VrcWorldCameraPose): TrackedPose {
  const [px, py, pz] = pose.position;
  const deg = Math.PI / 180;
  // Unity applies Z, then X, then Y (extrinsic): q = qY·qX·qZ.
  const qx = axisAngle([1, 0, 0], pose.rotationDeg[0] * deg);
  const qy = axisAngle([0, 1, 0], pose.rotationDeg[1] * deg);
  const qz = axisAngle([0, 0, 1], pose.rotationDeg[2] * deg);
  const q = quatMultiply(quatMultiply(qy, qx), qz);
  // Mirroring z negates the x and y quaternion components.
  return { position: [px, py, -pz], quaternion: [-q[0], -q[1], q[2], q[3]] };
}

/** World camera pose → tracking-space camera pose under `calibration`. */
export function applyVrcCameraCalibration(
  calibration: VrcCameraCalibration,
  worldPose: TrackedPose,
): TrackedPose {
  const rotated = rotateYaw(worldPose.position, calibration.yawRad);
  const yawQuat = axisAngle([0, 1, 0], calibration.yawRad);
  return {
    position: [
      calibration.scale * rotated[0] + calibration.translation[0],
      calibration.scale * rotated[1] + calibration.translation[1],
      calibration.scale * rotated[2] + calibration.translation[2],
    ],
    quaternion: quatMultiply(yawQuat, worldPose.quaternion),
  };
}

/**
 * Collects held-camera samples. A sample is taken only while the controllers are nearly
 * still — OSC delivery lags the controller pose by tens of milliseconds, so a moving
 * hand would pair a stale camera with a fresh controller — and only once the camera has
 * moved or turned enough since the last sample, so a resting hand does not dominate.
 */
export class VrcCameraCalibrator {
  readonly samples: VrcCameraCalibrationSample[] = [];
  private previous: { at: number; left: TrackedPose | null; right: TrackedPose | null } | null =
    null;

  constructor(
    private readonly options = {
      maxSamples: 400,
      maxSpeedMetersPerSecond: 0.2,
      maxAngularDegPerSecond: 45,
      minSampleDistanceMeters: 0.02,
      minSampleAngleDeg: 4,
    },
  ) {}

  /** Returns true when the sample was kept. */
  add(
    at: number,
    world: TrackedPose,
    left: TrackedPose | null,
    right: TrackedPose | null,
  ): boolean {
    const previous = this.previous;
    this.previous = { at, left: clonePose(left), right: clonePose(right) };
    if (previous == null || this.samples.length >= this.options.maxSamples) return false;
    const dt = (at - previous.at) / 1000;
    if (dt <= 0 || dt > 0.25) return false;
    if (!isStill(previous.left, left, dt, this.options)) return false;
    if (!isStill(previous.right, right, dt, this.options)) return false;
    const last = this.samples.at(-1);
    if (last) {
      const moved = distance(last.world, world.position);
      const turned = Math.max(turnedDeg(last.left, left), turnedDeg(last.right, right));
      if (moved < this.options.minSampleDistanceMeters && turned < this.options.minSampleAngleDeg) {
        return false;
      }
    }
    this.samples.push({
      world: [...world.position],
      left: clonePose(left),
      right: clonePose(right),
    });
    return true;
  }

  solve(now = Date.now()): VrcCameraCalibration | null {
    return solveVrcCameraCalibration(this.samples, now);
  }
}

/** Best fit over both hands; null when neither hand has a well-conditioned fit. */
export function solveVrcCameraCalibration(
  samples: readonly VrcCameraCalibrationSample[],
  now = Date.now(),
): VrcCameraCalibration | null {
  let best: VrcCameraCalibration | null = null;
  for (const hand of ["left", "right"] as const) {
    const handSamples = samples.flatMap((sample) => {
      const pose = sample[hand];
      return pose ? [{ world: sample.world, controller: pose }] : [];
    });
    if (handSamples.length < MIN_CALIBRATION_SAMPLES) continue;
    const solved = solveForHand(handSamples);
    if (solved == null) continue;
    const { errors, ...fit } = solved;
    if (best == null || fit.rmsErrorMeters < best.rmsErrorMeters) {
      best = { ...fit, hand, samples: errors.length, solvedAt: now };
    }
  }
  return best;
}

type HandSample = { world: Vec3; controller: TrackedPose };
type HandFit = Omit<VrcCameraCalibration, "hand" | "samples" | "solvedAt">;

/**
 * A camera let go or grabbed mid-capture leaves samples no rigid grip explains, and a
 * plain least-squares fit absorbs them by shrinking the scale. So: fit random subsets,
 * keep the fit most samples agree with (RANSAC), refit on its inliers, then drop any
 * remaining sample far past the median error.
 */
const RANSAC_SUBSET = 8;
const RANSAC_ITERATIONS = 48;
const INLIER_METERS = 0.03;
const OUTLIER_MEDIAN_FACTOR = 3;
const OUTLIER_MAX_FRACTION = 0.25;

function solveForHand(samples: HandSample[]): (HandFit & { errors: number[] }) | null {
  let kept = ransacInliers(samples) ?? samples;
  let fit = solveForHandOnce(kept);
  const maxDropped = Math.floor(samples.length * OUTLIER_MAX_FRACTION);
  while (fit != null && samples.length - kept.length < maxDropped) {
    const errors = fit.errors;
    const sorted = [...errors].sort((a, b) => a - b);
    const limit = Math.max(INLIER_METERS, OUTLIER_MEDIAN_FACTOR * sorted[sorted.length >> 1]);
    let worst = 0;
    for (let i = 1; i < errors.length; i++) if (errors[i] > errors[worst]) worst = i;
    if (errors[worst] <= limit || kept.length - 1 < MIN_CALIBRATION_SAMPLES) break;
    const trimmed = kept.filter((_, index) => index !== worst);
    const refit = solveForHandOnce(trimmed);
    if (refit == null) break;
    kept = trimmed;
    fit = refit;
  }
  return fit;
}

/** The samples agreeing with the best subset fit; null when no subset fit is usable. */
function ransacInliers(samples: HandSample[]): HandSample[] | null {
  if (samples.length < RANSAC_SUBSET * 2) return null;
  // Deterministic, so a capture always solves the same way.
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  let best: HandSample[] | null = null;
  for (let iteration = 0; iteration < RANSAC_ITERATIONS; iteration++) {
    const picked = new Set<number>();
    while (picked.size < RANSAC_SUBSET) picked.add(Math.floor(next() * samples.length));
    const fit = solveForHandOnce([...picked].map((index) => samples[index]), true);
    if (fit == null || fit.scale <= 0) continue;
    const inliers = samples.filter((sample) => sampleError(fit, sample) <= INLIER_METERS);
    if (best == null || inliers.length > best.length) best = inliers;
  }
  return best != null && best.length >= MIN_CALIBRATION_SAMPLES ? best : null;
}

function sampleError(fit: HandFit, sample: HandSample): number {
  const rw = rotateYaw(sample.world, fit.yawRad);
  const C = quatToMatrix(sample.controller.quaternion);
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const predicted = fit.scale * rw[axis] + fit.translation[axis] -
      (C[axis][0] * fit.gripOffset[0] + C[axis][1] * fit.gripOffset[1] +
        C[axis][2] * fit.gripOffset[2]);
    squared += (predicted - sample.controller.position[axis]) ** 2;
  }
  return Math.sqrt(squared);
}

/**
 * Coarse-to-fine yaw search: the error is smooth in yaw, so a 5° grid finds the basin.
 * `quick` stops at 0.5°, enough to score a RANSAC subset.
 */
function solveForHandOnce(
  samples: HandSample[],
  quick = false,
): (HandFit & { errors: number[] }) | null {
  const controllerRotations = samples.map((sample) => quatToMatrix(sample.controller.quaternion));
  let bestYaw = 0;
  let bestFit: LinearFit | null = null;
  const consider = (yaw: number) => {
    const fit = fitAtYaw(samples, controllerRotations, yaw);
    if (fit && (bestFit == null || fit.sumSquaredError < bestFit.sumSquaredError)) {
      bestFit = fit;
      bestYaw = yaw;
    }
  };
  const deg = Math.PI / 180;
  for (let yaw = 0; yaw < 360; yaw += 5) consider(yaw * deg);
  for (const [span, step] of quick ? [[5, 0.5]] : [[5, 0.5], [0.5, 0.02]]) {
    const center = bestYaw;
    for (let offset = -span; offset <= span; offset += step) consider(center + offset * deg);
  }
  const fit = bestFit as LinearFit | null;
  if (fit == null || fit.scale <= 0) return null;
  let maxError = 0;
  for (const error of fit.errors) maxError = Math.max(maxError, error);
  return {
    yawRad: normalizeAngle(bestYaw),
    scale: fit.scale,
    translation: fit.translation,
    gripOffset: fit.gripOffset,
    rmsErrorMeters: Math.sqrt(fit.sumSquaredError / samples.length),
    maxErrorMeters: maxError,
    errors: fit.errors,
  };
}

type LinearFit = {
  scale: number;
  translation: Vec3;
  gripOffset: Vec3;
  sumSquaredError: number;
  errors: number[];
};

/**
 * For a fixed yaw, solves `s·R·w_i + t − C_i·o = c_i` for x = [s, tx, ty, tz, ox, oy, oz]
 * through the normal equations. Null when the samples do not constrain all seven, e.g. a
 * camera only translated, never turned, leaves the grip offset and translation degenerate.
 */
function fitAtYaw(samples: HandSample[], rotations: number[][][], yaw: number): LinearFit | null {
  const ata = Array.from({ length: 7 }, () => new Array<number>(7).fill(0));
  const atb = new Array<number>(7).fill(0);
  const rows: { a: number[]; b: number }[][] = [];
  for (let i = 0; i < samples.length; i++) {
    const rw = rotateYaw(samples[i].world, yaw);
    const c = samples[i].controller.position;
    const C = rotations[i];
    const sampleRows = [];
    for (let axis = 0; axis < 3; axis++) {
      const a = [rw[axis], 0, 0, 0, -C[axis][0], -C[axis][1], -C[axis][2]];
      a[1 + axis] = 1;
      sampleRows.push({ a, b: c[axis] });
      for (let j = 0; j < 7; j++) {
        atb[j] += a[j] * c[axis];
        for (let k = 0; k < 7; k++) ata[j][k] += a[j] * a[k];
      }
    }
    rows.push(sampleRows);
  }
  const x = solveLinear(ata, atb);
  if (x == null) return null;
  let sumSquaredError = 0;
  const errors: number[] = [];
  for (const sampleRows of rows) {
    let squared = 0;
    for (const { a, b } of sampleRows) {
      let predicted = 0;
      for (let j = 0; j < 7; j++) predicted += a[j] * x[j];
      squared += (predicted - b) ** 2;
    }
    sumSquaredError += squared;
    errors.push(Math.sqrt(squared));
  }
  return {
    scale: x[0],
    translation: [x[1], x[2], x[3]],
    gripOffset: [x[4], x[5], x[6]],
    sumSquaredError,
    errors,
  };
}

/** Gaussian elimination with partial pivoting; null for an ill-conditioned system. */
function solveLinear(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const m = matrix.map((row, index) => [...row, vector[index]]);
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(m[i][i]));
  const epsilon = Math.max(scale, 1) * 1e-9;
  for (let pivot = 0; pivot < n; pivot++) {
    let bestRow = pivot;
    for (let row = pivot + 1; row < n; row++) {
      if (Math.abs(m[row][pivot]) > Math.abs(m[bestRow][pivot])) bestRow = row;
    }
    if (Math.abs(m[bestRow][pivot]) < epsilon) return null;
    [m[pivot], m[bestRow]] = [m[bestRow], m[pivot]];
    for (let row = 0; row < n; row++) {
      if (row === pivot) continue;
      const factor = m[row][pivot] / m[pivot][pivot];
      for (let col = pivot; col <= n; col++) m[row][col] -= factor * m[pivot][col];
    }
  }
  return m.map((row, index) => row[n] / row[index]);
}

function isStill(
  previous: TrackedPose | null,
  current: TrackedPose | null,
  dt: number,
  options: { maxSpeedMetersPerSecond: number; maxAngularDegPerSecond: number },
): boolean {
  if (previous == null || current == null) return true;
  return distance(previous.position, current.position) / dt <= options.maxSpeedMetersPerSecond &&
    quatAngleDeg(previous.quaternion, current.quaternion) / dt <= options.maxAngularDegPerSecond;
}

function turnedDeg(previous: TrackedPose | null, current: TrackedPose | null): number {
  return previous && current ? quatAngleDeg(previous.quaternion, current.quaternion) : 0;
}

function clonePose(pose: TrackedPose | null): TrackedPose | null {
  return pose ? { position: [...pose.position], quaternion: [...pose.quaternion] } : null;
}

function rotateYaw(v: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatToMatrix(q: Quat): number[][] {
  const [x, y, z, w] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function quatAngleDeg(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** What a `camera: "vrc"` view receives with each frame. */
export type VrcCameraViewPose = {
  position: Vec3;
  quaternion: Quat;
  /** VRChat's `/usercamera/Zoom`, taken as the vertical FOV; null until VRChat reports it. */
  fovYDeg: number | null;
  /** Milliseconds since VRChat last reported the camera pose. */
  ageMs: number;
};

export type VrcCameraTrackerStatus = {
  calibrating: boolean;
  calibrationRemainingMs: number;
  samples: number;
  calibration: VrcCameraCalibration | null;
  lastError: string | null;
  hasWorldPose: boolean;
  fovYDeg: number | null;
};

/**
 * Scene-side state for the VRC camera view: the latest world pose from OSC, the active
 * calibration and a running calibration capture. Owned by the `webxr` actor because it
 * holds the controller poses the capture pairs with.
 */
export class VrcCameraTracker {
  private calibrator: VrcCameraCalibrator | null = null;
  private calibrationEndsAt = 0;
  private calibration: VrcCameraCalibration | null = null;
  private worldPose: TrackedPose | null = null;
  private worldPoseAt = 0;
  private fovYDeg: number | null = null;
  private lastError: string | null = null;

  startCalibration(durationMs: number, now = Date.now()): void {
    this.calibrator = new VrcCameraCalibrator();
    this.calibrationEndsAt = now + durationMs;
    this.lastError = null;
  }

  clearCalibration(): void {
    this.calibrator = null;
    this.calibration = null;
  }

  setFovYDeg(value: number): void {
    if (Number.isFinite(value) && value > 1 && value < 179) this.fovYDeg = value;
  }

  /**
   * One OSC camera pose with the controllers as they are now. Returns the finished
   * calibration result when this sample ended a capture (null calibration = it failed).
   */
  onWorldPose(
    pose: VrcWorldCameraPose,
    controllers: { left: TrackedPose | null; right: TrackedPose | null },
    now = Date.now(),
  ): { finished: true; calibration: VrcCameraCalibration | null } | null {
    this.worldPose = unityPoseToRightHanded(pose);
    this.worldPoseAt = now;
    const calibrator = this.calibrator;
    if (calibrator == null) return null;
    calibrator.add(now, this.worldPose, controllers.left, controllers.right);
    if (now < this.calibrationEndsAt) return null;
    return { finished: true, calibration: this.finishCalibration(now) };
  }

  /** Solves with the samples so far; also called by an early stop. */
  finishCalibration(now = Date.now()): VrcCameraCalibration | null {
    const calibrator = this.calibrator;
    if (calibrator == null) return this.calibration;
    this.calibrator = null;
    const result = calibrator.solve(now);
    if (result == null) {
      this.lastError = `calibration failed with ${calibrator.samples.length} samples: ` +
        "hold the VRChat camera and slowly turn it through several angles";
      return null;
    }
    this.calibration = result;
    return result;
  }

  currentViewPose(now = Date.now()): VrcCameraViewPose | null {
    if (this.calibration == null || this.worldPose == null) return null;
    const pose = applyVrcCameraCalibration(this.calibration, this.worldPose);
    return { ...pose, fovYDeg: this.fovYDeg, ageMs: now - this.worldPoseAt };
  }

  status(now = Date.now()): VrcCameraTrackerStatus {
    return {
      calibrating: this.calibrator != null,
      calibrationRemainingMs: this.calibrator ? Math.max(0, this.calibrationEndsAt - now) : 0,
      samples: this.calibrator?.samples.length ?? 0,
      calibration: this.calibration,
      lastError: this.lastError,
      hasWorldPose: this.worldPose != null,
      fovYDeg: this.fovYDeg,
    };
  }
}

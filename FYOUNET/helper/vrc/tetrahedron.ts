import numeric from 'npm:numeric';

type Point3D = [number, number, number];

type HMDMatrix = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export class Tetrahedron3D {
  points: Point3D[];
  previousSolution: { tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number, rotation: HMDMatrix } | null;
  previousTimestamp: number | null;

  constructor(points: Point3D[]) {
    this.points = points;
    this.previousSolution = null; // Initialize with no previous solution
    this.previousTimestamp = null; // Initialize with no previous timestamp
  }

  findSecondTetrahedron(distances: number[]): { points: Point3D[], translation: Point3D, rotation: HMDMatrix } {
    const [p1, p2, p3, p4] = this.points;
    const [d1, d2, d3, d4] = distances;
    const timestamp = performance.now(); // Use high-precision timer if available

    // Define the system of equations
    const equations = [
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(
          ((p1[0] * Math.cos(beta) * Math.cos(gamma) - p1[1] * Math.cos(beta) * Math.sin(gamma) + p1[2] * Math.sin(beta)) + tx) ** 2 +
          ((p1[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p1[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) - 
            p1[2] * Math.sin(alpha) * Math.cos(beta)) + ty) ** 2 +
          ((p1[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p1[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) + 
            p1[2] * Math.cos(alpha) * Math.cos(beta)) + tz) ** 2
        ) - d1,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(
          ((p2[0] * Math.cos(beta) * Math.cos(gamma) - p2[1] * Math.cos(beta) * Math.sin(gamma) + p2[2] * Math.sin(beta)) + tx) ** 2 +
          ((p2[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p2[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) - 
            p2[2] * Math.sin(alpha) * Math.cos(beta)) + ty) ** 2 +
          ((p2[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p2[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) + 
            p2[2] * Math.cos(alpha) * Math.cos(beta)) + tz) ** 2
        ) - d2,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(
          ((p3[0] * Math.cos(beta) * Math.cos(gamma) - p3[1] * Math.cos(beta) * Math.sin(gamma) + p3[2] * Math.sin(beta)) + tx) ** 2 +
          ((p3[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p3[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) - 
            p3[2] * Math.sin(alpha) * Math.cos(beta)) + ty) ** 2 +
          ((p3[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p3[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) + 
            p3[2] * Math.cos(alpha) * Math.cos(beta)) + tz) ** 2
        ) - d3,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(
          ((p4[0] * Math.cos(beta) * Math.cos(gamma) - p4[1] * Math.cos(beta) * Math.sin(gamma) + p4[2] * Math.sin(beta)) + tx) ** 2 +
          ((p4[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p4[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) - 
            p4[2] * Math.sin(alpha) * Math.cos(beta)) + ty) ** 2 +
          ((p4[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) + 
            p4[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) + 
            p4[2] * Math.cos(alpha) * Math.cos(beta)) + tz) ** 2
        ) - d4,
    ];

    // Define the objective function
    const objectiveFunction = (params: number[]) => {
      const [tx, ty, tz, alpha, beta, gamma] = params;
      return equations.reduce((sum, eq) => sum + Math.abs(eq(tx, ty, tz, alpha, beta, gamma)), 0);
    };

    // Initial guess

    const positionSmoothingPerSecond = 12;  // Adjust units/second
    const rotationSmoothingPerSecond = 12; // Adjust degrees/second (approx.)

    let initialGuess: number[];
    const initialGuessRaw = [0, 0, 0, 0, 0, 0]; // Default initial guess
    const maxBiasPerSecond = 10.0; // Maximum bias strength
    const biasFalloffDistance = 0.1; // Distance at which bias starts to decrease


    if (this.previousSolution && this.previousTimestamp) {
      const deltaTime = (timestamp - this.previousTimestamp) / 1000; 
      
      

      const result = numeric.uncmin(objectiveFunction, initialGuessRaw);
      const [rawTx, rawTy, rawTz, rawAlpha, rawBeta, rawGamma] = result.solution; 
      const distanceToTarget = Math.sqrt(rawTx*rawTx + rawTy*rawTy + rawTz*rawTz);
      const dynamicPositionBiasPerSecond = distanceToTarget > biasFalloffDistance 
      ? maxBiasPerSecond 
      : maxBiasPerSecond * (distanceToTarget / biasFalloffDistance); 

      const Rz = [
        [Math.cos(rawGamma), -Math.sin(rawGamma), 0],
        [Math.sin(rawGamma), Math.cos(rawGamma), 0],
        [0, 0, 1]
      ];
  
      const Ry = [
        [Math.cos(rawBeta), 0, Math.sin(rawBeta)],
        [0, 1, 0],
        [-Math.sin(rawBeta), 0, Math.cos(rawBeta)]
      ];
  
      const Rx = [
        [1, 0, 0],
        [0, Math.cos(rawAlpha), -Math.sin(rawAlpha)],
        [0, Math.sin(rawAlpha), Math.cos(rawAlpha)]
      ];
      const R = numeric.dot(numeric.dot(Rz, Ry), Rx);
      const rotationMatrix: HMDMatrix = [
        R[0][0], R[0][1], R[0][2], rawTx,
        R[1][0], R[1][1], R[1][2], rawTy,
        R[2][0], R[2][1], R[2][2], rawTz
      ];
      
      const positionSmoothingFactor = Math.min(1, deltaTime * positionSmoothingPerSecond);
      const rotationAngleDifference = this.getAngleBetweenQuaternions(
        this.rotationMatrixToQuaternion(this.previousSolution.rotation),
        this.rotationMatrixToQuaternion(rotationMatrix)
      );
      const rotationSmoothingFactor = Math.min(1, (deltaTime * rotationSmoothingPerSecond) / rotationAngleDifference); 
      
      const biasWeight = Math.min(1, deltaTime * dynamicPositionBiasPerSecond); // 0.0 - 1.0
      
      // Use the previous frame's solution
      const positionDriftRate = 0.5;
      const driftOffset = positionDriftRate * deltaTime; 
      const driftedTx = this.applyDrift(this.previousSolution.tx, driftOffset);
      const driftedTy = this.applyDrift(this.previousSolution.ty, driftOffset);
      const driftedTz = this.applyDrift(this.previousSolution.tz, driftOffset);
      const driftedAlpha = this.applyDrift(this.previousSolution.alpha, driftOffset);
      const driftedBeta = this.applyDrift(this.previousSolution.beta, driftOffset);
      const driftedGamma = this.applyDrift(this.previousSolution.gamma, driftOffset);

      initialGuess = [
        this.lerp(this.previousSolution.tx, initialGuessRaw[0], biasWeight), 
        this.lerp(this.previousSolution.ty, initialGuessRaw[1], biasWeight),
        this.lerp(this.previousSolution.tz, initialGuessRaw[2], biasWeight),
        this.lerp(this.previousSolution.alpha, initialGuessRaw[3], biasWeight),
        this.lerp(this.previousSolution.beta, initialGuessRaw[4], biasWeight),
        this.lerp(this.previousSolution.gamma, initialGuessRaw[5], biasWeight)
      ];

      initialGuess = [
        initialGuess[0] + (rawTx - initialGuess[0]) * positionSmoothingFactor,
        initialGuess[1] + (rawTy - initialGuess[1]) * positionSmoothingFactor,
        initialGuess[2] + (rawTz - initialGuess[2]) * positionSmoothingFactor,
        initialGuess[3] + (rawAlpha - initialGuess[3]) * rotationSmoothingFactor,
        initialGuess[4] + (rawBeta - initialGuess[4]) * rotationSmoothingFactor,
        initialGuess[5] + (rawGamma - initialGuess[5]) * rotationSmoothingFactor
      ];
  
      /* initialGuess = [
        driftedTx + (rawTx - driftedTx) * positionSmoothingFactor, 
        driftedTy + (rawTy - driftedTy) * positionSmoothingFactor,
        driftedTz + (rawTz - driftedTz) * positionSmoothingFactor,

        driftedAlpha + (rawAlpha - driftedAlpha) * rotationSmoothingFactor,
        driftedBeta + (rawBeta - driftedBeta) * rotationSmoothingFactor,
        driftedGamma + (rawGamma - driftedGamma) * rotationSmoothingFactor
      ]; */
      const prevQuat = this.rotationMatrixToQuaternion(this.previousSolution.rotation); 
      const currentQuat = this.rotationMatrixToQuaternion(rotationMatrix);
      const smoothedQuat = this.slerp(prevQuat, currentQuat, rotationSmoothingFactor);
      const smoothedRotation = this.quaternionToRotationMatrix(smoothedQuat); 
      initialGuess = initialGuess.concat(this.extractEulerAngles(smoothedRotation)); 


    } else {
      // Start with a default guess if no previous solution
      initialGuess = [0, 0, 0, 0, 0, 0]; 
    }

    

    // Perform the optimization using Nelder-Mead
    const result = numeric.uncmin(objectiveFunction, initialGuess);
    this.previousTimestamp = timestamp;

    const [tx, ty, tz, alpha, beta, gamma] = result.solution;

    

    // Compute the rotation matrix
    const Rz = [
      [Math.cos(gamma), -Math.sin(gamma), 0],
      [Math.sin(gamma), Math.cos(gamma), 0],
      [0, 0, 1]
    ];

    const Ry = [
      [Math.cos(beta), 0, Math.sin(beta)],
      [0, 1, 0],
      [-Math.sin(beta), 0, Math.cos(beta)]
    ];

    const Rx = [
      [1, 0, 0],
      [0, Math.cos(alpha), -Math.sin(alpha)],
      [0, Math.sin(alpha), Math.cos(alpha)]
    ];

    const R = numeric.dot(numeric.dot(Rz, Ry), Rx);

    const transform = (point: Point3D): Point3D => {
      const rotated = numeric.dot(R, point);
      return [
        rotated[0] + tx,
        rotated[1] + ty,
        rotated[2] + tz
      ];
    };

    const transformedPoints = [transform(p1), transform(p2), transform(p3), transform(p4)];
    const rotationMatrix: HMDMatrix = [
      R[0][0], R[0][1], R[0][2], tx,
      R[1][0], R[1][1], R[1][2], ty,
      R[2][0], R[2][1], R[2][2], tz
    ];
    this.previousSolution = {
      tx: tx, 
      ty: ty, 
      tz: tz, 
      alpha: alpha, 
      beta: beta, 
      gamma: gamma,
      rotation: rotationMatrix
    };

    return { points: transformedPoints, translation: [tx, ty, tz], rotation: rotationMatrix };
  }

  applyDrift(value: number, driftOffset: number): number {
    return value - (Math.sign(value) * Math.min(Math.abs(value), driftOffset));
  }
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }
  rotationMatrixToQuaternion(m: HMDMatrix): number[] {
    const t = m[0] + m[5] + m[10];
    let x, y, z, w;
  
    if (t > 0) { 
      const s = 0.5 / Math.sqrt(t + 1.0);
      w = 0.25 / s;
      x = (m[9] - m[6]) * s;
      y = (m[2] - m[8]) * s;
      z = (m[4] - m[1]) * s;
    } else if ((m[0] > m[5]) && (m[0] > m[10])) { 
      const s = 2.0 * Math.sqrt(1.0 + m[0] - m[5] - m[10]);
      w = (m[9] - m[6]) / s;
      x = 0.25 * s;
      y = (m[4] + m[1]) / s;
      z = (m[2] + m[8]) / s;
    } else if (m[5] > m[10]) { 
      const s = 2.0 * Math.sqrt(1.0 + m[5] - m[0] - m[10]);
      w = (m[2] - m[8]) / s;
      x = (m[4] + m[1]) / s;
      y = 0.25 * s;
      z = (m[9] + m[6]) / s;
    } else { 
      const s = 2.0 * Math.sqrt(1.0 + m[10] - m[0] - m[5]);
      w = (m[4] - m[1]) / s;
      x = (m[2] + m[8]) / s;
      y = (m[9] + m[6]) / s;
      z = 0.25 * s;
    }
  
    return [x, y, z, w];
  }
  getAngleBetweenQuaternions(q1: number[], q2: number[]): number {
    const dotProduct = q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3];
    return this.radiansToDegrees(2 * Math.acos(Math.abs(Math.min(dotProduct, 1.0)))); // Clamp dotProduct
  }
  radiansToDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }
  quaternionToRotationMatrix(q: number[]): HMDMatrix {
    const [x, y, z, w] = q;
    const xx = x * x;
    const xy = x * y;
    const xz = x * z;
    const xw = x * w;
    const yy = y * y;
    const yz = y * z;
    const yw = y * w;
    const zz = z * z;
    const zw = z * w;

    return [
      1 - 2 * (yy + zz), 2 * (xy - zw), 2 * (xz + yw), 0,
      2 * (xy + zw), 1 - 2 * (xx + zz), 2 * (yz - xw), 0,
      2 * (xz - yw), 2 * (yz + xw), 1 - 2 * (xx + yy), 0, 
    ]; 
  }

  slerp(q1: number[], q2: number[], t: number): number[] {
    let [x1, y1, z1, w1] = q1;
    let [x2, y2, z2, w2] = q2;

    let dot = x1 * x2 + y1 * y2 + z1 * z2 + w1 * w2;

    // Handle the case where the dot product is negative
    if (dot < 0) {
      w2 = -w2;
      x2 = -x2;
      y2 = -y2;
      z2 = -z2;
      dot = -dot; 
    }

    if (dot > 0.9995) {
      // If the quaternions are very close, perform linear interpolation
      const x = x1 + t * (x2 - x1);
      const y = y1 + t * (y2 - y1);
      const z = z1 + t * (z2 - z1);
      const w = w1 + t * (w2 - w1);
      const magnitude = Math.sqrt(x * x + y * y + z * z + w * w);
      return [x / magnitude, y / magnitude, z / magnitude, w / magnitude];
    } else {
      const theta0 = Math.acos(dot); 
      const theta = theta0 * t;
      const sinTheta = Math.sin(theta);
      const sinTheta0 = Math.sin(theta0);

      const s0 = Math.cos(theta) - dot * sinTheta / sinTheta0;
      const s1 = sinTheta / sinTheta0;

      const x = s0 * x1 + s1 * x2;
      const y = s0 * y1 + s1 * y2;
      const z = s0 * z1 + s1 * z2;
      const w = s0 * w1 + s1 * w2;
      return [x, y, z, w];
    }
  }
  extractEulerAngles(m: HMDMatrix): [number, number, number] {
    let yaw, pitch, roll;

    // Assuming the angles are applied in the order ZYX (yaw, pitch, roll)
    yaw = Math.atan2(m[1], m[0]);
    pitch = Math.asin(-m[2]); 
    roll = Math.atan2(m[6], m[10]);

    // Convert to degrees (optional)
    // yaw = this.radiansToDegrees(yaw);
    // pitch = this.radiansToDegrees(pitch);
    // roll = this.radiansToDegrees(roll);

    return [yaw, pitch, roll];
  }
  
}



// Example usage:
const tetrahedron = new Tetrahedron3D([
  [0.5, 0, 0],
  [0, 0.5, 0],
  [0, 0, 0.5],
  [0, 0, 0]
]);

const distances = [1, 1, 1, 1];
const secondTetrahedron = tetrahedron.findSecondTetrahedron(distances);

console.log('Second Tetrahedron Points:', secondTetrahedron);

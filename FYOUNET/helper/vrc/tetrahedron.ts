// @deno-types="npm:@types/numeric"
import numeric from 'npm:numeric';

type Point3D = [number, number, number];

type HMDMatrix = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export class Tetrahedron3D {
  points: Point3D[];

  constructor(points: Point3D[]) {
    this.points = points;
  }

  findSecondTetrahedron(distances: number[]): { points: Point3D[], translation: Point3D, rotation: HMDMatrix } {
    const [p1, p2, p3, p4] = this.points;
    const [d1, d2, d3, d4] = distances;

    const mean = this.points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]).map(coord => coord / 4);
    const diff = this.points.map(point => [point[0] - mean[0], point[1] - mean[1], point[2] - mean[2]]);
    const S = diff.reduce((acc, d) => [
      [acc[0][0] + d[0] * d[0], acc[0][1] + d[0] * d[1], acc[0][2] + d[0] * d[2]],
      [acc[1][0] + d[1] * d[0], acc[1][1] + d[1] * d[1], acc[1][2] + d[1] * d[2]],
      [acc[2][0] + d[2] * d[0], acc[2][1] + d[2] * d[1], acc[2][2] + d[2] * d[2]]
    ], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]).map(row => row.map(val => val / 4));
    const SInv = numeric.inv(S);

    // Define the system of equations
    const equations2 = [
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(numeric.dot(numeric.dot([
          ((p1[0] * Math.cos(beta) * Math.cos(gamma) - p1[1] * Math.cos(beta) * Math.sin(gamma) + p1[2] * Math.sin(beta)) + tx) - mean[0],
          ((p1[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p1[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p1[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p1[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p1[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p1[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ], SInv), [
          ((p1[0] * Math.cos(beta) * Math.cos(gamma) - p1[1] * Math.cos(beta) * Math.sin(gamma) + p1[2] * Math.sin(beta)) + tx) - mean[0],
          ((p1[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p1[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p1[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p1[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p1[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p1[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ])) - d1,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(numeric.dot(numeric.dot([
          ((p2[0] * Math.cos(beta) * Math.cos(gamma) - p2[1] * Math.cos(beta) * Math.sin(gamma) + p2[2] * Math.sin(beta)) + tx) - mean[0],
          ((p2[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p2[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p2[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p2[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p2[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p2[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ], SInv), [
          ((p2[0] * Math.cos(beta) * Math.cos(gamma) - p2[1] * Math.cos(beta) * Math.sin(gamma) + p2[2] * Math.sin(beta)) + tx) - mean[0],
          ((p2[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p2[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p2[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p2[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p2[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p2[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ])) - d2,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(numeric.dot(numeric.dot([
          ((p3[0] * Math.cos(beta) * Math.cos(gamma) - p3[1] * Math.cos(beta) * Math.sin(gamma) + p3[2] * Math.sin(beta)) + tx) - mean[0],
          ((p3[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p3[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p3[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p3[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p3[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p3[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ], SInv), [
          ((p3[0] * Math.cos(beta) * Math.cos(gamma) - p3[1] * Math.cos(beta) * Math.sin(gamma) + p3[2] * Math.sin(beta)) + tx) - mean[0],
          ((p3[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p3[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p3[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p3[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p3[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p3[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ])) - d3,
      (tx: number, ty: number, tz: number, alpha: number, beta: number, gamma: number) =>
        Math.sqrt(numeric.dot(numeric.dot([
          ((p4[0] * Math.cos(beta) * Math.cos(gamma) - p4[1] * Math.cos(beta) * Math.sin(gamma) + p4[2] * Math.sin(beta)) + tx) - mean[0],
          ((p4[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p4[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p4[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p4[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p4[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p4[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ], SInv), [
          ((p4[0] * Math.cos(beta) * Math.cos(gamma) - p4[1] * Math.cos(beta) * Math.sin(gamma) + p4[2] * Math.sin(beta)) + tx) - mean[0],
          ((p4[0] * (Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p4[1] * (Math.cos(alpha) * Math.cos(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.sin(gamma)) -
            p4[2] * Math.sin(alpha) * Math.cos(beta)) + ty) - mean[1],
          ((p4[0] * (Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma)) +
            p4[1] * (Math.sin(alpha) * Math.cos(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.sin(gamma)) +
            p4[2] * Math.cos(alpha) * Math.cos(beta)) + tz) - mean[2]
        ])) - d4,
    ];

    const equations = [
      (tx: number, ty: number, tz: number, q: Quaternion) =>
        Math.sqrt(numeric.dot(numeric.dot([
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p1[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p1[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p1[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p1[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p1[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p1[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p1[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p1[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p1[2] + tz - mean[2]
        ], SInv), [
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p1[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p1[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p1[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p1[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p1[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p1[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p1[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p1[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p1[2] + tz - mean[2]
        ])) - d1,
      (tx: number, ty: number, tz: number, q: Quaternion) =>
        Math.sqrt(numeric.dot(numeric.dot([
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p2[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p2[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p2[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p2[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p2[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p2[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p2[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p2[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p2[2] + tz - mean[2]
        ], SInv), [
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p2[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p2[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p2[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p2[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p2[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p2[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p2[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p2[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p2[2] + tz - mean[2]
        ])) - d2,
      (tx: number, ty: number, tz: number, q: Quaternion) =>
        Math.sqrt(numeric.dot(numeric.dot([
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p3[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p3[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p3[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p3[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p3[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p3[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p3[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p3[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p3[2] + tz - mean[2]
        ], SInv), [
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p3[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p3[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p3[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p3[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p3[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p3[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p3[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p3[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p3[2] + tz - mean[2]
        ])) - d3,
      (tx: number, ty: number, tz: number, q: Quaternion) =>
        Math.sqrt(numeric.dot(numeric.dot([
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p4[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p4[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p4[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p4[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p4[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p4[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p4[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p4[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p4[2] + tz - mean[2]
        ], SInv), [
          (q[0] * q[0] + q[1] * q[1] - q[2] * q[2] - q[3] * q[3]) * p4[0] + 2 * (q[1] * q[2] - q[0] * q[3]) * p4[1] + 2 * (q[1] * q[3] + q[0] * q[2]) * p4[2] + tx - mean[0],
          2 * (q[1] * q[2] + q[0] * q[3]) * p4[0] + (q[0] * q[0] - q[1] * q[1] + q[2] * q[2] - q[3] * q[3]) * p4[1] + 2 * (q[2] * q[3] - q[0] * q[1]) * p4[2] + ty - mean[1],
          2 * (q[1] * q[3] - q[0] * q[2]) * p4[0] + 2 * (q[2] * q[3] + q[0] * q[1]) * p4[1] + (q[0] * q[0] - q[1] * q[1] - q[2] * q[2] + q[3] * q[3]) * p4[2] + tz - mean[2]
        ])) - d4,

      // ... (same for p2, p3, p4)
    ];

    let q

    // Define the objective function
    const objectiveFunction = (params: number[]) => {
      const [tx, ty, tz, q0, q1, q2, q3] = params;
      const qNorm = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
      q = [q0 / qNorm, q1 / qNorm, q2 / qNorm, q3 / qNorm]; // normalize the quaternion
      return equations.reduce((sum, eq) => sum + Math.abs(eq(tx, ty, tz, q)) ** 2, 0);
    };

    // Initial guess
    const centroid = this.points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]).map(coord => coord / 4);
    const initialGuess = [...centroid, 1, 0, 0, 0];

    // Perform the optimization using Nelder-Mead
    const result = numeric.uncmin(objectiveFunction, initialGuess, 1e-10, undefined, 10000);

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

    const R = [
      [1 - 2 * q[2] * q[2] - 2 * q[3] * q[3], 2 * q[1] * q[2] - 2 * q[0] * q[3], 2 * q[1] * q[3] + 2 * q[0] * q[2]],
      [2 * q[1] * q[2] + 2 * q[0] * q[3], 1 - 2 * q[1] * q[1] - 2 * q[3] * q[3], 2 * q[2] * q[3] - 2 * q[0] * q[1]],
      [2 * q[1] * q[3] - 2 * q[0] * q[2], 2 * q[2] * q[3] + 2 * q[0] * q[1], 1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]]
    ];

    //const R = numeric.dot(numeric.dot(Rz, Ry), Rx);

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

    return { points: transformedPoints, translation: [tx, ty, tz], rotation: rotationMatrix };
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

// @deno-types="npm:@types/numeric"
import numeric from 'npm:numeric';

type Point3D = [number, number, number];

type HMDMatrix = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];
type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

type Quaternion = [number, number, number, number];

export class Tetrahedron3D {
  points: Point3D[];

  constructor(points: Point3D[]) {
    this.points = points;
  }

  findSecondTetrahedron(distances: number[]): { points: Point3D[], translation: Point3D, rotation: HMDMatrix } {
    const [p1, p2, p3, p4] = this.points;

    const mean = this.points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]], [0, 0, 0]).map(coord => coord / 4);
    const diff = this.points.map(point => [point[0] - mean[0], point[1] - mean[1], point[2] - mean[2]]);
    const S = diff.reduce((acc, d) => [
      [acc[0][0] + d[0] * d[0], acc[0][1] + d[0] * d[1], acc[0][2] + d[0] * d[2]],
      [acc[1][0] + d[1] * d[0], acc[1][1] + d[1] * d[1], acc[1][2] + d[1] * d[2]],
      [acc[2][0] + d[2] * d[0], acc[2][1] + d[2] * d[1], acc[2][2] + d[2] * d[2]]
    ], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]).map(row => row.map(val => val / 4));
    const SInv = numeric.inv(S);

    const quaternionToRotationMatrix = (q: Quaternion): Matrix3x3 => {
      return [
        [1 - 2 * q[2] * q[2] - 2 * q[3] * q[3], 2 * q[1] * q[2] - 2 * q[0] * q[3], 2 * q[1] * q[3] + 2 * q[0] * q[2]],
        [2 * q[1] * q[2] + 2 * q[0] * q[3], 1 - 2 * q[1] * q[1] - 2 * q[3] * q[3], 2 * q[2] * q[3] - 2 * q[0] * q[1]],
        [2 * q[1] * q[3] - 2 * q[0] * q[2], 2 * q[2] * q[3] + 2 * q[0] * q[1], 1 - 2 * q[1] * q[1] - 2 * q[2] * q[2]]
      ];
    };

    const applyRotationAndTranslation = (point: Point3D, tx: number, ty: number, tz: number, R: Matrix3x3): Point3D => {
      const rotated = numeric.dot(R, point) as number[];
      return [
        rotated[0] + tx,
        rotated[1] + ty,
        rotated[2] + tz
      ];
    };

    const equations = Array.from({ length: 4 }, (_, index) => {
      const p = this.points[index];
      const d = distances[index];
      
      return (tx: number, ty: number, tz: number, q: Quaternion) => {
        const R = quaternionToRotationMatrix(q);
        const transformed = applyRotationAndTranslation(p, tx, ty, tz, R);
        return Math.sqrt(numeric.dot(numeric.dot([
          transformed[0] - mean[0],
          transformed[1] - mean[1],
          transformed[2] - mean[2]
        ], SInv), [
          transformed[0] - mean[0],
          transformed[1] - mean[1],
          transformed[2] - mean[2]
        ]) as number) - d;
      };
    });

    let q: Quaternion = [1, 0, 0, 0];

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

    const [tx, ty, tz, q0, q1, q2, q3] = result.solution;
    q = [q0, q1, q2, q3];
    const R = quaternionToRotationMatrix(q);

    const transformedPoints = this.points.map(point => applyRotationAndTranslation(point, tx, ty, tz, R));
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

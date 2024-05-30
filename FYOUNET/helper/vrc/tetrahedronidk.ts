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

    // Define the system of equations
    const equations = [
      (tx: number, ty: number, tz: number, q: number[]) =>
        Math.sqrt(
          this.applyTransformation(p1, tx, ty, tz, q).reduce((sum, val, idx) => sum + (val - this.points[0][idx]) ** 2, 0)
        ) - d1,
      (tx: number, ty: number, tz: number, q: number[]) =>
        Math.sqrt(
          this.applyTransformation(p2, tx, ty, tz, q).reduce((sum, val, idx) => sum + (val - this.points[1][idx]) ** 2, 0)
        ) - d2,
      (tx: number, ty: number, tz: number, q: number[]) =>
        Math.sqrt(
          this.applyTransformation(p3, tx, ty, tz, q).reduce((sum, val, idx) => sum + (val - this.points[2][idx]) ** 2, 0)
        ) - d3,
      (tx: number, ty: number, tz: number, q: number[]) =>
        Math.sqrt(
          this.applyTransformation(p4, tx, ty, tz, q).reduce((sum, val, idx) => sum + (val - this.points[3][idx]) ** 2, 0)
        ) - d4,
    ];

    // Define the objective function
    const objectiveFunction = (params: number[]) => {
      const [tx, ty, tz, ...q] = params;
      return equations.reduce((sum, eq) => sum + eq(tx, ty, tz, q) ** 2, 0);
    };

    // Initial guess (translation and quaternion [w, x, y, z])
    const initialGuess = [0.1, 0.1, 0.1, 1, 0.1, 0.1, 0.1];

    // Perform the optimization using Nelder-Mead
    const result = numeric.uncmin(objectiveFunction, initialGuess, 1e-8, undefined, 10000);

    const [tx, ty, tz, qw, qx, qy, qz] = result.solution;

    const rotationMatrix = this.quaternionToMatrix([qw, qx, qy, qz]);

    const transform = (point: Point3D): Point3D => {
      const rotated = this.applyMatrix(rotationMatrix, point);
      return [
        rotated[0] + tx,
        rotated[1] + ty,
        rotated[2] + tz
      ];
    };

    const transformedPoints = [transform(p1), transform(p2), transform(p3), transform(p4)];
    const hmdMatrix:HMDMatrix= [
      rotationMatrix[0][0], rotationMatrix[0][1], rotationMatrix[0][2], tx,
      rotationMatrix[1][0], rotationMatrix[1][1], rotationMatrix[1][2], ty,
      rotationMatrix[2][0], rotationMatrix[2][1], rotationMatrix[2][2], tz,
    ];

    // Debugging output
    /* console.log('Initial Guess:', initialGuess);
    console.log('Optimization Result:', result);
    console.log('Transformed Points:', transformedPoints); */

    return { points: transformedPoints, translation: [tx, ty, tz], rotation: hmdMatrix };
  }


  applyTransformation(point: Point3D, tx: number, ty: number, tz: number, q: number[]): Point3D {
    const rotationMatrix = this.quaternionToMatrix(q);
    const rotated = this.applyMatrix(rotationMatrix, point);
    return [
      rotated[0] + tx,
      rotated[1] + ty,
      rotated[2] + tz
    ];
  }

  applyMatrix(matrix: number[][], point: Point3D): Point3D {
    return numeric.dot(matrix, point);
  }

  quaternionToMatrix(q: number[]): number[][] {
    const [w, x, y, z] = q;
    return [
      [
        1 - 2 * (y * y + z * z),
        2 * (x * y - z * w),
        2 * (x * z + y * w)
      ],
      [
        2 * (x * y + z * w),
        1 - 2 * (x * x + z * z),
        2 * (y * z - x * w)
      ],
      [
        2 * (x * z - y * w),
        2 * (y * z + x * w),
        1 - 2 * (x * x + y * y)
      ]
    ];
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

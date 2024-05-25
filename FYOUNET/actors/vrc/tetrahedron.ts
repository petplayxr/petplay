import numeric from 'npm:numeric';

type Point3D = [number, number, number];

export class Tetrahedron3D {
  points: Point3D[];

  constructor(points: Point3D[]) {
    this.points = points;
  }

  findSecondTetrahedron(distances: number[]): Point3D[] {
    const [p1, p2, p3, p4] = this.points;
    const [d1, d2, d3, d4] = distances;

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
      return equations.reduce((sum, eq) => sum + eq(tx, ty, tz, alpha, beta, gamma) ** 2, 0);
    };

    // Initial guess
    const initialGuess = [0, 0, 0, 0, 0, 0];

    // Perform the optimization using Nelder-Mead
    const result = numeric.uncmin(objectiveFunction, initialGuess);

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

    return [transform(p1), transform(p2), transform(p3), transform(p4)];
  }
}

// Example usage:
const tetrahedron = new Tetrahedron3D([
  [0.1, 0, 0],
  [0, 0.1, 0],
  [0, 0, 0.1],
  [0, 0, 0]
]);

const distances = [1, 1, 1, 1];
const secondTetrahedron = tetrahedron.findSecondTetrahedron(distances);

console.log('Second Tetrahedron Points:', secondTetrahedron);

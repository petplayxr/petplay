import { bendPoint, createDisplaySurfaceGeometry, curvatureRadius } from "./curvedSurface.ts";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

Deno.test("flat curvature leaves the plane alone", () => {
  const [x, z] = bendPoint(0.3, 1, 0);
  if (x !== 0.3 || z !== 0) throw new Error(`moved: ${x},${z}`);
  const geometry = createDisplaySurfaceGeometry(1, 0.5, 0);
  if (geometry.boundingBox != null && geometry.boundingBox.max.z !== 0) {
    throw new Error("flat plane has depth");
  }
});

Deno.test("bent edges keep arc length and come toward the viewer", () => {
  const width = 1.6, curvature = 0.25;
  const r = curvatureRadius(width, curvature);
  // A quarter of a cylinder: the edges sit 45° either side of the centre.
  const [x, z] = bendPoint(width / 2, width, curvature);
  if (!near(x, r * Math.SQRT1_2) || !near(z, r * (1 - Math.SQRT1_2))) {
    throw new Error(`edge at ${x},${z}`);
  }
  const [lx, lz] = bendPoint(-width / 2, width, curvature);
  if (!near(lx, -x) || !near(lz, z)) throw new Error("not symmetric");
  // Every vertex lies on the cylinder whose axis is at z = r.
  const geometry = createDisplaySurfaceGeometry(width, 0.9, curvature);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (!near(Math.hypot(p.getX(i), p.getZ(i) - r), r, 1e-6)) throw new Error(`vertex ${i} off`);
  }
});

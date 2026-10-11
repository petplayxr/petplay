/**
 * A display's screen surface bent the way OpenVR bends a curved overlay, so the ray proxy in the
 * scene lies on the pixels the headset shows.
 *
 * OpenVR curvature `c` is the fraction of a full cylinder the overlay's width wraps:
 * `c = width / (2π r)`. The centre column stays at the overlay's transform and the edges come
 * toward the viewer (+z). Bending keeps arc length, so a plane's UVs stay correct as they are.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";

/** Cylinder radius for a curvature, or `Infinity` when flat. */
export function curvatureRadius(width: number, curvature: number): number {
  return curvature > 0 ? width / (2 * Math.PI * curvature) : Infinity;
}

/**
 * Where a point `x` metres along the flat width lands on the curve: `[x', z']` with `z'` toward
 * the viewer.
 */
export function bendPoint(x: number, width: number, curvature: number): [number, number] {
  const r = curvatureRadius(width, curvature);
  if (!Number.isFinite(r)) return [x, 0];
  const theta = x / r;
  return [r * Math.sin(theta), r * (1 - Math.cos(theta))];
}

/** A `width × height` plane, bent along x when `curvature > 0`. */
export function createDisplaySurfaceGeometry(
  width: number,
  height: number,
  curvature: number,
): THREE.BufferGeometry {
  if (!(curvature > 0)) return new THREE.PlaneGeometry(width, height);
  const segments = Math.max(8, Math.ceil(64 * Math.min(1, curvature * 4)));
  const geometry = new THREE.PlaneGeometry(width, height, segments, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const [x, z] = bendPoint(position.getX(i), width, curvature);
    position.setXYZ(i, x, position.getY(i), z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

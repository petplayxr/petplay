import * as THREE from "three";
export function trackingMatrix34(rows: readonly (readonly number[])[]): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) matrix.elements[c * 4 + r] = rows[r][c];
  return matrix;
}
/** One sampled head pose for both eyes. No scene-camera input is accepted. */
export function writeStereoRenderViews(
  head: THREE.Matrix4,
  leftEye: THREE.Matrix4,
  rightEye: THREE.Matrix4,
  output: { leftEyeViewMatrix: Float32Array; rightEyeViewMatrix: Float32Array },
) {
  output.leftEyeViewMatrix.set(head.clone().multiply(leftEye).invert().elements);
  output.rightEyeViewMatrix.set(head.clone().multiply(rightEye).invert().elements);
}

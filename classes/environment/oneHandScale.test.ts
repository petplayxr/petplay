import * as THREE from "three/webgpu";
import {
  ONE_HAND_SCALE_MAX_WIDTH,
  ONE_HAND_SCALE_MIN_WIDTH,
  ONE_HAND_SCALE_SPEED,
  ONE_HAND_SCALE_TILT_RADIANS,
  oneHandScaledWidth,
} from "./oneHandScale.ts";

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${message}: ${actual} != ${expected}`);
}

const start = new THREE.Vector3(0, 1.2, -0.3);
const level = new THREE.Quaternion();

Deno.test("pushing the hand forward widens the window and pulling it back narrows it", () => {
  const forward = start.clone().add(new THREE.Vector3(0, 0, -0.1));
  const back = start.clone().add(new THREE.Vector3(0, 0, 0.1));
  const along = 0.1 * Math.cos(ONE_HAND_SCALE_TILT_RADIANS) * ONE_HAND_SCALE_SPEED;
  assertClose(oneHandScaledWidth(1, start, forward, level), 1 + along, "forward");
  assertClose(oneHandScaledWidth(1, start, back, level), 1 - along, "back");
});

Deno.test("the gesture axis is tilted 40° and turns with the hand", () => {
  // Straight down counts too: the axis is backward tilted up, so down is partly "forward".
  const down = start.clone().add(new THREE.Vector3(0, -0.1, 0));
  const expected = 1 + 0.1 * Math.sin(ONE_HAND_SCALE_TILT_RADIANS) * ONE_HAND_SCALE_SPEED;
  assertClose(oneHandScaledWidth(1, start, down, level), expected, "down");
  // A hand turned to face +x pushes toward +x.
  const facingRight = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    -Math.PI / 2,
  );
  const right = start.clone().add(new THREE.Vector3(0.1, 0, 0));
  const along = 0.1 * Math.cos(ONE_HAND_SCALE_TILT_RADIANS) * ONE_HAND_SCALE_SPEED;
  assertClose(oneHandScaledWidth(1, start, right, facingRight), 1 + along, "turned hand");
});

Deno.test("the width stays within XSOverlay's limits", () => {
  const far = start.clone().add(new THREE.Vector3(0, 0, -10));
  const near = start.clone().add(new THREE.Vector3(0, 0, 10));
  assertClose(oneHandScaledWidth(1, start, far, level), ONE_HAND_SCALE_MAX_WIDTH, "max");
  assertClose(oneHandScaledWidth(1, start, near, level), ONE_HAND_SCALE_MIN_WIDTH, "min");
});

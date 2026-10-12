import "../../submodules/threewebxrwebgpudeno/submodules/xr/packages/pointer-events/src/pointer.ts";
import { type HandleOptions, HandleStore } from "@pmndrs/handle";
import * as THREE from "three/webgpu";
import type { PointerEvent as PenPointerEvent } from "@pmndrs/pointer-events";
import { pushPullGrab } from "./pushPull.ts";

type TransformedObject = THREE.Object3D & {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rayEvent(
  type: string,
  object: THREE.Object3D,
  point: THREE.Vector3,
  quaternion = new THREE.Quaternion(),
) {
  return {
    type,
    pointerId: 42,
    pointerType: "ray",
    object,
    point,
    pointerPosition: new THREE.Vector3(),
    pointerQuaternion: quaternion,
    details: { type: "ray" },
    intersection: { details: { type: "ray" } },
    timeStamp: 1,
    stopPropagation() {},
  } as unknown as PenPointerEvent;
}

/** A window a metre straight ahead of a hand at the origin, grabbed by its ray. */
function grabbedWindow(options: HandleOptions<unknown> = {}) {
  const target = new THREE.Object3D() as unknown as TransformedObject;
  target.position.set(0, 0, -1);
  const store = new HandleStore(target, () => ({ alwaysUpdate: true, ...options }));
  const handle = new THREE.Object3D();
  store.handlers.onPointerDown(rayEvent("pointerdown", handle, new THREE.Vector3(0, 0, -1)));
  return { target, store, handle };
}

function near(a: THREE.Vector3, x: number, y: number, z: number): boolean {
  return a.distanceTo(new THREE.Vector3(x, y, z)) < 1e-4;
}

Deno.test("push moves the window away along the ray", () => {
  const { target, store } = grabbedWindow();
  assert(pushPullGrab(store, 42, 0.5), "a free grab should accept push/pull");
  store.update(1);
  assert(near(target.position, 0, 0, -1.5), `expected z -1.5, got ${target.position.toArray()}`);
});

Deno.test("push follows the ray after the hand has turned", () => {
  const { target, store, handle } = grabbedWindow();
  // Turn the hand 90° left: its ray now points along -x, and the window swings with it.
  const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  store.handlers.onPointerMove(
    rayEvent("pointermove", handle, new THREE.Vector3(-1, 0, 0), turned),
  );
  store.update(1);
  assert(
    near(target.position, -1, 0, 0),
    `the window should follow the turn, got ${target.position.toArray()}`,
  );

  pushPullGrab(store, 42, 0.5);
  store.update(2);
  assert(
    near(target.position, -1.5, 0, 0),
    `push should go along the turned ray, got ${target.position.toArray()}`,
  );
});

Deno.test("push/pull is refused on a rotation-only handle", () => {
  const { store } = grabbedWindow({ rotate: "y", translate: "as-rotate", scale: false });
  const pointer = store.inputState.get(42);
  assert(pointer != null, "the grab should register its pointer");
  const before = pointer.initialPointerWorldPoint.clone();
  assert(!pushPullGrab(store, 42, 0.5), "a handle whose translation is rotation must refuse");
  assert(
    pointer.initialPointerWorldPoint.equals(before),
    "refusing must not shift the start point the rotation is derived from",
  );
});

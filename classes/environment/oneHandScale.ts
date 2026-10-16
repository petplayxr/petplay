/**
 * One-hand resize, after XSOverlay: while one hand grabs a window, pulling that hand's trigger
 * resizes it. Pushing the hand forward (and a little down) grows the window; pulling it back
 * toward you shrinks it. The window holds still while the trigger is down.
 *
 * XSOverlay's `Raycaster.Scale()` measures the hand's travel since the trigger went down along the
 * hand's backward axis tilted 40° up, and adds three times that to the window's starting width.
 * This does the same with the grip space.
 *
 * Handle callbacks only know their `HandleState`, so the grab pointers register which hand and
 * input source they belong to ({@link registerGrabPointerHand}), and the wrapped `apply` finds its
 * store, and from it the grabbing pointer, among the scene's handle stores.
 */
import * as THREE from "three/webgpu";
import type { HandleState, HandleStore } from "@pmndrs/handle";
import type { Pointer } from "@pmndrs/pointer-events";
import { getHandOriginWorldMatrix } from "./trackedOrigins.ts";
import { pulseHand } from "./haptics.ts";
import type { RenderTrackingFollow } from "../overlayRenderTracking.ts";

export type GrabHand = "left" | "right";

/** XSOverlay's `ScaleSpeed`: metres of width per metre of hand travel. */
export const ONE_HAND_SCALE_SPEED = 3;
export const ONE_HAND_SCALE_TILT_RADIANS = 40 * Math.PI / 180;
export const ONE_HAND_SCALE_MIN_WIDTH = 0.05;
export const ONE_HAND_SCALE_MAX_WIDTH = 8;
const TRIGGER_DOWN = 0.2;

type GrabPointer = {
  hand: GrabHand;
  inputSource: XRInputSource;
  pointer: Pointer;
  /** The pointer's pose space: grip for the sphere, target ray for the ray. */
  space?: "hand" | "ray";
};

const grabPointers = new Map<number, GrabPointer>();

/** Returns the unregister function; a stale unregister leaves a newer registration alone. */
export function registerGrabPointerHand(
  pointer: Pointer,
  hand: GrabHand,
  inputSource: XRInputSource,
  space?: GrabPointer["space"],
): () => void {
  const entry = { hand, inputSource, pointer, space };
  grabPointers.set(pointer.id, entry);
  return () => {
    if (grabPointers.get(pointer.id) === entry) grabPointers.delete(pointer.id);
  };
}

/**
 * Whether one of `hand`'s grab pointers is holding something. Its select ray goes quiet meanwhile,
 * or the trigger that resizes would also click whatever the ray points at.
 */
export function isHandGrabbing(hand: GrabHand): boolean {
  for (const entry of grabPointers.values()) {
    if (entry.hand === hand && entry.pointer.getPointerCapture() != null) return true;
  }
  return false;
}

/** The scale gesture's axis in grip space: backward, tilted up. */
const LOCAL_AXIS = new THREE.Vector3(
  0,
  Math.sin(ONE_HAND_SCALE_TILT_RADIANS),
  Math.cos(ONE_HAND_SCALE_TILT_RADIANS),
);

/**
 * The window width for a hand that has moved from `start` to `position`. Travel against the
 * tilted backward axis (forward and down) widens it.
 */
export function oneHandScaledWidth(
  startWidth: number,
  start: THREE.Vector3,
  position: THREE.Vector3,
  handQuaternion: THREE.Quaternion,
): number {
  const axis = LOCAL_AXIS.clone().applyQuaternion(handQuaternion);
  const travel = start.clone().sub(position).dot(axis);
  return Math.min(
    ONE_HAND_SCALE_MAX_WIDTH,
    Math.max(ONE_HAND_SCALE_MIN_WIDTH, startWidth + travel * ONE_HAND_SCALE_SPEED),
  );
}

type Session = {
  pointerId: number;
  /** Set once the trigger has been up during this grab, so a trigger held into a grab is ignored. */
  armed: boolean;
  active?: {
    hand: THREE.Vector3;
    scale: THREE.Vector3;
    width: number;
  };
};

const sessions = new WeakMap<object, Session>();
const handMatrix = new THREE.Matrix4();
const handPosition = new THREE.Vector3();
const handQuaternion = new THREE.Quaternion();
const handScale = new THREE.Vector3();
const worldScale = new THREE.Vector3();

function readHand(hand: GrabHand): boolean {
  if (!getHandOriginWorldMatrix(`${hand}-hand`, handMatrix)) return false;
  handMatrix.decompose(handPosition, handQuaternion, handScale);
  return true;
}

function triggerValue(inputSource: XRInputSource): number {
  return inputSource.gamepad?.buttons[0]?.value ?? 0;
}

function storeFor(
  stores: Iterable<HandleStore<unknown>>,
  state: HandleState<unknown>,
): HandleStore<unknown> | undefined {
  for (const store of stores) {
    if (store.getState() === state) return store;
  }
  return undefined;
}

const resizedTargets = new WeakSet<object>();

/**
 * Whether a resize of `target` has ended since the last call. The hand has moved during the
 * resize, so anything measured against where the grab started (a hinge's pull-to-detach distance)
 * has to start over.
 */
export function consumeOneHandScaleEnd(target: object): boolean {
  return resizedTargets.delete(target);
}

/**
 * Adds the one-hand resize to a grab's `apply`. `baseWidth` is the window's width in the target's
 * frame, which XSOverlay's speed and limits are in.
 *
 * While resizing, the store is rebased (`save`) every frame, so the hand's travel moves nothing,
 * and when the trigger comes up the grab carries on from where the window is.
 */
export function withOneHandScale<T>(
  apply: (state: HandleState<unknown>, target: THREE.Object3D) => T,
  stores: Map<string, HandleStore<unknown>>,
  baseWidth: number,
  /** Let the renderer carry the window with the grabbing controller ({@link setRenderFollow}). */
  renderFollow = false,
): (state: HandleState<unknown>, target: THREE.Object3D) => T | undefined {
  return (state, target) => {
    if (state.first) sessions.delete(target);
    const store = state.last || state.current.pointerAmount !== 1
      ? undefined
      : storeFor(stores.values(), state);
    const pointerId = store?.inputState.keys().next().value;
    const grabber = pointerId == null ? undefined : grabPointers.get(pointerId);
    if (store == null || pointerId == null || grabber == null) {
      sessions.delete(target);
      setRenderFollow(target, undefined);
      return apply(state, target);
    }
    let session = sessions.get(target);
    if (session?.pointerId !== pointerId) {
      session = { pointerId, armed: false };
      sessions.set(target, session);
    }
    const down = triggerValue(grabber.inputSource) >= TRIGGER_DOWN;
    if (session.active == null) {
      if (!down) session.armed = true;
      else if (session.armed && readHand(grabber.hand)) {
        target.updateWorldMatrix(true, false);
        target.getWorldScale(worldScale);
        session.active = {
          hand: handPosition.clone(),
          scale: target.scale.clone(),
          width: baseWidth * worldScale.x,
        };
        pulseHand(grabber.hand, "click");
      }
    }
    const active = session.active;
    // While resizing the window holds still as the hand moves, so it must not follow the hand.
    setRenderFollow(
      target,
      renderFollow && active == null ? grabber : undefined,
      store.inputState.get(pointerId),
    );
    if (active == null) return apply(state, target);
    if (!down) {
      session.active = undefined;
      resizedTargets.add(target);
    } else if (readHand(grabber.hand)) {
      const width = oneHandScaledWidth(active.width, active.hand, handPosition, handQuaternion);
      target.scale.copy(active.scale).multiplyScalar(width / active.width);
    }
    store.save();
    return undefined;
  };
}

/**
 * A single-handed grab moves the window rigidly with the controller (damped, so it trails at the
 * hand's speed). Tagging it lets the decoupled renderer re-pose it from its own fresh controller
 * pose like the wrist menu, instead of at the worker's frame rate and older pose. Hinged and
 * resizing windows do not move with the hand and are left untagged.
 */
function setRenderFollow(
  target: THREE.Object3D,
  grabber: GrabPointer | undefined,
  input?: { pointerWorldOrigin: THREE.Vector3; pointerWorldQuaternion: THREE.Quaternion },
): void {
  if (grabber?.space == null || input == null) {
    delete target.userData.renderTrackingFollow;
    return;
  }
  const space = `${grabber.hand}-${grabber.space}` as const;
  let follow = target.userData.renderTrackingFollow as RenderTrackingFollow | undefined;
  if (follow?.space !== space) {
    const pointer = grabber.pointer;
    follow = {
      space,
      pose: new THREE.Matrix4(),
      // A grab can end without a last apply (capture dropped), so check the pointer still holds it.
      active: () => pointer.getPointerCapture() != null,
    } as unknown as RenderTrackingFollow;
    target.userData.renderTrackingFollow = follow;
  }
  // The pose this apply placed the window from, not a later sample of the controller.
  (follow.pose as unknown as THREE.Matrix4).compose(
    input.pointerWorldOrigin,
    input.pointerWorldQuaternion,
    UNIT_SCALE,
  );
}

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

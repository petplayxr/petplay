/**
 * Head-locked toast stack (see `toastStore.ts`): a column of black cards below the line of sight,
 * following the head with a little lag so it reads as attached to you without jittering with
 * every head tremor. It takes no pointer events: rays pass through to whatever is behind it.
 */
import React, { useRef } from "react";
import * as THREE from "three/webgpu";
import { useFrame, useThree } from "@react-three/fiber/webgpu";
import { Container, Text } from "../../submodules/threewebxrwebgpudeno/webgpu-uikit.tsx";
import { COLOR, OUTLINE_WIDTH } from "./ui/tokens.ts";
import { type Toast, toastQueue, useVisibleToasts } from "./toastStore.ts";

/** In head space: slightly below the line of sight, closer than the displays. */
const HEAD_OFFSET = new THREE.Vector3(0, -0.17, -0.6);
const FOLLOW_RATE = 8;
const TICK_INTERVAL_S = 0.25;
const CARD_WIDTH = 480;
const NO_POINTER_EVENTS = () => false;

function toneColor(toast: Toast): string {
  return toast.tone === "error"
    ? COLOR.danger
    : toast.tone === "warning"
    ? COLOR.accent
    : COLOR.outline;
}

function ToastCard({ toast }: { toast: Toast }) {
  return (
    <Container
      width={CARD_WIDTH}
      flexDirection="column"
      gap={4}
      paddingX={20}
      paddingY={14}
      borderRadius={22}
      backgroundColor={COLOR.ground}
      backgroundOpacity={0.92}
      borderWidth={OUTLINE_WIDTH}
      borderColor={toneColor(toast)}
      borderOpacity={toast.tone === "info" ? 0.35 : 1}
    >
      <Text color={COLOR.inkDim} fontSize={14}>{toast.source}</Text>
      <Text color={COLOR.ink} fontSize={22}>{toast.title}</Text>
      {toast.content !== "" && <Text color={COLOR.ink} fontSize={17}>{toast.content}</Text>}
    </Container>
  );
}

export function ToastOverlay() {
  const toasts = useVisibleToasts();
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.gl);
  const scratch = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    sinceTick: 0,
    placed: false,
  });

  useFrame((_state, delta) => {
    const s = scratch.current;
    s.sinceTick += delta;
    if (s.sinceTick >= TICK_INTERVAL_S) {
      s.sinceTick = 0;
      toastQueue.tick();
    }
    const node = group.current;
    if (node == null || toasts.length === 0) {
      s.placed = false;
      return;
    }
    const xr = (renderer as unknown as {
      xr?: { getCamera?: (camera: THREE.Camera) => THREE.Camera };
    }).xr;
    const head = Deno.args.includes("--desktop")
      ? camera
      : xr?.getCamera?.(camera as unknown as THREE.Camera) ?? camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(s.position);
    head.getWorldQuaternion(s.quaternion);
    s.position.add(HEAD_OFFSET.clone().applyQuaternion(s.quaternion));
    // Snap on first show, so a toast never sweeps in from where the last one was.
    const t = s.placed ? 1 - Math.exp(-FOLLOW_RATE * delta) : 1;
    node.position.lerp(s.position, t);
    node.quaternion.slerp(s.quaternion, t);
    s.placed = true;
  });

  if (toasts.length === 0) return null;
  return (
    <group ref={group} userData={{ toastOverlay: true }}>
      <Container
        pixelSize={0.0007}
        pointerEventsType={NO_POINTER_EVENTS}
        flexDirection="column"
        alignItems="center"
        gap={8}
      >
        {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} />)}
      </Container>
    </group>
  );
}

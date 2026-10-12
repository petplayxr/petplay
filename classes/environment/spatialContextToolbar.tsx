/**
 * Contextual toolbar for a selected spatial node.
 *
 * Uses the same vocabulary as the wrist overlay — black card, white outlines,
 * one accent, text in pills — but not its 4x4 tile grid. The grid is the wrist
 * panel's *frame*; this is a floating contextual surface whose content varies
 * with the node in focus, so it takes the tokens and the recursive spacing and
 * radius rules without the fixed layout.
 *
 * Widths still snap to the slot grid: actions span a whole number of slots and
 * two fit per row, so the card's right edge is straight no matter how long the
 * labels are. That is the rule that keeps an otherwise rigid system from
 * reading as loose.
 */
import React, { useRef, useState } from "react";
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import { useFrame } from "@react-three/fiber/webgpu";
import type { AllowedPointerEventsType } from "@pmndrs/pointer-events";
import { Container } from "../../submodules/threewebxrwebgpudeno/webgpu-uikit.tsx";
import { Text } from "./ui/text.tsx";
import { Pill } from "./ui/primitives.tsx";
import { Icon, type IconName } from "./ui/icons.tsx";
import { COLOR, GAP, INNER_GAP, OUTLINE_WIDTH, RADIUS, UNIT, unitSpan } from "./ui/tokens.ts";
import { pulseForPointerEvent } from "./haptics.ts";

/**
 * Action id -> glyph.
 *
 * Icons rather than words, the way XSO's toolbar works. It also fits this
 * system better: a single-unit element *inside a card* is a circle, so a row of
 * actions becomes a row of circles in a card sized to hold them — rule 4
 * exactly ("a 3-button menu is a 3-wide card holding 3 circles").
 *
 * An action with no mapping falls back to a generic glyph rather than
 * disappearing, so adding one to the scene never silently produces a blank
 * button.
 */
const ACTION_ICONS: Record<string, IconName> = {
  "add-display": "add",
  // `link`, not `link_off`: the button reports that the node *is* linked. The
  // icon names the state, the accent says it is on, and pressing it ends it.
  detach: "link",
  delete: "delete",
  lock: "lock",
  reset: "refresh",
  settings: "settings",
};

const FALLBACK_ACTION_ICON: IconName = "more_horiz";

export type SpatialContextAction = {
  id: string;
  label: string;
  tone?: "normal" | "danger" | "accent";
  disabled?: boolean;
  run: () => void;
};

export type SpatialContextToolbarProps = {
  title: string;
  actions: SpatialContextAction[];
  settings?: React.ReactNode;
  /** The middle of the node's bottom edge, in the node's space. The card hangs below it. */
  position: [number, number, number];
  /** World size, independent of how far the node is scaled. */
  scale?: number;
  pointerEventsType?: AllowedPointerEventsType;
};

/**
 * Icon button: a **rounded square**, not a circle.
 *
 * The circle rule is about what an element sits *on*, not how deep it is: this
 * card's background is the same pure black ground the wrist shell uses, so its
 * children are top-level elements and take the tile shape. A circle would only
 * be right one level further in, sitting on a grey tile.
 *
 * The label is the tooltip: while the tile is hovered it replaces the title in
 * the card's pill — an icon-only control still has to say what it is somewhere.
 */
function ActionTile(
  { action, onHover }: {
    action: SpatialContextAction;
    onHover: (id: string | null) => void;
  },
) {
  const [hovered, setHovered] = useState(false);
  const hover = (next: boolean) => {
    // A disabled tile still says what it is; it just doesn't light up.
    setHovered(next && !action.disabled);
    onHover(next ? action.id : null);
  };
  const danger = action.tone === "danger";
  const accent = action.tone === "accent";
  const filled = (danger || accent) && !action.disabled;
  const fill = danger
    ? (hovered ? COLOR.dangerBright : COLOR.danger)
    : accent
    ? (hovered ? COLOR.accentBright : COLOR.accent)
    : hovered
    ? COLOR.tileHi
    : COLOR.tile;
  const ink = action.disabled
    ? COLOR.inkDim
    : danger
    ? COLOR.onDanger
    : accent
    ? COLOR.onAccent
    : COLOR.ink;
  return (
    <Container
      width={UNIT}
      height={UNIT}
      // Concentric with the card: its radius minus the padding it sits inside.
      borderRadius={RADIUS.shell - GAP}
      alignItems="center"
      justifyContent="center"
      backgroundColor={filled ? fill : hovered ? COLOR.tileHi : COLOR.tile}
      backgroundOpacity={1}
      onPointerOver={(event: unknown) => {
        hover(true);
        if (!action.disabled) pulseForPointerEvent(event, "hover");
      }}
      onPointerOut={() => hover(false)}
      onClick={action.disabled ? undefined : (event: unknown) => {
        pulseForPointerEvent(event, "click");
        action.run();
      }}
    >
      <Icon
        name={ACTION_ICONS[action.id] ?? FALLBACK_ACTION_ICON}
        size={40}
        color={ink}
      />
    </Container>
  );
}

/** Metres between the node's bottom edge and the top of the card. */
const EDGE_GAP = 0.015;
const SPAWN_SECONDS = 0.15;
const SPAWN_FROM = 0.8;

export function SpatialContextToolbar({
  title,
  actions,
  settings,
  position,
  scale = 0.72,
  pointerEventsType = "all",
}: SpatialContextToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  // By id, so the tooltip follows a label that changes on click (Lock -> "Locked — unlock") and
  // goes away with a tile that a click removed, which never gets its pointer-out.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Rule 4: the card is sized in whole element units to what it holds — a
  // 3-button menu is a 3-wide card holding 3 buttons. Two is the floor, or the
  // title pill has no room to say anything useful.
  const tileCount = actions.length + (settings != null ? 1 : 0);
  const units = Math.max(2, tileCount);
  const settingsAction: SpatialContextAction = {
    id: "settings",
    label: settingsOpen ? "Hide settings" : "Settings",
    tone: settingsOpen ? "accent" : "normal",
    run: () => setSettingsOpen((open) => !open),
  };
  const hoverLabel = hoveredId == null
    ? null
    : [...actions, ...(settings != null ? [settingsAction] : [])]
      .find((action) => action.id === hoveredId)?.label ?? null;

  // The card is a control, not part of the window: it stays the same size and the same distance
  // below the edge however far the window is scaled, so counter the parent's world scale each
  // frame. It also pops in, so a selection change reads as the card arriving, not blinking on.
  const group = useRef<THREE.Group>(null);
  const scratch = useRef({ parentScale: new THREE.Vector3(), age: 0 });
  useFrame((_state, delta) => {
    const node = group.current;
    if (node?.parent == null) return;
    const s = scratch.current;
    s.age += delta;
    const t = Math.min(1, s.age / SPAWN_SECONDS);
    const pop = SPAWN_FROM + (1 - SPAWN_FROM) * (1 - (1 - t) ** 3);
    node.parent.getWorldScale(s.parentScale);
    const k = scale * pop;
    node.scale.set(k / s.parentScale.x, k / s.parentScale.y, k / s.parentScale.z);
    node.position.set(position[0], position[1] - EDGE_GAP / s.parentScale.y, position[2]);
  });

  return (
    <group
      ref={group}
      position={position}
      scale={[scale * SPAWN_FROM, scale * SPAWN_FROM, scale * SPAWN_FROM]}
      userData={{ spatialContextToolbar: true }}
      {...({ pointerEventsOrder: 20 } as Record<string, unknown>)}
    >
      {
        /*
        A small shell rather than a tile: black ground, the shell's radius, and
        the shell's padding-equals-gap rhythm. Everything inside is therefore a
        top-level element on the same terms as the wrist panel's tiles.
      */
      }
      {/* Top-anchored, so opening settings grows the card down, away from the window. */}
      <Container
        pixelSize={0.001}
        anchorY="top"
        width={unitSpan(units) + GAP * 2}
        padding={GAP}
        gap={GAP}
        flexDirection="column"
        alignItems="stretch"
        borderRadius={RADIUS.shell}
        backgroundColor={COLOR.ground}
        backgroundOpacity={1}
        pointerEventsType={pointerEventsType}
      >
        {
          /*
          The one piece of text left: the icons say what the actions do, but
          nothing else says which node they act on. Spans the full card width,
          so its edges land on the grid like every other pill.

          Outlined, not accented: a node's name is not a state. Accent is
          reserved for "this is on", so on a detached node nothing in this card
          is lit at all — which is the point.
        */
        }
        <Pill slots={units * 2} units={units} fontSize={14}>
          {hoverLabel ?? title}
        </Pill>

        <Container flexDirection="row" gap={GAP}>
          {actions.map((action) => (
            <ActionTile key={action.id} action={action} onHover={setHoveredId} />
          ))}
          {settings != null && <ActionTile action={settingsAction} onHover={setHoveredId} />}
        </Container>
        {settingsOpen && settings}
      </Container>
    </group>
  );
}

export function SpatialSettingsSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Container flexDirection="column" gap={INNER_GAP} paddingTop={INNER_GAP}>
      <Pill slots={4} units={2} fontSize={12}>{label}</Pill>
      <Container flexDirection="row" flexWrap="wrap" gap={INNER_GAP}>
        {children}
      </Container>
    </Container>
  );
}

export function SpatialSettingsButton({
  label,
  selected = false,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <Pill
      slots={4}
      units={2}
      fontSize={12}
      tone={selected ? "accent" : "outline"}
      onClick={onClick}
    >
      {label}
    </Pill>
  );
}

/**
 * Marks a node's place in the hierarchy.
 *
 * A rounded square, not a circle: it sits on the world rather than inside a
 * card, which makes it a top-level element. The circle shape belongs to
 * single-unit elements nested on a tile.
 */
export function SpatialHierarchyIndicator({
  role,
  position,
  visible = true,
}: {
  role: "parent" | "child" | "solo";
  position: [number, number, number];
  visible?: boolean;
}) {
  const label = role === "parent" ? "P" : role === "child" ? "C" : "S";
  const size = UNIT * 0.5;
  return (
    <group
      position={position}
      visible={visible}
      userData={{ spatialHierarchyIndicator: role }}
      {...({ pointerEvents: "none", pointerEventsOrder: 30 } as Record<string, unknown>)}
    >
      <Container
        pixelSize={0.001}
        width={size}
        height={size}
        alignItems="center"
        justifyContent="center"
        borderRadius={RADIUS.shell - GAP}
        borderWidth={OUTLINE_WIDTH}
        borderColor={COLOR.outline}
        borderOpacity={1}
        backgroundColor={COLOR.ground}
        backgroundOpacity={1}
      >
        {
          /*
          Text directly, not wrapped in a pill: the circle already *is* the
          round container the text rule asks for (radius = half the smaller
          side), so nesting a pill inside it would be the same shape twice.
        */
        }
        <Text color={COLOR.ink} fontSize={18}>{label}</Text>
      </Container>
    </group>
  );
}

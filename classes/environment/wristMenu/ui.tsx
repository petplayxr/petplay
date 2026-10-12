import React, { useState } from "react";
import type { AllowedPointerEventsType } from "@pmndrs/pointer-events";
import { Button, Container } from "../../../submodules/threewebxrwebgpudeno/webgpu-uikit.tsx";
import { Text } from "../ui/text.tsx";
import { Pill, Shell } from "../ui/primitives.tsx";
import { COLOR, INNER_GAP, OUTLINE_WIDTH, RADIUS } from "../ui/tokens.ts";
import { WristOverlay } from "../ui/wristOverlay.tsx";
import { useBatteryReadings } from "../batteryStore.ts";
import { sendMediaCommand, useNowPlaying } from "../mediaStore.ts";
import type { WristMenuButtonId } from "./types.ts";
import type { WorkspaceLayoutSnapshot } from "../workspaceLayoutStore.ts";
import type { LayoutSlotSummary } from "../spatialLayoutPersistence.ts";
import { setSetting, type SettingKey, useSetting } from "../../settings.ts";

export type { WristMenuButtonId } from "./types.ts";

export type WristMenuUiProps = {
  clock?: string;
  dateLabel?: string;
  elapsed?: string;
  statusLabel?: string;
  layoutActive?: boolean;
  editActive?: boolean;
  onToggle?: (id: WristMenuButtonId) => void;
  onRecenter?: () => void;
  workspaceLayout?: WorkspaceLayoutSnapshot;
  onAssignOutput?: (displayId: string, outputId: string) => void;
  onAddOutput?: (outputId: string) => void;
  onSaveLayout?: (slot: number) => void;
  onLoadLayout?: (slot: number) => void;
  /** Only the opposite controller’s pointer should hit the menu (set from `WristMenuPanel` in XR). */
  pointerEventsType?: AllowedPointerEventsType;
};

const DEFAULT_CLOCK = "12:00";
const DEFAULT_DATE_LABEL = "FRI 24 APR";
const DEFAULT_ELAPSED = "00:00:00";
const DEFAULT_STATUS_LABEL = "Native module active";

/**
 * Monitor assignment, drawn in the panel's own vocabulary rather than the ad-hoc
 * palette it used before. It is a list rather than a tile grid, so it takes the
 * shell but not the 4x4 layout — the grid governs the overlay's home screen, not
 * every view reachable from it.
 */
function MonitorAssignments({
  workspaceLayout,
  onAssignOutput,
  onAddOutput,
  onBack,
}: {
  workspaceLayout: WorkspaceLayoutSnapshot;
  onAssignOutput?: (displayId: string, outputId: string) => void;
  onAddOutput?: (outputId: string) => void;
  onBack: () => void;
}) {
  const unassigned = workspaceLayout.outputs.filter((output) => output.assignedDisplayId == null);
  return (
    <Container flexDirection="column" gap={INNER_GAP} width={448}>
      <Container flexDirection="row" alignItems="center" gap={INNER_GAP}>
        <Button paddingX={0} paddingY={0} backgroundOpacity={0} onClick={onBack}>
          <Pill slots={1} units={2} fontSize={14}>BACK</Pill>
        </Button>
        <Pill slots={3} units={2} tone="accent" fontSize={14}>MONITORS</Pill>
      </Container>

      {workspaceLayout.displays.map((display) => (
        <Container
          key={display.id}
          flexDirection="column"
          gap={INNER_GAP}
          padding={INNER_GAP}
          borderRadius={RADIUS.tile}
          backgroundColor={COLOR.tile}
          backgroundOpacity={1}
        >
          <Text color={COLOR.ink} fontSize={14}>
            Display {display.ordinal}
            {display.root ? " (root)" : ""}
          </Text>
          <Container flexDirection="row" gap={INNER_GAP} flexWrap="wrap">
            {workspaceLayout.outputs.map((output) => {
              const selected = display.outputId === output.id;
              return (
                <Container
                  key={output.id}
                  paddingX={12}
                  paddingY={8}
                  borderRadius={16}
                  backgroundColor={COLOR.accent}
                  backgroundOpacity={selected ? 1 : 0}
                  borderWidth={selected ? 0 : OUTLINE_WIDTH}
                  borderColor={COLOR.outline}
                  borderOpacity={1}
                  onClick={() => onAssignOutput?.(display.id, output.id)}
                >
                  <Text color={selected ? COLOR.onAccent : COLOR.ink} fontSize={13}>
                    {output.name}
                  </Text>
                </Container>
              );
            })}
          </Container>
        </Container>
      ))}

      {workspaceLayout.outputs.length === 0 && (
        <Text color={COLOR.inkDim} fontSize={14}>No workspace outputs found.</Text>
      )}
      {unassigned.length > 0 && (
        <Container flexDirection="column" gap={INNER_GAP}>
          <Text color={COLOR.inkDim} fontSize={13}>Unassigned outputs</Text>
          <Container flexDirection="row" gap={INNER_GAP} flexWrap="wrap">
            {unassigned.map((output) => (
              <Container
                key={output.id}
                paddingX={12}
                paddingY={8}
                borderRadius={16}
                backgroundOpacity={0}
                borderWidth={OUTLINE_WIDTH}
                borderColor={COLOR.outline}
                borderOpacity={1}
                onClick={() => onAddOutput?.(output.id)}
              >
                <Text color={COLOR.ink} fontSize={13}>Add {output.name}</Text>
              </Container>
            ))}
          </Container>
        </Container>
      )}
    </Container>
  );
}

/**
 * Saved layout slots: SAVE writes the current arrangement, LOAD brings it back. LOAD is disabled
 * on an empty slot rather than hidden, so the rows keep their places.
 */
/**
 * "3 displays · 08:14 PM", or the date ("3 displays · 09/10") when it wasn't saved today. Same
 * formats as the wrist clock and date.
 */
export function layoutSlotLabel(summary: LayoutSlotSummary, now = new Date()): string {
  const displays = `${summary.displays} display${summary.displays === 1 ? "" : "s"}`;
  if (summary.savedAt == null) return displays;
  const saved = new Date(summary.savedAt);
  const when = saved.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
      .format(saved)
    : `${String(saved.getDate()).padStart(2, "0")}/${
      String(saved.getMonth() + 1).padStart(2, "0")
    }`;
  return `${displays} · ${when}`;
}

function LayoutSlotsView(
  { slots, onSave, onLoad, onBack }: {
    slots: (LayoutSlotSummary | null)[];
    onSave?: (slot: number) => void;
    onLoad?: (slot: number) => void;
    onBack: () => void;
  },
) {
  return (
    <Container flexDirection="column" gap={INNER_GAP} width={448}>
      <Container flexDirection="row" alignItems="center" gap={INNER_GAP}>
        <Button paddingX={0} paddingY={0} backgroundOpacity={0} onClick={onBack}>
          <Pill slots={1} units={2} fontSize={14}>BACK</Pill>
        </Button>
        <Pill slots={3} units={2} tone="accent" fontSize={14}>LAYOUTS</Pill>
      </Container>
      {[1, 2, 3].map((slot) => {
        const summary = slots[slot - 1] ?? null;
        const saved = summary != null;
        return (
          <Container
            key={slot}
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            padding={INNER_GAP}
            borderRadius={RADIUS.tile}
            backgroundColor={COLOR.tile}
            backgroundOpacity={1}
          >
            <Container flexDirection="column" gap={2}>
              <Text color={saved ? COLOR.ink : COLOR.inkDim} fontSize={14}>
                Layout {slot}
                {saved ? "" : " (empty)"}
              </Text>
              {summary != null && (
                <Text color={COLOR.inkDim} fontSize={12}>{layoutSlotLabel(summary)}</Text>
              )}
            </Container>
            <Container flexDirection="row" gap={INNER_GAP}>
              <Pill slots={1} units={2} fontSize={13} onClick={() => onSave?.(slot)}>SAVE</Pill>
              <Pill
                slots={1}
                units={2}
                fontSize={13}
                disabled={!saved}
                onClick={() => onLoad?.(slot)}
              >
                LOAD
              </Pill>
            </Container>
          </Container>
        );
      })}
    </Container>
  );
}

/** A persisted boolean setting as a full-width row: label on the left, ON/OFF pill on the right. */
function SettingToggleRow(
  { label, setting }: {
    label: string;
    setting: Extract<SettingKey, "grabboxOutline" | "controllerLaser" | "haptics">;
  },
) {
  const value = useSetting(setting);
  return (
    <Container
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      padding={INNER_GAP}
      borderRadius={RADIUS.tile}
      backgroundColor={COLOR.tile}
      backgroundOpacity={1}
    >
      <Text color={COLOR.ink} fontSize={14}>{label}</Text>
      <Pill
        slots={1}
        units={2}
        tone={value ? "accent" : "outline"}
        fontSize={13}
        onClick={() => setSetting(setting, !value)}
      >
        {value ? "ON" : "OFF"}
      </Pill>
    </Container>
  );
}

/** Size steps the wrist "Wrist menu" row cycles through. */
const WRIST_SCALE_STEPS = [0.75, 1, 1.25, 1.5];

/** Which hand wears the menu, and its size. The hand pill stays rightmost like the other rows. */
function WristHandRow() {
  const hand = useSetting("wristMenuHand");
  const scale = useSetting("wristMenuScale");
  const step = WRIST_SCALE_STEPS.indexOf(scale);
  const nextScale = WRIST_SCALE_STEPS[(step + 1) % WRIST_SCALE_STEPS.length];
  return (
    <Container
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      padding={INNER_GAP}
      borderRadius={RADIUS.tile}
      backgroundColor={COLOR.tile}
      backgroundOpacity={1}
    >
      <Text color={COLOR.ink} fontSize={14}>Wrist menu</Text>
      <Container flexDirection="row" gap={INNER_GAP}>
        <Pill
          slots={1}
          units={2}
          fontSize={13}
          onClick={() => setSetting("wristMenuScale", nextScale)}
        >
          {`${Math.round(scale * 100)}%`}
        </Pill>
        <Pill
          slots={1}
          units={2}
          fontSize={13}
          onClick={() => setSetting("wristMenuHand", hand === "right" ? "left" : "right")}
        >
          {hand === "right" ? "RIGHT" : "LEFT"}
        </Pill>
      </Container>
    </Container>
  );
}

/** Opacity steps the "Wrist opacity" row cycles through. */
const WRIST_OPACITY_STEPS = [1, 0.75, 0.5];

function WristOpacityRow() {
  const opacity = useSetting("wristMenuOpacity");
  const step = WRIST_OPACITY_STEPS.indexOf(opacity);
  const next = WRIST_OPACITY_STEPS[(step + 1) % WRIST_OPACITY_STEPS.length];
  return (
    <Container
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      padding={INNER_GAP}
      borderRadius={RADIUS.tile}
      backgroundColor={COLOR.tile}
      backgroundOpacity={1}
    >
      <Text color={COLOR.ink} fontSize={14}>Wrist opacity</Text>
      <Pill
        slots={1}
        units={2}
        fontSize={13}
        onClick={() => setSetting("wristMenuOpacity", next)}
      >
        {`${Math.round(opacity * 100)}%`}
      </Pill>
    </Container>
  );
}

/** Settings reachable from the wrist; every row here is persisted by `classes/settings.ts`. */
function SettingsView(
  { onBack, onOpenMonitors, onOpenLayouts }: {
    onBack: () => void;
    onOpenMonitors: () => void;
    onOpenLayouts: () => void;
  },
) {
  return (
    <Container flexDirection="column" gap={INNER_GAP} width={448}>
      <Container flexDirection="row" alignItems="center" gap={INNER_GAP}>
        <Button paddingX={0} paddingY={0} backgroundOpacity={0} onClick={onBack}>
          <Pill slots={1} units={2} fontSize={14}>BACK</Pill>
        </Button>
        <Pill slots={3} units={2} tone="accent" fontSize={14}>SETTINGS</Pill>
      </Container>
      <SettingToggleRow label="Grab-box outlines" setting="grabboxOutline" />
      <SettingToggleRow label="Laser beams" setting="controllerLaser" />
      <SettingToggleRow label="Vibration" setting="haptics" />
      <WristHandRow />
      <WristOpacityRow />
      <Container
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        padding={INNER_GAP}
        borderRadius={RADIUS.tile}
        backgroundColor={COLOR.tile}
        backgroundOpacity={1}
        onClick={onOpenMonitors}
      >
        <Text color={COLOR.ink} fontSize={14}>Monitors</Text>
        <Pill slots={1} units={2} fontSize={13} onClick={onOpenMonitors}>OPEN</Pill>
      </Container>
      <Container
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        padding={INNER_GAP}
        borderRadius={RADIUS.tile}
        backgroundColor={COLOR.tile}
        backgroundOpacity={1}
        onClick={onOpenLayouts}
      >
        <Text color={COLOR.ink} fontSize={14}>Saved layouts</Text>
        <Pill slots={1} units={2} fontSize={13} onClick={onOpenLayouts}>OPEN</Pill>
      </Container>
    </Container>
  );
}

export function WristMenuUi(
  {
    clock = DEFAULT_CLOCK,
    dateLabel = DEFAULT_DATE_LABEL,
    elapsed = DEFAULT_ELAPSED,
    statusLabel = DEFAULT_STATUS_LABEL,
    layoutActive = false,
    editActive = false,
    onToggle,
    onRecenter,
    workspaceLayout = { outputs: [], displays: [] },
    onAssignOutput,
    onAddOutput,
    onSaveLayout,
    onLoadLayout,
    pointerEventsType,
  }: WristMenuUiProps,
) {
  const pe: AllowedPointerEventsType = pointerEventsType ?? "all";
  const [view, setView] = useState<"main" | "settings" | "monitors" | "layouts">("main");
  const batteries = useBatteryReadings();
  const nowPlaying = useNowPlaying();
  const opacity = useSetting("wristMenuOpacity");

  if (view === "settings") {
    return (
      <Shell pointerEventsType={pe} opacity={opacity}>
        <SettingsView
          onBack={() => setView("main")}
          onOpenMonitors={() => setView("monitors")}
          onOpenLayouts={() => setView("layouts")}
        />
      </Shell>
    );
  }

  if (view === "layouts") {
    return (
      <Shell pointerEventsType={pe} opacity={opacity}>
        <LayoutSlotsView
          slots={workspaceLayout.layoutSlots ?? []}
          onSave={onSaveLayout}
          onLoad={onLoadLayout}
          onBack={() => setView("settings")}
        />
      </Shell>
    );
  }

  if (view === "monitors") {
    return (
      <Shell pointerEventsType={pe} opacity={opacity}>
        <MonitorAssignments
          workspaceLayout={workspaceLayout}
          onAssignOutput={onAssignOutput}
          onAddOutput={onAddOutput}
          onBack={() => setView("settings")}
        />
      </Shell>
    );
  }

  return (
    <WristOverlay
      clock={clock}
      dateLabel={dateLabel}
      elapsed={elapsed}
      status={statusLabel}
      displayCount={workspaceLayout.displays.length}
      batteries={batteries}
      nowPlaying={nowPlaying}
      onMedia={sendMediaCommand}
      opacity={opacity}
      active={{ layout: layoutActive, edit: editActive }}
      onToggle={onToggle}
      onOpenSettings={() => setView("settings")}
      onRecenter={onRecenter}
      pointerEventsType={pe}
    />
  );
}

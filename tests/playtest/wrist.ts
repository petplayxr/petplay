/**
 * Wrist playtest: the clock shows the current time, battery readings show on the wrist and a
 * controller dropping below 15% raises one toast, the Settings page toggles write their settings,
 * and the Wrist menu page steps scale and opacity and switches hands.
 *
 * Battery readings are published straight into the store (in `--novr` nothing polls OpenVR). The
 * media tile is left alone: its transport would reach the host's real player.
 *
 * Run with `deno task playtest wrist`.
 */
// @deno-types="@types/three/webgpu"
import * as THREE from "three/webgpu";
import {
  type PlaytestContext,
  type PlaytestStep,
  WRIST_MAIN,
  WRIST_SETTINGS,
  WRIST_WRIST,
} from "../../utils/playtest.ts";
import { batteryStore } from "../../classes/environment/batteryStore.ts";
import { toastQueue } from "../../classes/environment/toastStore.ts";
import { getSetting, setSetting } from "../../classes/settings.ts";
import { getToolEditMode } from "../../classes/environment/toolEditMode.ts";
import { getWindowLayerVisible } from "../../classes/environment/windowLayerMode.ts";
import {
  editSpatialGraph,
  getSpatialGraph,
  getWorkspaceLayoutSnapshot,
} from "../../classes/environment/workspaceLayoutStore.ts";
import { deleteSpatialNode } from "../../classes/environment/spatialGraph.ts";
import { aim, LEFT_ORIGIN, squeeze, worldOf } from "./lib/steps.ts";

function wristMenu(ctx: PlaytestContext): THREE.Object3D {
  let menu: THREE.Object3D | null = null;
  ctx.scene().traverse((object) => {
    if (menu == null && object.userData?.wristMenuActor !== undefined) menu = object.parent;
  });
  if (menu == null) throw new Error("no wrist menu in the scene");
  return menu;
}

const wristText = (ctx: PlaytestContext, text: string) => ctx.textObject(wristMenu(ctx), text);

/** All the text drawn on the wrist menu. */
function wristTexts(ctx: PlaytestContext): string[] {
  const texts: string[] = [];
  wristMenu(ctx).traverse((object) => {
    const text = object.userData?.raythreeUiText?.text;
    if (typeof text === "string") texts.push(text);
  });
  return texts;
}

/** Clicks the wrist panel where `text` is drawn. */
async function clickWristText(ctx: PlaytestContext, text: string) {
  const object = wristText(ctx, text);
  if (!ctx.expect(object, `the wrist shows "${text}"`)) return false;
  const menu = wristMenu(ctx);
  menu.updateWorldMatrix(true, true);
  const local = menu.worldToLocal(worldOf(object!).position);
  await ctx.t.clickWristMenu([local.x / 0.001, local.y / 0.001]);
  return true;
}

const lowToasts = () =>
  toastQueue.visible().filter((toast) => toast.title.endsWith("battery low")).length +
  toastQueue.pending();

export const steps: PlaytestStep[] = [
  {
    name: "clock",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      const shown = () => wristTexts(ctx).find((text) => /^\d{1,2}:\d{2}( [AP]M)?$/.test(text));
      if (!await ctx.waitFor(shown, "the wrist shows a time")) return;
      const [hours, minutes] = shown()!.split(/[: ]/).map(Number);
      const now = new Date();
      const shownMinutes = (hours % 12) * 60 + minutes;
      const nowMinutes = (now.getHours() % 12) * 60 + now.getMinutes();
      ctx.note(`clock ${shown()}, host ${now.toTimeString().slice(0, 5)}`);
      ctx.expect(
        Math.abs(shownMinutes - nowMinutes) <= 1 || Math.abs(shownMinutes - nowMinutes) >= 719,
        "the clock matches the host's time",
      );
    },
  },
  {
    name: "battery",
    run: async (ctx) => {
      for (const toast of toastQueue.visible()) toastQueue.dismiss(toast.id);
      try {
        batteryStore.publish({
          left: { percent: 62, charging: false },
          right: { percent: 40, charging: false },
          hmd: { percent: 81, charging: true },
        });
        await ctx.waitFor(() => wristText(ctx, "BATTERY"), "the battery tile shows");
        await ctx.waitFor(() => wristText(ctx, "L 62%"), "with the left controller");
        ctx.expect(wristText(ctx, "R 40%"), "the right controller");
        ctx.expect(wristText(ctx, "81%"), "and the headset");
        ctx.expect(lowToasts() === 0, "no low-battery toast above 15%");

        batteryStore.publish({
          left: { percent: 62, charging: false },
          right: { percent: 12, charging: false },
        });
        await ctx.waitFor(
          () =>
            toastQueue.visible().some((toast) => toast.title === "Right controller battery low"),
          "dropping below 15% raises a low-battery toast",
        );
        await ctx.waitFor(() => wristText(ctx, "R 12%"), "and the wrist shows the new level");
        batteryStore.publish({
          left: { percent: 62, charging: false },
          right: { percent: 11, charging: false },
        });
        await ctx.settle();
        ctx.expect(lowToasts() === 1, `falling further does not repeat it (${lowToasts()} toasts)`);
      } finally {
        batteryStore.publish({});
        for (const toast of toastQueue.visible()) toastQueue.dismiss(toast.id);
      }
      await ctx.waitFor(() => wristText(ctx, "BATTERY") == null, "no readings, no battery tile");
    },
  },
  {
    name: "settings-toggles",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      try {
        if (!await ctx.waitFor(() => wristText(ctx, "Vibration"), "the Settings page opens")) {
          return;
        }
        ctx.expect(
          getSetting("wristMenuOffset") == null,
          "opening a page with a click doesn't mark the menu as moved",
        );
        for (
          const [setting, point] of [
            ["haptics", WRIST_SETTINGS.haptics],
            ["controllerLaser", WRIST_SETTINGS.controllerLaser],
          ] as const
        ) {
          const before = getSetting(setting);
          await ctx.t.clickWristMenu(point);
          await ctx.waitFor(() => getSetting(setting) === !before, `${setting} toggles`);
          await ctx.t.clickWristMenu(point);
          await ctx.waitFor(() => getSetting(setting) === before, `and toggles back`);
        }
        ctx.expect(
          getSetting("wristMenuOffset") == null,
          `clicks leave the menu where it is (offset ${
            JSON.stringify(getSetting("wristMenuOffset"))
          })`,
        );
      } finally {
        await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
      }
    },
  },
  {
    name: "edit-mode",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      // Edit acts on the windows, so it needs them shown.
      if (getWindowLayerVisible()) await ctx.t.clickWristMenu(WRIST_MAIN.layout);
      await ctx.waitFor(() => !getWindowLayerVisible(), "the windows are hidden");
      await ctx.t.clickWristMenu(WRIST_MAIN.edit);
      await ctx.settle();
      ctx.expect(!getToolEditMode(), "edit stays off while the windows are hidden");
      await ctx.t.clickWristMenu(WRIST_MAIN.layout);
      await ctx.waitFor(getWindowLayerVisible, "the windows show");
      const before = getToolEditMode();
      await ctx.t.clickWristMenu(WRIST_MAIN.edit);
      await ctx.waitFor(() => getToolEditMode() === !before, "the edit tile toggles edit mode");
      await ctx.t.clickWristMenu(WRIST_MAIN.edit);
      await ctx.waitFor(() => getToolEditMode() === before, "and toggles it back");
      await ctx.t.clickWristMenu(WRIST_MAIN.edit);
      await ctx.waitFor(getToolEditMode, "edit on again");
      await ctx.t.clickWristMenu(WRIST_MAIN.layout);
      await ctx.waitFor(() => !getToolEditMode(), "hiding the windows turns edit off with them");
    },
  },
  {
    name: "monitors",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      await ctx.t.clickWristMenu(WRIST_SETTINGS.monitors);
      const added: string[] = [];
      try {
        if (!await ctx.waitFor(() => wristText(ctx, "MONITORS"), "the Monitors page opens")) return;
        const { outputs, displays } = getWorkspaceLayoutSnapshot();
        ctx.note(`outputs: ${outputs.map((output) => output.name).join(", ")}`);
        if (!ctx.expect(outputs.length > 0, "the host's outputs are listed")) return;
        const root = displays.find((display) => display.root);
        if (!ctx.expect(root, "a root display is listed")) return;
        const node = () => getSpatialGraph()?.nodes[root!.id];
        const original = node()?.workspaceOutputId;
        const other = outputs.find((output) => output.id !== original);
        if (other != null) {
          if (!await clickWristText(ctx, other.name)) return;
          await ctx.waitFor(
            () => node()?.workspaceOutputId === other.id,
            `picking ${other.name} assigns it to the root display`,
          );
          const back = outputs.find((output) => output.id === original);
          if (back != null && await clickWristText(ctx, back.name)) {
            await ctx.waitFor(
              () => node()?.workspaceOutputId === original,
              `and ${back.name} puts it back`,
            );
          }
        } else {
          ctx.note("one output only: nothing to reassign");
        }
        const free = getWorkspaceLayoutSnapshot().outputs.find((output) =>
          output.assignedDisplayId == null
        );
        if (free != null) {
          const before = new Set(Object.keys(getSpatialGraph()?.nodes ?? {}));
          if (!await clickWristText(ctx, `Add ${free.name}`)) return;
          await ctx.waitFor(
            () =>
              Object.values(getSpatialGraph()?.nodes ?? {}).some((candidate) =>
                !before.has(candidate.id) && candidate.workspaceOutputId === free.id &&
                added.push(candidate.id) > 0
              ),
            `Add ${free.name} adds a display showing it`,
          );
        } else {
          ctx.note("every output is assigned: nothing to add");
        }
      } finally {
        for (const id of added) editSpatialGraph((graph) => deleteSpatialNode(graph, id));
        await ctx.t.faceWristMenu();
        await clickWristText(ctx, "BACK");
        await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
      }
    },
  },
  {
    name: "grab-moves-menu",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      const menu = wristMenu(ctx);
      menu.updateWorldMatrix(true, false);
      // The clock tile. Only squeeze grabs the menu; the trigger presses its controls.
      const point = menu.localToWorld(new THREE.Vector3(-0.13, 0.1, 0.02));
      const before = worldOf(menu).position;
      const shift = new THREE.Vector3(0.06, 0, 0);
      try {
        aim(ctx, "left", LEFT_ORIGIN, point);
        await ctx.settle();
        squeeze(ctx, "left", true);
        await ctx.frames(3);
        for (let i = 1; i <= 10; i++) {
          const step = shift.clone().multiplyScalar(i / 10);
          aim(ctx, "left", LEFT_ORIGIN.clone().add(step), point.clone().add(step));
          await ctx.frames(1);
        }
        await ctx.frames(3);
        squeeze(ctx, "left", false);
        await ctx.settle();
        ctx.t.parkLeftHand();
        const moved = worldOf(wristMenu(ctx)).position.distanceTo(before);
        ctx.note(`a 6 cm drag moved the menu ${moved.toFixed(3)} m`);
        ctx.expect(Math.abs(moved - 0.06) < 0.015, "dragging the panel moves it");
        await ctx.waitFor(
          () => getSetting("wristMenuOffset") != null,
          "and letting go saves where it ended up",
        );
      } finally {
        squeeze(ctx, "left", false);
        ctx.t.parkLeftHand();
        setSetting("wristMenuOffset", null);
        await ctx.settle();
      }
    },
  },
  {
    name: "wrist-page",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      await ctx.t.clickWristMenu(WRIST_MAIN.settings);
      await ctx.t.clickWristMenu(WRIST_SETTINGS.wrist);
      const scale = getSetting("wristMenuScale");
      const opacity = getSetting("wristMenuOpacity");
      try {
        if (!await ctx.waitFor(() => wristText(ctx, "WRIST MENU"), "the Wrist menu page opens")) {
          return;
        }
        const width = () => wristMenu(ctx).getWorldScale(new THREE.Vector3()).x;
        const widthBefore = width();
        await ctx.t.clickWristMenu(WRIST_WRIST.scale);
        if (!await ctx.waitFor(() => getSetting("wristMenuScale") !== scale, "scale steps")) return;
        await ctx.settle();
        const ratio = width() / widthBefore;
        const expected = getSetting("wristMenuScale") / scale;
        ctx.note(
          `scale ${scale} -> ${getSetting("wristMenuScale")}, menu grew ${ratio.toFixed(3)}x`,
        );
        ctx.expect(Math.abs(ratio - expected) < 0.02, "the menu is drawn at the new scale");
        setSetting("wristMenuScale", scale);
        await ctx.settle();
        // Re-aim at the panel: its points moved with the scale.
        await ctx.t.faceWristMenu();
        await ctx.t.clickWristMenu(WRIST_WRIST.opacity);
        await ctx.waitFor(() => getSetting("wristMenuOpacity") !== opacity, "opacity steps");
        setSetting("wristMenuOpacity", opacity);
        // The menu jumps to the other wrist, where the right-hand helpers can't reach it; check
        // the setting and put it back directly.
        const hand = getSetting("wristMenuHand");
        await ctx.t.faceWristMenu();
        await ctx.t.clickWristMenu(WRIST_WRIST.hand);
        await ctx.waitFor(
          () => getSetting("wristMenuHand") !== hand,
          "the hand pill switches wrists",
        );
        setSetting("wristMenuHand", hand);
      } finally {
        setSetting("wristMenuScale", scale);
        setSetting("wristMenuOpacity", opacity);
        await ctx.settle();
        await ctx.t.faceWristMenu();
        await ctx.t.clickWristMenu(WRIST_WRIST.back);
        await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
      }
    },
  },
];

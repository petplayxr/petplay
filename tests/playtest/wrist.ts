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
import { aim, LEFT_ORIGIN, worldOf } from "./lib/steps.ts";

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
        await ctx.sleep(300);
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
    name: "grab-moves-menu",
    run: async (ctx) => {
      await ctx.t.faceWristMenu();
      const menu = wristMenu(ctx);
      menu.updateWorldMatrix(true, false);
      // The clock tile: no button under it, so a held trigger there is only a grab.
      const point = menu.localToWorld(new THREE.Vector3(-0.13, 0.1, 0.02));
      const before = worldOf(menu).position;
      const shift = new THREE.Vector3(0.06, 0, 0);
      try {
        aim(ctx, "left", LEFT_ORIGIN, point);
        await ctx.sleep(300);
        ctx.t.input.left.trigger = true;
        await ctx.sleep(200);
        for (let i = 1; i <= 10; i++) {
          const step = shift.clone().multiplyScalar(i / 10);
          aim(ctx, "left", LEFT_ORIGIN.clone().add(step), point.clone().add(step));
          await ctx.sleep(50);
        }
        await ctx.sleep(200);
        ctx.t.input.left.trigger = false;
        await ctx.sleep(300);
        ctx.t.parkLeftHand();
        const moved = worldOf(wristMenu(ctx)).position.distanceTo(before);
        ctx.note(`a 6 cm drag moved the menu ${moved.toFixed(3)} m`);
        ctx.expect(Math.abs(moved - 0.06) < 0.015, "dragging the panel moves it");
        await ctx.waitFor(
          () => getSetting("wristMenuOffset") != null,
          "and letting go saves where it ended up",
        );
      } finally {
        ctx.t.input.left.trigger = false;
        ctx.t.parkLeftHand();
        setSetting("wristMenuOffset", null);
        await ctx.sleep(300);
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
        await ctx.sleep(300);
        const ratio = width() / widthBefore;
        const expected = getSetting("wristMenuScale") / scale;
        ctx.note(
          `scale ${scale} -> ${getSetting("wristMenuScale")}, menu grew ${ratio.toFixed(3)}x`,
        );
        ctx.expect(Math.abs(ratio - expected) < 0.02, "the menu is drawn at the new scale");
        setSetting("wristMenuScale", scale);
        await ctx.sleep(300);
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
        await ctx.sleep(300);
        await ctx.t.faceWristMenu();
        await ctx.t.clickWristMenu(WRIST_WRIST.back);
        await ctx.t.clickWristMenu(WRIST_SETTINGS.back);
      }
    },
  },
];
